module.exports = function (app) {
    router.post('/item/require-collect-seasonal-pack/sendEmail', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await requireCollectSeasonalPackItemService(ctx).sendRequireCollectSeasonalPackItemsToOperation(param);
    });

    router.post('/item-spec/export', async (ctx, next) => {
        let param = ctx.request.body;
        let report = await commonService(ctx).getAllPages(itemSpecService(ctx).searchByPaging, param);
        await app.downLoadJsonExcel(ctx, report.results);
    });

    router.post('/item-spec/handle-the-most/search', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await itemHandleTheMostService(ctx).search(param);
    });

    router.post('/item-spec/handle-the-most/export', async (ctx, next) => {
        let param = ctx.request.body;
        let report = await itemHandleTheMostService(ctx).search(param);
        await app.downLoadJsonExcel(ctx, report.results);
    });

};