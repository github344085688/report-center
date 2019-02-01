module.exports = function (app) {
    //by default, pass isFixed=true
    router.post('/location-item/search-by-paging', async (ctx, next) => {
        ctx.body = await locationItemService(ctx).searchByPaging(ctx.request.body);
    });

    //by default, don't pass isFixed flag
    router.post('/location-item/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(locationItemService(ctx).searchByPagingForReport, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });
};