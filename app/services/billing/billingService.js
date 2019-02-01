const userLoginApi = "/api/User/UserLogin",
    importReceivingReportApi = "/api/ClientWorkOrder/ImportReceivingReport",
    importShippingReportApi = "/api/ClientWorkOrder/ImportShippingReport",
    importInventoryReportApi = "/api/ClientWorkOrder/ImportInventoryReport",
    importManualChargeReportApi = "/api/ClientWorkOrder/ImportManualChargeReport",
    getBillingCodeByParameterApi = "/api/ClientWorkOrder/GetBillingCodeByParameter",
    getItemGradeByAccountApi = "/api/ClientWorkOrder/GetItemGradeByAccount",
    getAccountItemsByCustomerApi = "/api/ClientWorkOrder/GetIAItemsByCustomer";

const _ = require('lodash'),
    superagent = require('superagent');

let service = (app, ctx) => {
    let invoiceUser = null,
        billConsignee = "",
        billUserName = "",
        billPassword = "",
        billServerUrl = "",
        billUserId = null,
        billSignToken = null,
        stopBilling = true,
        billCustomerIds = [];

    async function getBillingCode(param) {
        if (!param || !param.customerId) return [];

        let organization = await organizationExtendCollection(ctx).findOne({orgId: param.customerId});
        if (!organization || !organization.customerCode) return [];

        let data = {
            AccountID: organization.customerCode,
            Billto: organization.customerCode,
            BillCategory: "",
            Action: ""
        };
        let response = await postBillingApi(getBillingCodeByParameterApi, data);
        if (response && response.body && response.body.Result) {
            return response.body.Result;
        }
        return [];
    }

    async function getItemGrade() {
        let data = app.systemConf.company;
        let response = await postBillingApi(getItemGradeByAccountApi, data);

        if (response && response.body && response.body.Result) {
            return response.body.Result;
        }
        return [];
    }

    async function getAccountItems(param) {
        if (!param || !param.customerId) return [];

        let organization = await organizationExtendCollection(ctx).findOne({orgId: param.customerId});
        if (!organization || !organization.customerCode) return [];

        let data = {
            Program: "WISE",
            Account: organization.customerCode,
            Site: app.systemConf.facility,
            Tag: param.tag || ""
        };

        let response = await postBillingApi(getAccountItemsByCustomerApi, data);
        if (response && response.body && response.body.Result) {
            return response.body.Result;
        }
        return [];
    }

    async function _getConfiguration() {
        let configurations = await configurationCollection(ctx).find({propertyGroup: "BillingConfiguration"}).toArray();

        let conf = _.find(configurations, conf => conf.propertyName === "userLogin");
        billUserName = conf ? conf.propertyValue : null;

        conf = _.find(configurations, conf => conf.propertyName === "password");
        billPassword = conf ? conf.propertyValue : null;

        conf = _.find(configurations, conf => conf.propertyName === "Consignee");
        billConsignee = conf ? conf.propertyValue : null;

        conf = _.find(configurations, conf => conf.propertyName === "billAndPayHost");
        billServerUrl = conf ? conf.propertyValue : null;

        conf = _.find(configurations, conf => conf.propertyName === "userId");
        billUserId = conf ? conf.propertyValue : null;

        conf = _.find(configurations, conf => conf.propertyName === "signToken");
        billSignToken = conf ? conf.propertyValue : null;

        conf = _.find(configurations, conf => conf.propertyName === "stopBilling");
        stopBilling = conf ? conf.propertyValue : true;

        billCustomerIds = await organizationService(ctx).getBillingCustomers();

        if (!billServerUrl) {
            throw new Error("BillServerUrl is null!");
        }
    }

    async function _billingPlatformLogin() {
        if (billUserId && billSignToken) {
            invoiceUser = {
                userId: billUserId,
                //userName: "LTWiseImport",
                signToken: "APIKey " + billSignToken
            };
        } else {
            let url = billServerUrl + userLoginApi;
            let methodFn = superagent["get"];
            let data = {Username: billUserName, Password: billPassword};
            let response = await methodFn.call(null, url, data).catch(function (error) {
                throw error;
            });

            if (response && response.body && response.body.Result) {
                invoiceUser = {
                    userId: response.body.Result.UserID,
                    //userName: response.body.Result.UserName,
                    signToken: "BasicAuth " + response.body.Result.SignToken
                };
            }
        }
    }

    async function postBillingApi(api, data, isLogined) {
        if (!isLogined) {
            await _getConfiguration();
            await _billingPlatformLogin();
        }

        let url = billServerUrl + api;
        let response = await superagent.post(url)
            .set('Content-Type', 'application/json;charset=UTF-8')
            .set('Authorization', invoiceUser.signToken)
            .send({
                UserID: invoiceUser.userId,
                Data: data
            });
        return response;

    }

    async function sendReport() {
        await _getConfiguration();
        await _billingPlatformLogin();
        if (stopBilling || !invoiceUser) return;

        try {
            await _sendReceivingReport();
        } catch (e) {
            let errorMesg = `${e.message} ${e.stack}`;
            await app.sendMail("Send BillingReceivingReport Fail", errorMesg, null, billConsignee);
        }

        try {
            await _sendShippingReport();
        } catch (e) {
            let errorMesg = `${e.message} ${e.stack}`;
            await app.sendMail("Send BillingShippingReport Fail", errorMesg, null, billConsignee);
        }

        try {
            await _sendInventoryReport();
        } catch (e) {
            let errorMesg = `${e.message} ${e.stack}`;
            await app.sendMail("Send BillingInventoryReport Fail", errorMesg, null, billConsignee);
        }

        try {
            await _sendManualChargeReport();
        } catch (e) {
            let errorMesg = `${e.message} ${e.stack}`;
            await app.sendMail("Send ManualBilling Fail", errorMesg, null, billConsignee);
        }
    }

    async function sendReceivingReport(param) {
        if (!param.receiptIds) return;

        await _getConfiguration();
        await _billingPlatformLogin();
        await _sendReceivingReport(param.receiptIds);
    }

    async function _sendReceivingReport(receiptIds) {
        if (!billCustomerIds || billCustomerIds.length === 0) return;
        console.log(`get receiving report`);
        let param = {
            customerIds: billCustomerIds,
            receiptIds: receiptIds
        };
        let receivingReport = await billingReceivingReportService(ctx).getReport(param);
        if (!receivingReport || receivingReport.length === 0) return;

        await _sendBillingReceivingReport(receivingReport);
    }

    async function sentCrossDockReceivingReport(receiptIds) {
        console.log(`get receiving report`);
        let param = {
            receiptIds: receiptIds,
            takeOutShippedInv: true
        };
        let receivingReport = await billingReceivingReportService(ctx).getReport(param);
        if (!receivingReport || receivingReport.length === 0) return;

        await _getConfiguration();
        await _billingPlatformLogin();
        await _sendBillingReceivingReport(receivingReport);
    }

    async function _sendBillingReceivingReport(receivingReport) {
        let reports = _.chunk(receivingReport, 100);

        let index = 0;
        for (let report of reports) {
            index++;
            console.log(`Send receiving report: ${index} / ${reports.length} ...`);

            let response = await postBillingApi(importReceivingReportApi, report, true);
            if (response && response.body && !response.body.Status) {
                await app.sendMail("Send BillingReceivingReport Fail", response.body.ErrorMsg, null, billConsignee);
            } else {
                await _recordSentBillingReceivingReport(report, response);
            }
        }
    }

    async function _recordSentBillingReceivingReport(report, response) {
        let manuals = [];
        _.forEach(report, rp => {
            manuals.push({
                receiptId: rp.ReceiptID,
                customerId: rp.Customer,
                note: "receiving report",
                type: "Receiving Report",
                status: "Sent",
                invoiceNo: response.body.Result
            });
        })

        try {
            let _ctx = await app.createCtx();
            await wmsApp(_ctx).post("/billing/manual/batch", manuals);
        } catch (ex) {
            let mesg = `InvoiceNo: ${response.body.Result}<br/>${ex.status}<br/>${ex.message}<br/><br/>${ex.stack}<br/><br/>RN: ${_.map(manuals, "receiptId").join(",")}`;
            await app.sendMail("Record Sent Billing Receiving Report Fail", mesg, null, billConsignee);
            throw ex;
        }
    }

    async function sendShippingReport(param) {
        if (!param.orderIds) return;

        await _getConfiguration();
        await _billingPlatformLogin();
        await _sendShippingReport(param.orderIds);
    }

    async function _sendShippingReport(orderIds) {
        if (!billCustomerIds || billCustomerIds.length === 0) return;
        console.log(`get shipping report`);
        let param = {
            customerIds: billCustomerIds,
            orderIds: orderIds
        };
        let shippingReport = await billingShippingReportService(ctx).getReport(param);
        if (!shippingReport || shippingReport.length === 0) return;

        let reports = _.chunk(shippingReport, 20);

        let index = 0;
        for (let report of reports) {
            index++;
            console.log(`Send shipping report: ${index} / ${reports.length} ...`);

            let response = await postBillingApi(importShippingReportApi, report, true);
            if (response && response.body && !response.body.Status) {
                await app.sendMail("Send BillingShippingReport Fail", response.body.ErrorMsg, null, billConsignee);
            } else {
                await _recordSentBillingShippingReport(report, response);
            }
        }
    }

    async function _recordSentBillingShippingReport(report, response) {
        let manuals = [];
        _.forEach(report, rp => {
            manuals.push({
                orderId: rp.OrderID,
                customerId: rp.Customer,
                note: "shipping report",
                type: "Shipping Report",
                status: "Sent",
                invoiceNo: response.body.Result
            });
        })

        try {
            let _ctx = await app.createCtx();
            await wmsApp(_ctx).post("/billing/manual/batch", manuals);
        } catch (ex) {
            let mesg = `InvoiceNo: ${response.body.Result}<br/>${ex.status}<br/>${ex.message}<br/><br/>${ex.stack}<br/><br/>DN: ${_.map(manuals, "orderId").join(",")}`;
            await app.sendMail("Record Sent Billing Shipping Report Fail", mesg, null, billConsignee);
            throw ex;
        }
    }

    async function sendInventoryReport(param) {
        if (!param || !param.date || !param.customerId) return;

        await _getConfiguration();
        await _billingPlatformLogin();

        await _sendInventoryReport(param.date, param.customerId);
    }

    async function _sendInventoryReport(sentDate, customerId) {
        if (!billCustomerIds || billCustomerIds.length === 0) return;
        console.log(`get inventory report`);
        let param = {
            customerIds: billCustomerIds,
            date: sentDate
        };
        if (customerId) {
            param.customerIds = [customerId];
        }
        let reportResult = await billingInventoryReportService(ctx).getReport(param);
        if (!reportResult.data) {
            return;
        }
        let inventoryReport = reportResult.data;
        if (!inventoryReport || inventoryReport.length === 0) return;

        if (!sentDate) {
            param.date = momentZone().format('YYYY-MM-DD') + "_" + (Math.random() * 1000).toFixed(0);
        }
        let reports = _.chunk(inventoryReport, 500);

        let index = 0;
        for (let report of reports) {
            index++;
            console.log(`Send inventory report: ${index} / ${reports.length} ...`);

            let response = await postBillingApi(importInventoryReportApi, report, true);
            if (response && response.body && !response.body.Status) {
                await app.sendMail("Send BillingInventoryReport Fail", response.body.ErrorMsg, null, billConsignee);
            } else {
                await _recordSentBillingInventoryReport(param, response);
            }
        }
    }

    async function _recordSentBillingInventoryReport(param, response) {
        let note = "inventory report";
        if (param.date) note += param.date;

        let manuals = [];
        _.forEach(param.customerIds, customerId => {
            manuals.push({
                note: note,
                customerId: customerId,
                type: "Inventory Report",
                status: "Sent",
                invoiceNo: response.body.Result
            });
        })

        try {
            let _ctx = await app.createCtx();
            await wmsApp(_ctx).post("/billing/manual/batch", manuals);
        } catch (ex) {
            let mesg = `InvoiceNo: ${response.body.Result}<br/>${ex.status}<br/>${ex.message}<br/><br/>${ex.stack}<br/>`;
            await app.sendMail("Record Sent Billing Inventory Report Fail", mesg, null, billConsignee);
            throw ex;
        }
    }

    async function sendManualChargeReport(param) {
        if (!param.ids) return;

        await _getConfiguration();
        await _billingPlatformLogin();

        await _sendManualChargeReport(param.ids);
    }

    async function _sendManualChargeReport(ids) {
        console.log(`get manual charge report`);
        let {billingManuals, manualBillings} = await billingManualChargeReportService(ctx).getReport(ids);
        if (!manualBillings || manualBillings.length === 0) return;

        let reports = _.chunk(manualBillings, 1000);

        console.log(`Manual billing report total: ${reports.length}`);
        let index = 0;
        for (let report of reports) {
            index++;
            console.log(`Send manual billing report: ${index} / ${reports.length} ...`);

            let response = await postBillingApi(importManualChargeReportApi, report, true);
            if (response && response.body && !response.body.Status) {
                await app.sendMail("Send ManualBilling Fail", response.body.ErrorMsg, null, billConsignee);
            } else {
                await _updateBillingManualStatus(report, billingManuals, response);
            }
        }
    }

    async function _updateBillingManualStatus(report, billingManuals, response) {
        let manuals = [];
        _.forEach(report, rp => {
            let bms = _.filter(billingManuals, manual => manual.receiptId === rp.ReceiptID || manual.orderId === rp.OrderID);
            _.forEach(bms, bm => {
                manuals.push({
                    id: bm._id.toString(),
                    status: "Sent",
                    invoiceNo: response.body.Result
                });
            })
        });

        try {
            let _ctx = await app.createCtx();
            await wmsApp(_ctx).post("/billing/manual/batch", manuals);
        } catch (ex) {
            let mesg = `${ex.status}<br/>${ex.message}<br/>${ex.stack}<br/>ID: ${_.map(manuals, "id").join(",")}`;
            await app.sendMail("Update Billing Manual Status Fail", mesg, null, billConsignee);
            throw ex;
        }
    }


    return {
        postBillingApi,
        getBillingCode,
        getItemGrade,
        getAccountItems,
        sendReport,
        sendReceivingReport,
        sendShippingReport,
        sendInventoryReport,
        sendManualChargeReport,
        sentCrossDockReceivingReport
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
