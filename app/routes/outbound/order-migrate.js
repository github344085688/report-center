module.exports = function (app) {

    router.post('/outbound/order/export/format/honwms/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(orderMigrateToHonWmsReportService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

};