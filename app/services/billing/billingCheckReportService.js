
let service = (app, ctx) => {

    function _validateSearchParam(param) {
        if (!param.type) {
            throw new BadRequestError("Type must not be empty!");
        }
    }

    async function searchByPaging(param) {
        _validateSearchParam(param);

        if (param.type === "InBound") {
            return searchInboundReport(param);

        } else if (param.type === "OutBound") {
            return searchOutboundReport(param);

        } else if (param.type === "Manual") {
            return searchManualBillingReport(param);
        }
    }

    function _buildEmptyResult() {
        return {
            results: {
                data: [],
                head: []
            },
            paging: {}
        }
    }

    async function searchInboundReport(param) {
        param = param || {};
        param.statues = ["CLOSED", "FORCE_CLOSED", "REOPENED"];

        if (param.status) {
            let sentIds = await billingManualCollection(ctx).distinct("receiptId", {type: "RECEIVE_REPORT"});
            if (param.status === "Sent") {
                param.receiptIds = _.isEmpty(param.receiptIds) ? sentIds : _.intersection(param.receiptIds, sentIds);
                if (param.receiptIds.length === 0) return _buildEmptyResult();
            }
            if (param.status === "UnSend") {
                param.idNin = sentIds;
            }
        }
        if (param.customerId) {
            let ids = await receiptCollection(ctx).distinct("_id", {customerId:param.customerId});
            param.receiptIds = _.isEmpty(param.receiptIds) ? ids : _.intersection(param.receiptIds, ids);
            if (param.receiptIds.length === 0) return _buildEmptyResult();
        }

        let receiptSearch = new ReceiptSearch(param);
        let option = receiptSearch.buildClause();
        let receiptRes = await receiptCollection(ctx).findByPaging(option, {projection: {status:1,customerId:1,devannedTime:1,containerSize:1,trailerSize:1},sort:{devannedTime:-1}});
        let receipts = receiptRes.results;
        if (!receipts || receipts.length === 0) return _buildEmptyResult();

        let customerIds = _.map(receipts, "customerId");
        let customers = await organizationCollection(ctx).query({_id:{$in:customerIds}});
        let customerMap = _.keyBy(customers, "_id");

        let receiptIds = _.map(receipts, "_id");
        let [billings, reports, invoices] = await Promise.all([
            billingManualCollection(ctx).query({receiptId:{$in:receiptIds},type: "RECEIVE_REPORT"}),
            billingReceivingReportService(ctx).getReport({receiptIds:receiptIds}),
            invoicedRecordCollection(ctx).query({receiptId:{$in:receiptIds}})
        ]);
        let invoiceMap = _.keyBy(invoices, "receiptId");

        let billingGroups = _.groupBy(billings, "receiptId");
        let reportMap = _.keyBy(reports, "ReceiptID");

        let data = [];
        _.forEach(receipts, receipt => {
            let customer = customerMap[receipt.customerId];
            let billing = billingGroups[receipt._id] ? billingGroups[receipt._id][0] : null;
            let report = reportMap[receipt._id] ? reportMap[receipt._id] : null;
            let lpCount = 0;
            let lps = [];
            if (report) {
                _.forEach(report.ItemLine, line => {
                    lpCount += line.LPS.length;
                    lps = _.union(lps, line.LPS);
                })
            }
            let invoice = invoiceMap[receipt._id];

            data.push({
                "ID": receipt._id,
                "Customer": customer ? customer.name : "",
                "Status": receipt.status,
                "DevannedTime": receipt.devannedTime ? momentZone(receipt.devannedTime).format('YYYY-MM-DD HH:mm:ss') : "",
                "Billing": billing && billing.status === "SENT" ? "SENT" : "",
                "SentTime": billing && billing.status === "SENT" ? momentZone(billing.sentWhen).format('YYYY-MM-DD HH:mm:ss') : "",
                "LP Count": lpCount,
                "ContainerSize": receipt.containerSize,
                "TrailerSize": receipt.trailerSize,
                "OffloadType": report ? report.OffloadType : "",
                "ShipMethod": report ? report.ShipMethod : "",
                "InvoiceNo": invoice ? invoice.invoiceNo : "",
                "InvoiceDate": invoice ? invoice.invoiceDate : "",
                "Materials": report ? report.MaterialLine : [],
                "LPs": lps
            });
        })

        return {
            results: {
                data: data,
                head: [
                    "ID",
                    "Customer",
                    "Status",
                    "DevannedTime",
                    "Billing",
                    "SentTime",
                    "LP Count",
                    "ContainerSize",
                    "TrailerSize",
                    "OffloadType",
                    "ShipMethod",
                    "InvoiceNo",
                    "InvoiceDate"
                ]
            },
            paging: receiptRes.paging
        };
    }

    async function searchOutboundReport(param) {
        param = param || {};
        param.statues = ["SHIPPED", "SHORT_SHIPPED", "PARTIAL_SHIPPED", "REOPEN"];

        if (param.status) {
            let sentIds = await billingManualCollection(ctx).distinct("orderId", {type: "SHIP_REPORT"});
            if (param.status === "Sent") {
                param.orderIds = _.isEmpty(param.orderIds) ? sentIds : _.intersection(param.orderIds, sentIds);
                if (param.orderIds.length === 0) return _buildEmptyResult();
            }
            if (param.status === "UnSend") {
                param.idNin = sentIds;
            }
        }
        if (param.customerId) {
            let ids = await orderCollection(ctx).distinct("_id", {customerId:param.customerId});
            param.orderIds = _.isEmpty(param.orderIds) ? ids : _.intersection(param.orderIds, ids);
            if (param.orderIds.length === 0) return _buildEmptyResult();
        }

        let orderSearch = new OrderSearch(param);
        let option = orderSearch.buildClause();
        let orderRes = await orderCollection(ctx).findByPaging(option, {projection: {customerId:1,status:1,shippedTime:1},sort:{shippedTime:-1}});
        let orders = orderRes.results;
        if (!orders || orders.length === 0) return _buildEmptyResult();

        let customerIds = _.map(orders, "customerId");
        let customers = await organizationCollection(ctx).query({_id:{$in:customerIds}});
        let customerMap = _.keyBy(customers, "_id");

        let orderIds = _.map(orders, "_id");
        let [billings, reports, invoices] = await Promise.all([
            billingManualCollection(ctx).query({orderId:{$in:orderIds},type: "SHIP_REPORT"}),
            billingShippingReportService(ctx).getReport({orderIds:orderIds}),
            invoicedRecordCollection(ctx).query({orderId:{$in:orderIds}})
        ]);
        let billingGroups = _.groupBy(billings, "orderId");
        let reportMap = _.keyBy(reports, "OrderID");
        let invoiceMap = _.keyBy(invoices, "orderId");

        let data = [];
        _.forEach(orders, order => {
            let billing = billingGroups[order._id] ? billingGroups[order._id][0] : null;
            let report = reportMap[order._id] ? reportMap[order._id] : null;
            let customer = customerMap[order.customerId];
            let palletPickQty = 0;
            let casePickQty = 0;
            let innerPickQty = 0;
            let piecePickQty = 0;
            let lps = [];
            if (report) {
                _.forEach(report.ItemLine, line => {
                    palletPickQty += line.PalletPickQty;
                    casePickQty += line.CasePickQty;
                    innerPickQty += line.InnerPickQty;
                    piecePickQty += line.PiecePickQty;
                    lps = _.union(lps, line.LPS);
                })
            }
            let invoice = invoiceMap[order._id];

            data.push({
                "ID": order._id,
                "Customer": customer ? customer.name : "",
                "Status": order.status,
                "ShippedTime": order.shippedTime ? momentZone(order.shippedTime).format('YYYY-MM-DD HH:mm:ss') : "",
                "Billing": billing && billing.status === "SENT" ? "SENT" : "",
                "SentTime": billing && billing.status === "SENT" ? momentZone(billing.sentWhen).format('YYYY-MM-DD HH:mm:ss') : "",
                "PalletPickQty": palletPickQty,
                "CasePickQty": casePickQty,
                "InnerPickQty": innerPickQty,
                "PiecePickQty": piecePickQty,
                "InvoiceNo": invoice ? invoice.invoiceNo : "",
                "InvoiceDate": invoice ? invoice.invoiceDate : "",
                "Materials": report ? report.MaterialLine : [],
                "LPs": lps
            })
        })

        return {
            results: {
                data: data,
                head: [
                    "ID",
                    "Customer",
                    "Status",
                    "ShippedTime",
                    "Billing",
                    "SentTime",
                    "PalletPickQty",
                    "CasePickQty",
                    "InnerPickQty",
                    "PiecePickQty",
                    "InvoiceNo",
                    "InvoiceDate"
                ]
            },
            paging: orderRes.paging
        };
    }

    async function searchManualBillingReport(param) {
        param = param || {};
        param.type = "WEB_MANUAL";
        param.qtyGt = 0;
        if (param.status === "Sent") {
            param.statusEq = "SENT";
        }
        if (param.status === "UnSend") {
            param.statusNe = "SENT";
        }

        let receiptIds, orderIds;
        if (param.customerId) {
            receiptIds = await receiptCollection(ctx).distinct("_id", {customerId:param.customerId});
            receiptIds = _.isEmpty(param.receiptIds) ? receiptIds : _.intersection(param.receiptIds, receiptIds);
            delete param.receiptIds;

            orderIds = await orderCollection(ctx).distinct("_id", {customerId:param.customerId});
            orderIds = _.isEmpty(param.orderIds) ? orderIds : _.intersection(param.orderIds, orderIds);
            delete param.orderIds;

            if (!receiptIds && !orderIds) return _buildEmptyResult();
        }

        let manulSearch = new BillingManulSearch(param);
        let option = manulSearch.buildClause();
        if (receiptIds && orderIds) {
            option.$or = [{receiptId:{$in:receiptIds}},{orderId:{$in:orderIds}}];
        } else if (receiptIds) {
            option.receiptId = {$in:receiptIds};
        } else if (orderIds) {
            option.orderId = {$in:orderIds};
        }

        let manualRes = await billingManualCollection(ctx).findByPaging(option,{sort:{createdWhen:-1}});
        let manuals = manualRes.results;

        let manualOrderIds = _.concat(_.uniq(_.map(manuals, "orderId")));
        let manualReceiptIds = _.concat(_.uniq(_.map(manuals, "receiptId")));
        let [orders, receipts, invoices] = await Promise.all([
            orderCollection(ctx).query({_id:{$in:manualOrderIds}},{projection: {status:1}}),
            receiptCollection(ctx).query({_id:{$in:manualReceiptIds}},{projection: {status:1}}),
            invoicedRecordCollection(ctx).query({$or:[{orderId:{$in:manualOrderIds}},{receiptId:{$in:manualReceiptIds}}]})
        ]);
        let orderMap = _.keyBy(orders, "_id");
        let receiptMap = _.keyBy(receipts, "_id");
        let orderInvoiceMap = _.keyBy(_.filter(invoices, invoice => invoice.orderId), "orderId");
        let receiptInvoiceMap = _.keyBy(_.filter(invoices, invoice => invoice.receiptId), "receiptId");

        let data = [];
        _.forEach(manuals, manual => {
            let order = orderMap[manual.orderId];
            let receipt = receiptMap[manual.receiptId];
            let orderInvoice = orderInvoiceMap[manual.orderId];
            let receiptInvoice = receiptInvoiceMap[manual.receiptId];
            data.push({
                "ID": manual._id,
                "type": manual.type,
                "ReceiptID": manual.receiptId || "",
                "OrderID": manual.orderId || "",
                "Status": order ? order.status : (receipt ? receipt.status : ""),
                "BillingCode": manual.billingCode || "",
                "BillingDesc": manual.billingDesc || "",
                "BillingUom": manual.billingUom || "",
                "Note": manual.note || "",
                "UnitPrice": manual.unitPrice || "",
                "QTY": manual.qty || "",
                "Billing": manual.status === "SENT" ? "SENT" : "",
                "SentTime": manual.status === "SENT" ? momentZone(manual.sentWhen).format('YYYY-MM-DD HH:mm:ss') : "",
                "CreatedWhen": momentZone(manual.createdWhen).format('YYYY-MM-DD HH:mm:ss'),
                "InvoiceNo": orderInvoice ? orderInvoice.invoiceNo : (receiptInvoice ? receiptInvoice.invoiceNo : ""),
                "InvoiceDate": orderInvoice ? orderInvoice.invoiceDate : (receiptInvoice ? receiptInvoice.invoiceDate : "")
            })
        })

        return {
            results: {
                data: data,
                head: [
                    "ReceiptID",
                    "OrderID",
                    "Status",
                    "BillingCode",
                    "BillingDesc",
                    "BillingUom",
                    "Note",
                    "UnitPrice",
                    "QTY",
                    "Billing",
                    "SentTime",
                    "CreatedWhen",
                    "InvoiceNo",
                    "InvoiceDate"
                ]
            },
            paging: manualRes.paging
        };
    }

    class ReceiptSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                receiptIds: new MongoOperator('$in', '_id'),
                idNin: new MongoOperator('$nin', '_id'),
                statues: new MongoOperator('$in', 'status'),
                customerId: new MongoOperator('$eq', 'customerId'),
                timeFrom: new MongoOperator('$gte', 'devannedTime', 'Date'),
                timeTo: new MongoOperator('$lte', 'devannedTime', 'Date')
            };
        }
    }
    class OrderSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                orderIds: new MongoOperator('$in', '_id'),
                idNin: new MongoOperator('$nin', '_id'),
                statues: new MongoOperator('$in', 'status'),
                customerId: new MongoOperator('$eq', 'customerId'),
                timeFrom: new MongoOperator('$gte', 'shippedTime', 'Date'),
                timeTo: new MongoOperator('$lte', 'shippedTime', 'Date')
            };
        }
    }
    class BillingManulSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                type: new MongoOperator('$eq', 'type'),
                statusEq: new MongoOperator('$eq', 'status'),
                statusNe: new MongoOperator('$ne', 'status'),
                receiptIds: new MongoOperator('$in', 'receiptId'),
                orderIds: new MongoOperator('$in', 'orderId'),
                qtyGt: new MongoOperator('$gt', 'qty'),
                timeFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                timeTo: new MongoOperator('$lte', 'createdWhen', 'Date')
            };
        }
    }

    return {
        searchByPaging
    };
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};