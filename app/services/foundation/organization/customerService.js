let service = (app, ctx) => {
    async function getCustomerMap(customerIds) {
        return await app.util.getMapFromCache(ctx.cached.customerMap, customerIds, _getCustomerMap);
    }

    async function _getCustomerMap(customerIds) {
        if (_.isEmpty(customerIds)) return {};
        let customers = await customerCollection(ctx).find({"orgId": {$in: customerIds}}).toArray();
        if (_.isEmpty(customers)) return;
        return _.keyBy(customers, "orgId");
    }

    return {
        getCustomerMap
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
