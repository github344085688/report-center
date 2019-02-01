module.exports = function (app) {
    router.post('/carrier/export', async (ctx, next) => {
        let param = ctx.request.body;
        let report = await carrierService(ctx).getReport(param);
        await app.downLoadJsonExcel(ctx, report);
    });

    router.post('/organization/export', async (ctx, next) => {
        let param = ctx.request.body;
        let report = await organizationService(ctx).getReport(param);
        await app.downLoadJsonExcel(ctx, report);
    });

    router.post('/item-unit/sync', async (ctx, next) => {
        ctx.body = await syncItemUnitService(ctx).syncItemUnitFromMongoToMysql();
    });
};
