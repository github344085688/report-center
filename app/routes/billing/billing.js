module.exports = function (app) {
    router.get('/billing/send-report', async (ctx, next) => {
        ctx.body = await billingService(ctx).sendReport();
    });

    router.post('/billing/send-receiving-report', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await billingService(ctx).sendReceivingReport(param);
    });
    router.post('/billing/send-shipping-report', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await billingService(ctx).sendShippingReport(param);
    });
    router.post('/billing/send-inventory-report', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await billingService(ctx).sendInventoryReport(param);
    });
    router.post('/billing/send-manual-charge-report', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await billingService(ctx).sendManualChargeReport(param);
    });

    router.get('/billing/transfer-type-from-crossDock', async (ctx, next) => {
        ctx.body = await transferTypeFromCrossDockService(ctx).transferTypeFromCrossDock();
    });

    router.post('/billing/get-receiving-report', async (ctx, next) => {
        let param = ctx.request.body;
        if (!param.receiptIds || param.receiptIds.length === 0) {
            throw new BadRequestError('ReceiptIds can not be empty.');
        }
        ctx.body = await billingReceivingReportService(ctx).getReport(param);
    });
    router.post('/billing/get-shipping-report', async (ctx, next) => {
        let param = ctx.request.body;
        if (!param.orderIds || param.orderIds.length === 0) {
            throw new BadRequestError('OrderIds can not be empty.');
        }
        ctx.body = await billingShippingReportService(ctx).getReport(param);
    });
    router.post('/billing/get-inventory-report', async (ctx, next) => {
        let param = ctx.request.body;
        if (!param.date) {
            throw new BadRequestError('Date can not be empty.');
        }
        if (!param.customerIds || param.customerIds.length === 0) {
            throw new BadRequestError('CustomerIds can not be empty.');
        }
        let result = await billingInventoryReportService(ctx).getReport(param);
        ctx.body = result.data;
    });

    router.post('/billing/inventory-report/download', async (ctx, next) => {
        let param = ctx.request.body;
        if (!param.date) {
            throw new BadRequestError('Date can not be empty.');
        }
        if (!param.customerIds || param.customerIds.length === 0) {
            throw new BadRequestError('CustomerIds can not be empty.');
        }
        let reportData = await billingInventoryReportService(ctx).getReport(param);

        await app.downLoadJsonExcel(ctx, reportData);
    });

    router.post('/billing/get-billing-code', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await billingService(ctx).getBillingCode(param);
    });

    router.post('/billing/get-account-items', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await billingService(ctx).getAccountItems(param);
    });

    router.get('/billing/get-item-grade', async (ctx, next) => {
        ctx.body = await billingService(ctx).getItemGrade();
    });

    router.post('/billing/picked-data/search-by-paging', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await billingPickedDataService(ctx).searchByPaging(param);
    });
    router.post('/billing/picked-data/download', async (ctx, next) => {
        let param = ctx.request.body;
        let reportData = await commonService(ctx).getAllPages(billingPickedDataService(ctx).searchByPaging, param);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/billing/sync-facility', async (ctx, next) => {
        ctx.body = await billingSyncDataService(ctx).syncFacilities();
    });
    router.post('/billing/sync-customer', async (ctx, next) => {
        ctx.body = await billingSyncDataService(ctx).syncCustomers();
    });
    router.post('/billing/sync-materials', async (ctx, next) => {
        ctx.body = await billingSyncDataService(ctx).syncMaterials();
    });
    router.post('/billing/sync-items', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await billingSyncDataService(ctx).syncItems(param);
    });


    router.post('/billing/check/search-by-paging', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await billingCheckReportService(ctx).searchByPaging(param);
    });

    router.post('/billing/check/download', async (ctx, next) => {
        let param = ctx.request.body;
        let reportData = await commonService(ctx).getAllPages(billingCheckReportService(ctx).searchByPaging, param);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/billing/call-bill-pay-api', async (ctx, next) => {
        let param = ctx.request.body;
        let response;
        if (!param.api) {
            throw new BadRequestError("Api must not be null!");
        }
        if (param.data.CompanyIDs) {
            let result=[];
            let res;

            for (let CompanyID of param.data.CompanyIDs) {
                param.data.CompanyID = CompanyID;
                res = await billingService(ctx).postBillingApi(param.api, param.data);
                let jsonText = JSON.parse(res.text);
                result = [result,...jsonText.Result]
            }
            response= res;
            response.Result=result;
        } else {
            response = await billingService(ctx).postBillingApi(param.api, param.data);
        }

        ctx.body = response && response.body ? response.body : response;
    });

    router.post('/billing/call-bill-pay-api/download', async (ctx, next) => {
        let param = ctx.request.body;
        let reportData = await  commonService(ctx).getAllPageDataFromBillingCallBillPay( param);
        await app.downLoadJsonExcel(ctx, reportData);
    });
};