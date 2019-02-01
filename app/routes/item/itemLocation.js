module.exports = function (app) {

    router.post('/item-location/search-by-paging', async (ctx, next) => {
        ctx.body = await itemLocationService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/item-location/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(itemLocationService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });
};