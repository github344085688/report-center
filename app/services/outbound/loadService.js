const _ = require('lodash');

let service = (app, ctx) => {
    async function getLoadMapByOrderId(orderIds) {
        if (!orderIds || orderIds.length === 0) return {};

        let loadOrders = await loadOrderLineCollection(ctx).find({orderId: {$in: orderIds}}).toArray();
        let loadIds = _.uniq(_.map(loadOrders, "loadId"));
        let loads = await loadCollection(ctx).find({_id: {$in: loadIds}}, {projection: {loadNo: 1, type: 1}}).toArray();
        let loadMap = _.keyBy(loads, "_id");

        let data = [];
        _.forEach(loadOrders, order => {
            let load = loadMap[order.loadId];
            data.push({
                orderId: order.orderId,
                loadId: order.loadId,
                loadNo: load && load.loadNo ? load.loadNo : "",
                type: load && load.type ? load.type : "",
            });
        });

        return _.groupBy(data, "orderId");
    }

    async function getLoadMap(loadIds) {
        return await app.util.getMapFromCache(ctx.cached.loadMap, loadIds, _getLoadMap);
    }

    async function _getLoadMap(loadIds) {
        if (_.isEmpty(loadIds)) return {};
        let loads = await loadCollection(ctx).find({_id: {$in: loadIds}}, {
            projection: {
                _id: 1,
                "loadNo": 1
            }
        }).toArray();


        return _.keyBy(loads, "_id");
    }

    async function getEntryCarrierMapByLoad(loadIds) {
        return await app.util.getMapFromCache(ctx.cached.entryCarrierMapByLoad, loadIds, _getEntryCarrierMapByLoad);
    }

    async function _getEntryCarrierMapByLoad(loadIds) {
        if (_.isEmpty(loadIds)) return {};

        let entryActivities = await entryTicketActivityCollection(ctx).find({subTaskId: {$in: loadIds}}, {
            projection: {
                entryId: 1,
                subTaskId: 1
            }
        }).toArray();
        let entryIds = _.map(entryActivities, "entryId");
        if (_.isEmpty(entryIds)) return {};

        let entryCarriers = await entryTicketCheckCollection(ctx).find({
            entryId: {$in: entryIds},
            "checkType": "CHECKIN"
        }).toArray();
        await carrierService(ctx).fillCarrierDetail(entryCarriers);
        if (_.isEmpty(entryCarriers)) return {};

        let carrierMapByEntryId = _.keyBy(entryCarriers, "entryId");
        let entryActivityMapByLoadId = _.keyBy(entryActivities, "subTaskId");

        let carrierMapByLoadId = {};
        _.each(loadIds, loadId => {
            let entryActivity = entryActivityMapByLoadId[loadId];
            if (!entryActivity || !entryActivity.entryId) return {};

            let carrier = carrierMapByEntryId[entryActivity.entryId];
            if (_.isEmpty(carrier)) return {};

            carrierMapByLoadId[loadId] = _.isEmpty(carrier) ? {} : carrier
        });
        return carrierMapByLoadId;
    }

    return {
        getLoadMapByOrderId,
        getLoadMap,
        getEntryCarrierMapByLoad
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};