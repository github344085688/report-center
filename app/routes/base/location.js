
module.exports = function (app) {
    router.post('/location/empty-location', async (ctx, next) => {
        let searchParam = ctx.request.body;
        ctx.body = await locationService(ctx).getEmptyLocations(searchParam);
    });

    router.post('/location/multiple-item-location', async (ctx, next) => {
        let searchParam = ctx.request.body;
        ctx.body = await locationService(ctx).getMultipleItemLocations(searchParam);
    });
};