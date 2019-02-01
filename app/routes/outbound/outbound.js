module.exports = function (app) {
    router.post('/outbound/trackingno-report/search-by-paging', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await trackingNoReport(ctx).searchByPaging(param);
    });

    router.post('/outbound/trackingno-report/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(trackingNoReport(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/outbound/shipping-report/order-level/search-by-paging', async (ctx, next) => {
        ctx.body = await outboundShippingReportService(ctx).orderLevelSearchByPaging(ctx.request.body);
    });

    router.post('/outbound/shipping-report/order-level/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(outboundShippingReportService(ctx).orderLevelSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/outbound/shipping-report/itemline-level/search-by-paging', async (ctx, next) => {
        ctx.body = await outboundShippingReportService(ctx).itemlineLevelSearchByPaging(ctx.request.body);
    });

    router.post('/outbound/shipping-report/itemline-level/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(outboundShippingReportService(ctx).itemlineLevelSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/outbound/shipping-report/item-level/split-by-shipment-ticket/search', async (ctx, next) => {
        let reportData = await outboundReportService(ctx).searchItemLevelSplitByShipmentTicket(ctx.request.body);
        ctx.body = reportData.results;
    });

    router.post('/outbound/shipping-report/item-level/split-by-shipment-ticket/download', async (ctx, next) => {
        let downloadData = await outboundReportService(ctx).searchItemLevelSplitByShipmentTicket(ctx.request.body);
        await app.downLoadJsonExcel(ctx, downloadData.results);
    });


    // Schedule Report
    router.post('/outbound/schedule-report/order-level/search-by-paging', async (ctx, next) => {
        ctx.body = await outboundScheduleReportService(ctx).orderLevelSearchByPaging(ctx.request.body);
    });

    router.post('/outbound/schedule-report/order-level/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(outboundScheduleReportService(ctx).orderLevelSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/outbound/schedule-report/itemline-level/search-by-paging', async (ctx, next) => {
        ctx.body = await outboundScheduleReportService(ctx).itemlineLevelSearchByPaging(ctx.request.body);
    });

    router.post('/outbound/schedule-report/itemline-level/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(outboundScheduleReportService(ctx).itemlineLevelSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });


    router.post('/outbound/shipping-order-report/search-by-paging', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await outboundShippingOrderReport(ctx).searchByPaging(param);
    });
    router.post('/outbound/shipping-order-report/download', async (ctx, next) => {
        let param = ctx.request.body;
        let reportData = await commonService(ctx).getAllPages(outboundShippingOrderReport(ctx).searchByPaging, param);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/outbound/order/export', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(orderService(ctx).searchByPagingForOrderExport, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    })

    router.post('/outbound/pick-round-report/search-by-paging', async (ctx, next) => {
        ctx.body = await pickRoundDetailService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/outbound/pick-round-report/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(pickRoundDetailService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/outbound/order-status-report/search-by-paging', async (ctx, next) => {
        ctx.body = await orderStatusReportService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/outbound/order-status-report/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(orderStatusReportService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    /*
     criteria:
     keyword:"orderId/poNo/refNo/containerNo/loadNo/sn/trackingNo",
     itemKeyword:"itemSpecId/aka/upccode",
     customerId,createdWhenFrom,createdWhenTo, appointmentTimeFrom,appointmentTimeTo,mabdFrom,mabdTo,retailerId, titleId, shipToAddressName,
     loadCompletedWhenFrom,loadCompletedWhenTo,
     carrierId, orderType, statuses, reportCategory,headerList
     */
    router.post('/outbound/outbound-inquiry-report/order-level/search-by-paging', async (ctx, next) => {
        ctx.body = await outboundInquiryReportService(ctx).inquiryReportSearchByPaging(ctx.request.body);
    });
    router.post('/outbound/outbound-inquiry-report/order-level/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(outboundInquiryReportService(ctx).inquiryReportSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });

    router.post('/outbound/outbound-inquiry-report/item-level/search-by-paging', async (ctx, next) => {
        ctx.body = await outboundInquiryReportService(ctx).itemLevelInquiryReportSearchByPaging(ctx.request.body);
    });
    router.post('/outbound/outbound-inquiry-report/item-level/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(outboundInquiryReportService(ctx).itemLevelInquiryReportSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });

    router.post('/outbound/outbound-inquiry-report/id-level/search-by-paging', async (ctx, next) => {
        ctx.body = await outboundInquiryReportService(ctx).idLevelInquiryReportSearchByPaging(ctx.request.body);
    });
    router.post('/outbound/outbound-inquiry-report/id-level/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(outboundInquiryReportService(ctx).idLevelInquiryReportSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });

    router.post('/outbound/outbound-inquiry-report/expanding/search-by-paging', async (ctx, next) => {
        ctx.body = await outboundInquiryReportService(ctx).expandingInquiryReportSearchByPaging(ctx.request.body);
    });
    router.post('/outbound/outbound-inquiry-report/expanding/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(outboundInquiryReportService(ctx).expandingInquiryReportSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });

    router.post('/outbound/outbound-inquiry-report/schedule-summary/search-by-paging', async (ctx, next) => {
        ctx.body = await outboundInquiryReportService(ctx).scheduleSummaryReportSearchByPaging(ctx.request.body);
    });
    router.post('/outbound/outbound-inquiry-report/schedule-summary/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(outboundInquiryReportService(ctx).scheduleSummaryReportSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });

    router.post('/outbound/outbound-inquiry-report/shipping-summary/search-by-paging', async (ctx, next) => {
        ctx.body = await outboundInquiryReportService(ctx).shippingSummaryReportSearchByPaging(ctx.request.body);
    });
    router.post('/outbound/outbound-inquiry-report/shipping-summary/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(outboundInquiryReportService(ctx).shippingSummaryReportSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results, ctx.request.body.reportCategory);
    });

    router.post(`/outbound/out-of-stock-report/search`, async (ctx, next) => {
        ctx.body = await outboundOutOfStockService(ctx).search(ctx.request.body);
    });

    router.post(`/outbound/out-of-stock-report/download`, async (ctx, next) => {
        let reportData = await outboundOutOfStockService(ctx).search(ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/outbound/small-parcel-shipment/search-by-paging', async (ctx, next) => {
        ctx.body = await smallParcelShipmentService(ctx).smallParcelShipmentSearchByPaging(ctx.request.body);
    });

    router.post('/outbound/small-parcel-shipment/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(smallParcelShipmentService(ctx).smallParcelShipmentSearchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });
};