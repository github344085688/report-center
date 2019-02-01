const _ = require('lodash');
const os = require('os');
const fs = require('fs');

let service = (app, ctx) => {
    async function sendPackingListToOperation(param) {
        let emailTo = param.consigneeTo;
        let emailCC = param.consigneeCC;
        if (!emailTo) {
            throw new BadRequestError("EmailTo must not be empty.");
        }
        if (!param.customerId) {
            throw new BadRequestError("CustomerId must not be empty.");
        }

        let customerIds = [param.customerId];
        let [needSendPackingListShipmentTickets, customerMap] = await Promise.all([
            _getNotSendPackingListShipmentTicket(customerIds),
            organizationService(ctx).getOrganizationBasicMap(customerIds)
        ]);
        if (_.isEmpty(needSendPackingListShipmentTickets)) {
            log("There is no order need to send packing list");
            return;
        }

        log("send packing list to operation start");

        let orderIds = _.map(needSendPackingListShipmentTickets, "orderId");
        let orderMap = await _getOrderMap(orderIds);
        let loadShipmentTicketMap = _.groupBy(needSendPackingListShipmentTickets, "loadId");

        for(let loadId in loadShipmentTicketMap) {
            let shipmentTickets = loadShipmentTicketMap[loadId];
            let customer = customerMap[_.first(shipmentTickets).customerId] || {};
            let customerName = customer.name || "";
            try {
                let successShipmentTicketIds = await _sentPackingListByLoad(shipmentTickets, loadId, orderMap, customerName, emailTo, emailCC);

                if (!_.isEmpty(successShipmentTicketIds)) {
                    log(`set isPackListSent to true for shipment ticket: ${_.join(successShipmentTicketIds, ",")}`);
                    await wmsApp(ctx).put("/outbound/shipment-ticket/batch-mark-packing-list-sent", {"shipmentTicketIds": successShipmentTicketIds});
                }
            } catch (e) {
                app.logger.info(e);
                let errorMesg = `${e.message} ${e.stack}`;
                await app.sendMail("Packing List Auto Email Fail", `LoadId: ${loadId} </br> ${errorMesg}`, null, "xion.lee@unisco.com");
            }
        }

        log("send packing list to operation end");
    }

    async function _getNotSendPackingListShipmentTicket(customerIds) {
        if (_.isEmpty(customerIds)) return [];

        let startTime = momentZone().add(-3, 'days').startOf('day').format('YYYY-MM-DD HH:mm:ss');
        let needSendPackingListShipmentTickets = await shipmentTicketCollection(ctx).find({
            customerId: {$in: customerIds},
            dcSendStatus: true,
            isPackListSent: {$ne: true},
            createdWhen: {$gte: new Date(momentZone(startTime).format())}
        }).toArray();

        return needSendPackingListShipmentTickets;
    }

    async function _getOrderMap(orderIds) {
        if (_.isEmpty(orderIds)) return {};

        let orders = await orderCollection(ctx).find({_id: {$in: orderIds}}).toArray();

        return _.keyBy(orders, "_id");
    }

    async function _sentPackingListByLoad(shipmentTickets, loadId, orderMap, customerName, emailTo, emailCC) {
        let successShipmentTicketIds = [];

        let orderFiles = [];
        for(let shipmentTicket of shipmentTickets) {
            let fileId = await _generatePackingListPDF(loadId, shipmentTicket.orderId);
            orderFiles.push({"orderId": shipmentTicket.orderId, "fileId": fileId});
            successShipmentTicketIds.push(shipmentTicket._id);
        }

        let filePaths = await _downloadAttachment(orderFiles, orderMap);
        let referenceNoes = _.map(orderFiles, orderFile => {
            let order = orderMap[orderFile.orderId] || {};
            let referenceNo = order.referenceNo || "";
            return referenceNo;
        });

        await _sendEmailToOperator(filePaths, loadId, customerName, referenceNoes, emailTo, emailCC);

        return successShipmentTicketIds;
    }

    async function _downloadAttachment(orderFiles, orderMap) {
        let filePaths = [];

        for (let orderFile of orderFiles) {
            let order = orderMap[orderFile.orderId] || {};
            let referenceNo = order.referenceNo || "";
            let downloadFile = await _downloadPDF(orderFile.fileId, orderFile.orderId, referenceNo);
            if (!_.isEmpty(downloadFile)) {
                filePaths.push(downloadFile.filePath);
            }
        }

        return filePaths;
    }

    async function _downloadPDF(fileId, orderId, refNo) {
        if (!fileId) return {};

        let time = momentZone().format('YYYY-MM-DD_HHmmssS');
        let tmppath = os.tmpdir();
        let name = `packlist_${orderId}_${refNo}_${time}.pdf`;
        let filePath = `${tmppath}/${name}`;
        var stream = fs.createWriteStream(filePath);
        await new Promise((resolve, reject) => {
            fileApp(ctx).raw().get(`/file-view/${fileId}`).pipe(stream).on('close', resolve);
        });

        return {
            path: tmppath,
            filePath: filePath,
            fileName: name
        };
    }

    async function _sendEmailToOperator(filePaths, loadId, customerName, referenceNoes, emailTo, emailCC) {
        if (_.isEmpty(filePaths)) return;

        log(`send mail for load:${loadId} -- start`);

        let loadIsNotNull = loadId && loadId !== "null";
        let subject = loadIsNotNull ? `${customerName} ${_.join(referenceNoes, ",")} ${loadId}` : `${customerName} ${_.join(referenceNoes, ",")}`;
        let body = loadIsNotNull ? `Packing list for load:${loadId}.` : `Packing list for order:${referenceNoes}.`
        await app.sendMail(subject, body, filePaths, emailTo, emailCC);

        log(`send mail for load:${loadId} -- end`);
    }

    async function _generatePackingListPDF(loadId, orderId) {

        let pdfFile = "";
        if (loadId && loadId !== "null") {
            pdfFile = await wmsApp(ctx).get(`/outbound/load/${loadId}/order/${orderId}/packing-list/print`);
        } else {
            pdfFile = await wmsApp(ctx).get(`/outbound/order/${orderId}/packing-list/print`);
        }

        return pdfFile ? pdfFile.fileId || "" : "";
    }

    function log(message) {
        console.log(message);
    }

    return {
        sendPackingListToOperation
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};