const _ = require('lodash');


let service = (app, ctx) => {

    async function resolveOutboundFields(rawDatas, reportFields) {
        let necessayInternalFields = ["itemSpecId", "orderIds"];
        let feildPrefetchPromises = _buildFieldPrefetchPromises(rawDatas, reportFields);
        return await commonResolver(ctx).fetchAndResolveFields(rawDatas, reportFields, necessayInternalFields, feildPrefetchPromises, outboundReportFieldResolver);
    }

    function _buildFieldPrefetchPromises(rawDatas, reportFields) {
        let promises = [];

        let unitIds = [];
        let orgIds = [];
        let wiseFields = _.map(reportFields, "wiseField");
        if (_.find(wiseFields, f => _.includes(f, "getOrder()"))) {
            promises.push(prefetchOrders(_.map(rawDatas, "orderId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getItem()"))) {
            promises.push(prefetchItems(_.map(rawDatas, "itemSpecId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getLoadTask()"))) {
            promises.push(prefetchLoadTasks(_.map(rawDatas, "loadTaskId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getLoad()"))) {
            promises.push(prefetchLoads(_.map(rawDatas, "loadId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getEntryCarrierByLoad()"))) {
            promises.push(prefetchEntryCarriersByLoad(_.map(rawDatas, "loadId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getShippedUom()"))) {
            unitIds = _.union(unitIds, _.map(rawDatas, "shippedUnitId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getUOM()"))) {
            unitIds = _.union(unitIds, _.map(rawDatas, "unitId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getCustomer()"))) {
            orgIds = _.union(orgIds, _.map(rawDatas, "customerId"));
            promises.push(prefetchCustomer(_.map(rawDatas, "customerId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getTitle()"))) {
            orgIds = _.union(orgIds, _.map(rawDatas, "titleId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getRetailer()"))) {
            orgIds = _.union(orgIds, _.map(rawDatas, "retailerId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getCarrier()"))) {
            orgIds = _.union(orgIds, _.map(rawDatas, "carrierId"));
            promises.push(prefetchCarriers(_.map(rawDatas, "carrierId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getEquipment()"))) {
            promises.push(commonResolver(ctx).safePrefetchEquipments(_.map(rawDatas, "orderId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getTrackingNo()"))) {
            promises.push(prefetchTrackingNo(_.mapUniq(rawDatas, "orderId"), _.mapUniq(rawDatas, "itemSpecId")));
        }

        if (!_.isEmpty(unitIds)) {
            promises.push(prefetchUnits(unitIds));
        }

        if (!_.isEmpty(orgIds)) {
            promises.push(prefetchOrgs(orgIds));
        }
        return promises;
    }

    async function prefetchOrders(orderIds) {
        await orderService(ctx).getOrderMap(orderIds);
    }

    async function prefetchItems(itemSpecIds) {
        await itemSpecService(ctx).getItemSpecMap(itemSpecIds);
    }

    async function prefetchLoadTasks(loadTaskIds) {
        await loadTaskService(ctx).getLoadTaskMap(loadTaskIds);
    }

    async function prefetchLoads(loadIds) {
        await loadService(ctx).getLoadMap(loadIds);
    }

    async function prefetchEntryCarriersByLoad(loadIds) {
        await loadService(ctx).getEntryCarrierMapByLoad(loadIds);
    }

    async function prefetchUnits(unitIds) {
        await itemUnitService(ctx).getUnitMapByIds(unitIds);
    }

    async function prefetchOrgs(orgIds) {
        await organizationService(ctx).getOrganizationBasicMap(orgIds);
    }

    async function prefetchCarriers(carrierIds) {
        await carrierService(ctx).getCarrierMap(carrierIds);
    }

    async function prefetchCustomer(customerIds) {
        await customerService(ctx).getCustomerMap(customerIds);
    }

    async function prefetchTrackingNo(orderIds, itemSpecIds) {
        let shipmentDetails = await shipmentDetailCollection(ctx).find({
            "itemLineDetails.orderId": {$in: orderIds},
            "itemLineDetails.itemSpecId": {$in: itemSpecIds}
        }).toArray();
        _.each(shipmentDetails, shipmentDetail => {
            _.each(shipmentDetail.itemLineDetails, itemLine => {
                itemLine.trackingNo = shipmentDetail.trackingNo;
            })
        });
        let itemLineDetails = _.flatMap(shipmentDetails, "itemLineDetails");
        let itemLineTrackingNoGroup = _.groupBy(itemLineDetails, itemLine => itemLine.orderId + "|" + itemLine.itemSpecId);
        _.each(itemLineTrackingNoGroup, (value, key) => {
            let trackingNos = _.mapUniq(value, "trackingNo");
            ctx.cached.trackingNoMap[key] = _.join(trackingNos, ",")
        })
    }

    return {
        resolveOutboundFields
    }
};


module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
