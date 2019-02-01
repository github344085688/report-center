const _ = require('lodash');

let service = (app, ctx) => {
    async function transferTypeFromCrossDock() {
        let customerIds = await organizationService(ctx).getBillingCustomers();
        if (!customerIds || customerIds.length === 0) return;

        let customerMap = await organizationService(ctx).getOrganizationMap(customerIds);
        for (let customerId of customerIds) {
            await _transferTypeFromCrossDock(customerMap[customerId]);
        }
    }

    async function _transferTypeFromCrossDock(customer) {
        if (!customer || !customer.storageFreeOfChargeHours) return;

        let startTime = momentZone().add(0 - customer.storageFreeOfChargeHours, 'hours').format('YYYY-MM-DD HH:mm:ss');
        let receipts = await receiptCollection(ctx).find({
            customerId: customer.id,
            status: {$in: ["CLOSED", "FORCE_CLOSED", "REOPENED"]},
            receiptType: "CD",
            devannedTime: {
                $lte: new Date(momentZone(startTime).format())
            }
        }, {projection:{_id:1}}).toArray();
        if (!receipts || receipts.length === 0) return;

        let receiptIds = _.map(receipts, "_id");
        let receiptIdStr = `'${receiptIds.join("','")}'`;
        let invs = await wmsMysql(ctx).query(`select distinct receiptId from inventory where qty>0 and status in('AVAILABLE','ON_HOLD') and receiptId in(${receiptIdStr})`);
        let unShippedReceiptIds = _.map(invs, "receiptId");
        if (!unShippedReceiptIds || unShippedReceiptIds.length === 0) return;

        await billingService(ctx).sentCrossDockReceivingReport(unShippedReceiptIds);

        let _ctx = await app.createCtx();
        for (let receiptId of unShippedReceiptIds) {
            await wmsApp(_ctx).put(`/inbound/receipt/${receiptId}`, {
                receiptType: "Regular Receipt"
            });
        }
    }

    return {
        transferTypeFromCrossDock
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};