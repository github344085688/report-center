module.exports = function (app) {
    router.get('/yard-equipment/location-occupy', async (ctx, next) => {
        ctx.body = await ymsApp(ctx).get('/yard-equipment/location-occupy');
    });
};