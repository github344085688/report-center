const ObjectID = require('mongodb-core').BSON.ObjectID;

let service = (app, ctx) => {

    function _buildReceiptManualBilling(billingGroupByReceipt, receiptMap, organizationMap, manualBillings) {
        _.forEach(billingGroupByReceipt, (billings, receiptId) => {
            let receipt = receiptMap[receiptId];
            if (!receipt) return;
            let customer = organizationMap[receipt.customerId];
            let manualBilling = {
                Company: app.systemConf.company,
                Facility: app.systemConf.facility,
                Customer: customer ? (customer.customerCode ? customer.customerCode : customer.name) : "",
                ReceiptID: receiptId,
                DevannedDate: receipt.devannedTime ? momentZone(receipt.devannedTime).format('YYYY-MM-DD HH:mm:ss') : "",
                BillingCode: []
            };
            _.forEach(billings, billing => {
                manualBilling.BillingCode.push({
                    BillingCode: billing.billingCode,
                    BillingQty: billing.qty,
                    Notes: billing.note
                });
            })
            manualBillings.push(manualBilling);
        })
    }

    function _buildOrderManualBilling(billingGroupByOrder, orderMap, organizationMap, manualBillings) {
        _.forEach(billingGroupByOrder, (billings, orderId) => {
            let order = orderMap[orderId];
            if (!order) return;
            let customer = organizationMap[order.customerId];
            let manualBilling = {
                Company: app.systemConf.company,
                Facility: app.systemConf.facility,
                Customer: customer ? (customer.customerCode ? customer.customerCode : customer.name) : "",
                OrderID: orderId,
                ShippedDate: order.shippedTime ? momentZone(order.shippedTime).format('YYYY-MM-DD HH:mm:ss') : "",
                BillingCode: []
            };
            _.forEach(billings, billing => {
                manualBilling.BillingCode.push({
                    BillingCode: billing.billingCode,
                    BillingQty: billing.qty,
                    Notes: billing.note
                });
            })
            manualBillings.push(manualBilling);
        })
    }

    async function getReport(ids) {
        let search = {
            type: "WEB_MANUAL",
            status: "READY_TO_BILL",
            qty: {$gt:0}
        };
        if (ids) {
            search._id = {$in:_.map(ids, id => new ObjectID(id))};
        }

        let billingManuals = await billingManualCollection(ctx).find(search).toArray();
        if (!billingManuals || billingManuals.length === 0) {
            return {
                billingManuals: [],
                manualBillings: []
            };
        }

        let receiptIds = _.compact(_.uniq(_.map(billingManuals, "receiptId")));
        let orderIds = _.compact(_.uniq(_.map(billingManuals, "orderId")));
        let receipts = await receiptCollection(ctx).find({
            _id: {$in: receiptIds},
            status: {$in: ["CLOSED", "FORCE_CLOSED"]}
        }, tabelFieldMap.receiptFields).toArray();
        let orders = await orderCollection(ctx).find({
            _id: {$in: orderIds},
            status: {$in: ["SHIPPED", "PARTIAL_SHIPPED","SHORT_SHIPPED"]}
        }, tabelFieldMap.orderFields).toArray();
        let receiptMap = _.keyBy(receipts, "_id");
        let orderMap = _.keyBy(orders, "_id");

        let receiptCustomerIds = _.compact(_.uniq(_.map(_.filter(receipts, receipt => receipt.customerId), "customerId")));
        let orderCustomerIds = _.compact(_.uniq(_.map(_.filter(orders, order => order.customerId), "customerId")));
        let organizationIds = _.uniq(_.union(receiptCustomerIds, orderCustomerIds));
        let organizationMap = await organizationService(ctx).getOrganizationMap(organizationIds);

        let billingGroupByReceipt = _.groupBy(_.filter(billingManuals, billing => billing.receiptId), "receiptId");
        let billingGroupByOrder = _.groupBy(_.filter(billingManuals, billing => billing.orderId), "orderId");

        let manualBillings = [];
        _buildReceiptManualBilling(billingGroupByReceipt, receiptMap, organizationMap, manualBillings);
        _buildOrderManualBilling(billingGroupByOrder, orderMap, organizationMap, manualBillings);

        return {billingManuals,manualBillings};
    }

    return {
        getReport
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};