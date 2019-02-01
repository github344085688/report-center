module.exports = function (app) {
    router.post('/task/pick-detail-report/search-by-paging', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await pickDetailReportService(ctx).searchByPaging(param);
    });

    router.post('/task/pick-detail-report/download', async (ctx, next) => {
        let param = ctx.request.body;
        let reportData = await commonService(ctx).getAllPages(pickDetailReportService(ctx).searchByPaging, param);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });
};