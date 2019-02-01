module.exports = function (app) {
    router.post('/location/multi-item-location/search-by-paging', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await multiItemLocationService(ctx).searchByPaging(param);
    });
    router.post('/location/multi-item-location/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(multiItemLocationService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });
};