const ObjectID = require('mongodb-core').BSON.ObjectID;

let service = (app, ctx) => {
    async function resolveFields(rawDatas, reportFields) {
        let necessayInternalFields = ["itemSpecId", "titleId"];
        let specificFeildPrefetchPromises = _buildFieldPrefetchPromises(rawDatas, reportFields);
        return await commonResolver(ctx).fetchAndResolveFields(rawDatas, reportFields, necessayInternalFields, specificFeildPrefetchPromises, inventoryReportFieldResolver);
    }

    function _buildFieldPrefetchPromises(rawDatas, reportFields) {
        let promises = [];
        let orgIds = [];
        let unitIds = [];
        let wiseFields = _.map(reportFields, "wiseField");
        if (_.find(wiseFields, f => _.includes(f, "getItem()"))) {
            promises.push(_prefetchItems(_.map(rawDatas, "itemSpecId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getUOM()"))) {
            unitIds = _.union(unitIds, _.map(rawDatas, "unitId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getCustomer()"))) {
            orgIds = _.union(orgIds, _.map(rawDatas, "customerId"));
            promises.push(_prefetchCustomer(_.map(rawDatas, "customerId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getTitle()"))) {
            orgIds = _.union(orgIds, _.map(rawDatas, "titleId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getSupplier()"))) {
            orgIds = _.union(orgIds, _.map(rawDatas, "supplierId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getIncommingQty()"))) {
            promises.push(_prefetchItemIncommingQty(_.map(rawDatas, "itemSpecId"), _.map(rawDatas, "unitId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getOpenOrderQty()"))) {
            promises.push(_prefetchItemOpenOrderQty(_.map(rawDatas, "itemSpecId"), _.map(rawDatas, "unitId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getUnitPerPackage()"))) {
            promises.push(_prefetchItemUnitPerPackage(_.map(rawDatas, "unitId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getStatusReportSnList()"))) {
            promises.push(_prefetchStatusItemSnMap(_.map(rawDatas, "itemSpecId"), _.map(rawDatas, "unitId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getAdjustFrom()"))) {
            let uomAdjustments = _.filter(rawDatas, o => o.type === "Adjust UOM");
            unitIds = _.union(unitIds, _.mapUniq(uomAdjustments, "adjustFrom"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getAdjustTo()"))) {
            let uomAdjustments = _.filter(rawDatas, o => o.type === "Adjust UOM");
            unitIds = _.union(unitIds, _.mapUniq(uomAdjustments, "adjustTo"));
        }
        if (!_.isEmpty(orgIds)) {
            promises.push(_prefetchOrgs(orgIds));
        }
        if (!_.isEmpty(unitIds)) {
            promises.push(_prefetchUnits(unitIds));
        }

        return promises;
    }

    async function _prefetchItems(itemSpecIds) {
        await itemSpecService(ctx).getItemSpecMap(itemSpecIds);
    }

    async function _prefetchCustomer(customerIds) {
        await customerService(ctx).getCustomerMap(customerIds);
    }

    async function _prefetchOrgs(orgIds) {
        await organizationService(ctx).getOrganizationBasicMap(orgIds);
    }

    async function _prefetchUnits(unitIds) {
        await itemUnitService(ctx).getUnitMapByIds(unitIds);
    }

    async function _prefetchItemIncommingQty(itemSpecIds, unitIds) {
        let result = await receiptItemLineCollection(ctx).aggregate([
            {$match: {itemSpecId: {$in: itemSpecIds}, unitId: {$in: unitIds}}},
            {
                $lookup: {
                    from: "receipt",
                    localField: "receiptId",
                    foreignField: "_id",
                    as: "receipt"
                }
            },
            {$unwind: "$receipt"},
            {$match: {"receipt.status": {$in: ['IMPORTED', 'OPEN', 'APPOINTMENT_MADE', 'IN_YARD']}}},
            {
                $project: {
                    "_id": 0,
                    "receiptId": 1,
                    "itemSpecId": 1,
                    "unitId": 1,
                    "qty": 1,
                    "receipt.status": 1,
                    "receipt.titleId": 1
                }
            }
        ]);
        let incommingReceiptItemLines = await app.promisify(result.toArray, result)();
        let incommingGroup = _.groupBy(incommingReceiptItemLines, o => o.itemSpecId + "|" + o.unitId + "|" + o.receipt.titleId);
        _.each(incommingGroup, (value, key) => {
            ctx.cached.incommingItemQtyMap[key] = _.sumBy(value, "qty");
        });
    }

    async function _prefetchItemOpenOrderQty(itemSpecIds, unitIds) {
        let result = await orderItemLineCollection(ctx).aggregate([
            {$match: {itemSpecId: {$in: itemSpecIds}, unitId: {$in: unitIds}}},
            {
                $lookup: {
                    from: "order",
                    localField: "orderId",
                    foreignField: "_id",
                    as: "order"
                }
            },
            {$unwind: "$order"},
            {$match: {"order.status": {$in: ['IMPORTED', 'OPEN']}}},
            {$project: {_id: 0, orderId: 1, itemSpecId: 1, qty: 1, unitId: 1, "order.status": 1, "titleId": 1}}
        ]);
        let openOrderItemLines = await app.promisify(result.toArray, result)();
        let orderItemLineGroup = _.groupBy(openOrderItemLines, o => o.itemSpecId + "|" + o.unitId + "|" + o.titleId);
        _.each(orderItemLineGroup, (value, key) => {
            ctx.cached.openOrderItemQtyMap[key] = _.sumBy(value, "qty");
        });
    }

    async function _prefetchItemUnitPerPackage(unitIds) {
        //find unit with their package unit name
        let objUnitIds = _.map(unitIds, o => new ObjectID(o));
        let result = await itemUnitCollection(ctx).aggregate([
            {$match: {_id: {$in: objUnitIds}}},
            {
                $lookup: {
                    from: "item_unit_pick_type",
                    localField: "name",
                    foreignField: "name",
                    as: "pkgUnit"
                }
            },
            {$unwind: "$pkgUnit"},
            {$project: {itemSpecId: 1, name: 1, baseQty: 1, "pkgUnit.name": 1, "pkgUnit.referenceUnit": 1}}
        ]);
        let unitWithPkgInfos = await app.promisify(result.toArray, result)();

        // find unit with itemspecId and its package unit name
        let itemSpecIds = _.mapUniq(unitWithPkgInfos, "itemSpecId");
        let pkgUnitNames = _.mapUniq(unitWithPkgInfos, "pkgUnit.referenceUnit");
        let pkgItemUnits = await itemUnitCollection(ctx).find({
            itemSpecId: {$in: itemSpecIds},
            name: {$in: pkgUnitNames}
        }).toArray();

        // calculate unit per package and cached
        _.each(unitWithPkgInfos, o => {
            let pkgUnits = _.filter(pkgItemUnits, pkgUnit => o.itemSpecId === pkgUnit.itemSpecId && o.pkgUnit.referenceUnit === pkgUnit.name);
            ctx.cached.unitPerPkgMap[o._id.toString()] = _.isEmpty(pkgUnits) ? 1 : pkgUnits[0].baseQty / o.baseQty;
        });
    }

    async function _prefetchStatusItemSnMap(itemSpecIds, unitIds) {
        let inventorySearch = new (inventoryCommonService(ctx).InventorySearch)({
            itemSpecIds: itemSpecIds,
            unitIds: unitIds,
            excludeStatuses: ["SHIPPED"]
        });
        let clause = inventorySearch.buildClause();
        let sql = `SELECT itemSpecId, unitId, titleId,sn FROM inventory WHERE ${clause} AND qty>0 `;
        let inventories = await wmsMysql(ctx).query(sql);
        let snGroup = _.groupBy(inventories, o => o.itemSpecId + "|" + o.unitId + "|" + o.titleId);
        _.each(snGroup, (value, key) => {
            ctx.cached.statusReportItemSnMap[key] = _.join(_.uniq(_.map(value, "sn")), ',');
        });
    }

    return {
        resolveFields
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
