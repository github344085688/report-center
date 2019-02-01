module.exports = function (app) {
    router.post('/lp/lp-notshiped-report/search-by-paging', async (ctx, next) => {
        let param = ctx.request.body;
        ctx.body = await lpNotShippedService(ctx).searchByPaging(param);
    });

    router.post('/lp/lp-notshiped-report/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(lpNotShippedService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/lp/inner-lp-ids-include-outer-lp', async (ctx, next) => {
        let outerLpIds = ctx.request.body;
        ctx.body = await lpService(ctx).getInnerLpIdsIncludeOuterLp(outerLpIds);
    });

};