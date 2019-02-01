module.exports = function (app) {
    router.post('/activity/activity-report/download', async (ctx, next)=>{
        let reportData = await activityReportService(ctx).buildActivityReport(ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData);
    });
};
