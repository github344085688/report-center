module.exports = function (app) {
    router.post('/inbound/contain-damage-lp-report/search-by-paging', async (ctx, next) => {
        ctx.body = await containDamageLPReportService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/inbound/contain-damage-lp-report/download', async (ctx, next) => {
        let reportData = await containDamageLPReportService(ctx).searchByPaging(ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/inbound/inbound-report/receipt-level/search-by-paging', async (ctx, next) => {
        ctx.body = await inboundReportService(ctx).searchByPagingForReceiptLevel(ctx.request.body);
    });

    router.post('/inbound/inbound-report/receipt-level/download', async (ctx, next) => {
        let downloadData = await inboundReportService(ctx).buildDownloadDataForReceiptLevel(ctx.request.body);
        await app.downLoadJsonExcel(ctx, downloadData);
    });

    router.post('/inbound/inbound-report/item-level/search-by-paging', async (ctx, next) => {
        ctx.body = await inboundReportService(ctx).searchByPagingForItemLevel(ctx.request.body);
    });

    router.post('/inbound/inbound-report/item-level/download', async (ctx, next) => {
        let downloadData = await inboundReportService(ctx).buildDownloadDataForItemLevel(ctx.request.body);
        await app.downLoadJsonExcel(ctx, downloadData);
    });

    router.post('/inbound/inbound-report/lp-level/download', async (ctx, next) => {
        let downloadData = await inboundReportService(ctx).buildDownloadDataForLPLevel(ctx.request.body);
        await app.downLoadJsonExcel(ctx, downloadData);
    });

    router.post('/inbound/inbound-report/sn-level/download', async (ctx, next) => {
        let downloadData = await inboundReportService(ctx).buildDownloadDataForSnLevel(ctx.request.body);
        await app.downLoadJsonExcel(ctx, downloadData);
    });

    router.post('/inbound/inbound-report/cng-sn-level/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(inboundCNGSnLevelReportService(ctx).searchByPagingForCNGSnLevel, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/inbound/inbound-report/cng-sn-level/search', async (ctx, next) => {
        ctx.body = await commonService(ctx).getAllPages(inboundCNGSnLevelReportService(ctx).searchByPagingForCNGSnLevel, ctx.request.body);
    });

    /*
     criteria:
     "keyword": receiptId,PONO,RefNo,ContainerNo,
     "itemKeyword":Item ID,  UPC code, AKA value
     "customerId","createdWhenFrom","createdWhenTo","appointmentTimeFrom","appointmentTimeTo","createdWhenFrom","createdWhenTo","inYardTimeFrom",
     "inYardTimeTo","closeTimeFrom","closeTimeTo","statuses"
     "headerList",
     "reportCategory":"INBOUND_INQUIRY_ALL",
     "paging":{"pageNo":1,"limit":10},
     */
    router.post('/inbound/inbound-inquiry-report/receipt-level/search-by-paging', async (ctx, next) => {
        ctx.body = await inboundInquiryReportService(ctx).inquiryReportSearchByPaging(ctx.request.body);
    });
    router.post('/inbound/inbound-inquiry-report/receipt-level/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(inboundInquiryReportService(ctx).inquiryReportSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });
    /*
     criteria: same as above
     */
    router.post('/inbound/inbound-inquiry-report/item-level/search-by-paging', async (ctx, next) => {
        ctx.body = await inboundInquiryReportService(ctx).itemLevelInquiryReportSearchByPaging(ctx.request.body);
    });
    router.post('/inbound/inbound-inquiry-report/item-level/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(inboundInquiryReportService(ctx).itemLevelInquiryReportSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });
    /*
     criteria: same as above
     */
    router.post('/inbound/inbound-inquiry-report/id-level/search-by-paging', async (ctx, next) => {
        ctx.body = await inboundInquiryReportService(ctx).idLevelInquiryReportSearchByPaging(ctx.request.body);
    });
    router.post('/inbound/inbound-inquiry-report/id-level/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(inboundInquiryReportService(ctx).idLevelInquiryReportSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });

    /*
     criteria: itemSpecId, unitId, receiptId,itemSpecIds, unitIds, receiptIds, titleId, supplierId
     */
    router.post('/inbound/inbound-inquiry-report/carton-level/search', async (ctx, next) => {
        ctx.body = await inboundInquiryReportService(ctx).cartonLevelInquiryReport(ctx.request.body);
    });
    router.post('/inbound/inbound-inquiry-report/carton-level/download', async (ctx, next) => {
        let reportData = await inboundInquiryReportService(ctx).cartonLevelInquiryReport(ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });
    /*
     criteria: same as above
     */
    router.post('/inbound/inbound-inquiry-report/expanding/search-by-paging', async (ctx, next) => {
        ctx.body = await inboundInquiryReportService(ctx).expandingInquiryReportSearchByPaging(ctx.request.body);
    });
    router.post('/inbound/inbound-inquiry-report/expanding/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(inboundInquiryReportService(ctx).expandingInquiryReportSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });

    router.post('/inbound/inbound-inquiry-report/schedule-summary/search-by-paging', async (ctx, next) => {
        ctx.body = await inboundInquiryReportService(ctx).scheduleSummaryReportSearchByPaging(ctx.request.body);
    });
    router.post('/inbound/inbound-inquiry-report/schedule-summary/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(inboundInquiryReportService(ctx).scheduleSummaryReportSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });
    router.post('/inbound/inbound-inquiry-report/receiving-summary/search-by-paging', async (ctx, next) => {
        ctx.body = await inboundInquiryReportService(ctx).receivingSummaryReportSearchByPaging(ctx.request.body);
    });
    router.post('/inbound/inbound-inquiry-report/receiving-summary/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(inboundInquiryReportService(ctx).receivingSummaryReportSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });

    router.post('/inbound/innolux/container-sn-comparison-report', async (ctx, next) => {
        ctx.body = await containerSnComparisonReportService(ctx).generateReport(ctx.request.body);
    });
};