const _ = require('lodash');

let service = (app, ctx) => {

    async function generateReport(criteria) {
        let head = ["Container #", "INNOLUX  SN", "UNIS SN"];
        let customerId = criteria.customerId;
        if (!customerId) {
            throw new BadRequestError('CustomerId can not be empty.');
        }
        let startTime = momentZone(moment().add(-1, 'days').startOf('day').format('YYYY-MM-DD HH:mm:ss')).format("YYYY-MM-DD") + " 00:00:00";
        let endTime = momentZone(moment().format('YYYY-MM-DD HH:mm:ss'), "America/Los_Angeles").format("YYYY-MM-DD") + " 00:00:00";
        let sql = `select  distinct receiptId from inventory where customerId ='${customerId}' and receivedWhen >= '${startTime}' and receivedWhen < '${endTime}'`
        let inventoryReceipts = await wmsMysql(ctx).query(sql);
        let inventoryReceiptIds = _.map(inventoryReceipts,"receiptId");

        let receipts = await receiptCollection(ctx).find({
            _id: {$in: inventoryReceiptIds},
            $and: [{containerNo: {$ne: null}}, {containerNo: {$ne: ""}}]

        }).sort({containerNo: 1}).toArray();
        let receiptMap = _.keyBy(receipts, "containerNo");

        let receiptIds = _.map(receipts, "_id");
        let itemLines = await receiptItemLineCollection(ctx).find({receiptId: {$in: receiptIds}}).toArray();
        let itemLineMap = _.keyBy(itemLines, "receiptId");

        let containerNos = _.uniq(_.map(receipts, "containerNo"));
        let preAlertSnList = await preAlertSnCollection(ctx).find({
            containerNo: {$in: containerNos}
        }).toArray();
        let preAlertSnMap = _.keyBy(preAlertSnList, "containerNo");

        let data = [];
        _.forEach(containerNos, function (ctn) {
            let receipt = receiptMap[ctn];
            if (receipt) {
                let unisSnList = itemLineMap[receipt._id] ? itemLineMap[receipt._id].snList : [];
                let innoluxSnList = preAlertSnMap[ctn] ? preAlertSnMap[ctn].snList : [];
                let allSnList = _.union(unisSnList, innoluxSnList);
                _.forEach(allSnList, function (sn) {
                    data.push({
                        "Container #": ctn,
                        "INNOLUX  SN": _.includes(innoluxSnList, sn) ? sn : "",
                        "UNIS SN": _.includes(unisSnList, sn) ? sn : ""
                    })
                })
            }

        });

        return {
            results: {
                data: data,
                head: head
            },
            paging: {
                totalCount: 1,
                pageNo: 1,
                totalPage: 1,
                startIndex: 1,
                endIndex: 1,
            }
        };

    }

    return {
        generateReport
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};