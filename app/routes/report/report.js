
module.exports = function (app) {
    router.post('/report/send-report', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await scheduleService(ctx).sendReport(param);
    });

    router.post('/report/download', async (ctx, next) => {
        let param = ctx.request.body;
        await scheduleService(ctx).downloadReport(param);
    });

    router.post('/report/outbound-schedule-import/search-by-paging', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await outboundScheduleImportReport(ctx).searchByPaging(param);
    });

    router.post('/report/outbound-schedule-import/download', async (ctx, next) => {
        let param = ctx.request.body;
        let reportData = await outboundScheduleImportReport(ctx).downloadReport(param);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });
};
