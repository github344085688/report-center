module.exports = function (app) {
    router.post('/warehouse-performance/download', async (ctx, next)=>{
        let reportData = await warehousePerformanceService(ctx).buildWarehousePerformanceReport(ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData);
    });
};