module.exports = function (app) {

    router.post('/inventory/adjustment-report/search-by-paging', async (ctx, next) => {
        ctx.body = await inventoryAdjustmentReportService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/inventory/adjustment-report/download', async (ctx, next) => {
        let response = await commonService(ctx).getAllPages(inventoryAdjustmentReportService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, response.results);
    });

    router.post('/inventory/aging-report/search-by-paging', async (ctx, next) => {
        ctx.body = await inventoryAgingReportService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/inventory/aging-report/download', async (ctx, next) => {
        let response = await commonService(ctx).getAllPages(inventoryAgingReportService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, response.results);
    });

    /*
     * param: {
     *   customerId: "ORG-3",
     *   itemSpecIds: [],
     *   timeFrom: "",
     *   timeTo: ""
     * }
     * */
    router.post('/inventory/balance-report/search-by-paging', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await inventoryBalanceReportService(ctx).searchByPaging(param);
    });
    router.post('/inventory/balance-report/download', async (ctx, next) => {
        let param = ctx.request.body;
        let report = await commonService(ctx).getAllPages(inventoryBalanceReportService(ctx).searchByPaging, param);
        await app.downLoadJsonExcel(ctx, report.results);
    });

    router.post('/inventory/status-report/search-by-paging', async (ctx, next) => {
        ctx.body = await inventoryStatusReportService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/inventory/status-report/download', async (ctx, next) => {
        let response = await commonService(ctx).getAllPages(inventoryStatusReportService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, response.results);
    });

    router.post('/inventory/empty-location-report/searchByPaging', async (ctx, next) => {
        ctx.body = await emptyLocationService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/inventory/empty-location-report/download', async (ctx, next) => {
        let response = await commonService(ctx).getAllPages(emptyLocationService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, response.results);
    });

    router.post('/inventory/item-error-distributed/searchByPaging', async (ctx, next) => {
        ctx.body = await itemErrorDistributedService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/inventory/item-error-distributed/download', async (ctx, next) => {
        let response = await commonService(ctx).getAllPages(itemErrorDistributedService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, response.results);
    });

    router.post('/inventory/status-report/lp-detail', async (ctx, next) => {
        /*
         param:{
         "statuses":["PICKED","PACKED","LOADED"],
         "customerId":"ORG-7931",
         "titleId":"ORG-7931",
         "itemSpecId":"ITEM-19874",
         "unitId":"5b437100c9e77c0009cb709c"
         }
         statuses:
         allocated status : "PICKED","PACKED","LOADED"
         available status: "AVAILABLE"
         damaged status: "DAMAGE"
         onhold status: "ON_HOLD"
         */

        let param = ctx.request.body;
        ctx.body = await inventoryService(ctx).searchLpDetails(param);
    });

    router.post('/inventory/overall-report/search-by-paging', async (ctx, next) => {
        ctx.body = await inventoryOverallReportService(ctx).getPagingReportDataForView(ctx.request.body);
    });
    router.post('/inventory/overall-report/download', async (ctx, next) => {
        let reportData = await inventoryOverallReportService(ctx).getAllPagesForDownload(ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData);
    });

    /*
     criteria: customerId, titleId, itemKeyword(itemName , UPC, description), lotNo, reportCategory, headerList
     */
    router.post('/inventory/status-report-v2/search-by-paging', async (ctx, next) => {
        ctx.body = await inventoryStatusReportServiceV2(ctx).searchStatusInventoryByPaging(ctx.request.body);
    });
    router.post('/inventory/status-report-v2/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(inventoryStatusReportServiceV2(ctx).searchStatusInventoryByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData, ctx.request.body.reportCategory);
    });
    /*
     criteria: customerId, titleId, itemKeyword(itemName , UPC, description), lotNo, reportCategory, headerList,statuses
     */
    router.post('/inventory/status-report-item-detail/search-by-paging', async (ctx, next) => {
        ctx.body = await inventoryStatusReportServiceV2(ctx).searchItemDetailInventoryByPaging(ctx.request.body);
    });
    router.post('/inventory/status-report-item-detail/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(inventoryStatusReportServiceV2(ctx).searchItemDetailInventoryByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });
    /*
     criteria: itemKeyword
     */
    router.post('/inventory/aging-report-v2/search-by-paging', async (ctx, next) => {
        ctx.body = await inventoryAgingReportServiceV2(ctx).searchByPaging(ctx.request.body);
    });
    router.post('/inventory/aging-report-v2/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(inventoryAgingReportServiceV2(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });

    router.post(`/inventory/aging-report-receipt-level`, async (ctx, next) => {
        ctx.body = await inventoryAgingReceiptLevelReport(ctx).getReport(ctx.request.body);
    });
    router.post(`/inventory/aging-report-receipt-level/download`, async (ctx, next) => {
        let reportData = await inventoryAgingReceiptLevelReport(ctx).getReport(ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    /*
     criteria: itemKeyword,types,lpIds,startTime,endTime, timeFrom, timeTo, see AdjustmentSearch below for more details
     */
    router.post('/inventory/adjustment-report-v2/search-by-paging', async (ctx, next) => {
        ctx.body = await inventoryAdjustmentReportServiceV2(ctx).searchByPaging(ctx.request.body);
    });
    router.post('/inventory/adjustment-report-v2/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(inventoryAdjustmentReportServiceV2(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });

    router.post(`/inventory/turns/search`, async (ctx, next) => {
        ctx.body = await inventoryTurnsReportService(ctx).search(ctx.request.body);
    });

    router.post(`/inventory/turns/download`, async (ctx, next) => {
        let reportData = await inventoryTurnsReportService(ctx).search(ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

};
