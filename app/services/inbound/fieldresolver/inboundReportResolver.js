const _ = require('lodash');


let service = (app, ctx) => {
    async function resolveInboundFields(rawDatas, reportFields) {
        let necessayInternalFields = ["itemSpecId", "receivedSnList", "snList", "receiptIds"];
        let specificFeildPrefetchPromises = _buildFieldPrefetchPromises(rawDatas, reportFields);
        return await commonResolver(ctx).fetchAndResolveFields(rawDatas, reportFields, necessayInternalFields, specificFeildPrefetchPromises, inboundReportFieldResolver);
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
        if (_.find(wiseFields, f => _.includes(f, "getCarrier()"))) {
            orgIds = _.union(orgIds, _.map(rawDatas, "carrierId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getReceipt()"))) {
            promises.push(prefetchReceipts(_.map(rawDatas, "receiptId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getCarrier()"))) {
            orgIds = _.union(orgIds, _.map(rawDatas, "carrierId"));
            promises.push(prefetchCarriers(_.map(rawDatas, "carrierId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getExpectedUom()"))) {
            unitIds = _.union(unitIds, _.map(rawDatas, "unitId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getReceivedUom()"))) {
            unitIds = _.union(unitIds, _.map(rawDatas, "receivedUnitId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getExpectedCft()"))) {
            unitIds = _.union(unitIds, _.map(rawDatas, "unitId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getReceivedCft()"))) {
            unitIds = _.union(unitIds, _.map(rawDatas, "receivedUnitId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getExpectedWeight()"))) {
            unitIds = _.union(unitIds, _.map(rawDatas, "unitId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getReceivedWeight()"))) {
            unitIds = _.union(unitIds, _.map(rawDatas, "receivedUnitId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getBaseQty()"))) {
            unitIds = _.union(unitIds, _.map(rawDatas, "unitId"));
        }
        if (_.find(wiseFields, f => _.includes(f, "getReceivedCsQty()"))) {
            unitIds = _.union(unitIds, _.map(rawDatas, "receivedUnitId"));
            promises.push(prefetchCsUnits(_.map(rawDatas, "itemSpecId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getPalletNo()"))) {
            promises.push(prefetchLPs(_.map(rawDatas, "lpId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getEquipment()"))) {
            promises.push(commonResolver(ctx).safePrefetchEquipments(_.map(rawDatas, "receiptId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getQtyPerPallet()"))) {
            promises.push(_prefetchQtyPerPallet(_.map(rawDatas, "itemSpecId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getReceivedSNQty()"))) {
            promises.push(_prefetchReceivedSN(_.map(rawDatas, "receiptId"), _.map(rawDatas, "itemSpecId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getExpectdSNQty()"))) {
        }
        if (_.find(wiseFields, f => _.includes(f, "getReceivedDamagedQty()") || _.includes(f, "getReceivedDamagedUOM()"))) {
            promises.push(_prefetchReceivedDamaged(_.map(rawDatas, "receiptItemLineId")));
        }
        if (_.find(wiseFields, f => _.includes(f, "getItemDynTxtProperty()"))) {
            promises.push(_prefetchItemDynTxtProperty(_.map(rawDatas, "itemSpecId")));
        }

        if (!_.isEmpty(orgIds)) {
            promises.push(prefetchOrgs(orgIds));
        }
        if (!_.isEmpty(unitIds)) {
            promises.push(prefetchUnits(unitIds));
        }

        return promises;
    }

    async function _prefetchItems(itemSpecIds) {
        await itemSpecService(ctx).getItemSpecMap(itemSpecIds);
    }

    async function _prefetchCustomer(customerIds) {
        await customerService(ctx).getCustomerMap(customerIds);
    }

    async function prefetchReceipts(receiptIds) {
        await receiptService(ctx).getReceiptMap(receiptIds);
    }

    async function prefetchOrgs(orgIds) {
        await organizationService(ctx).getOrganizationBasicMap(orgIds);
    }

    async function prefetchCarriers(carrierIds) {
        await carrierService(ctx).getCarrierMap(carrierIds);
    }

    async function prefetchUnits(unitIds) {
        await itemUnitService(ctx).getUnitMapByIds(unitIds);
    }

    async function prefetchCsUnits(itemSpecIds) {
        await itemUnitService(ctx).getCsUnitMapByItemSpecIds(itemSpecIds);
    }

    async function _prefetchQtyPerPallet(itemSpecIds) {
        await itemLpConfigurationService(ctx).getQtyPerPalletMap(itemSpecIds);
    }

    async function prefetchLPs(lpIds) {
        // clear previous batch to prevent useless Memory occupy
        ctx.cached.lpMap = {};
        await lpService(ctx).getLpMap(lpIds);
    }

    async function _prefetchReceivedSN(receiptIds, itemSpecIds) {
        let criteria = {
            "itemSpecIds": itemSpecIds,
            "receiptIds": receiptIds
        };
        let searchClause = inventoryService(ctx).buildInventorySearchClause(criteria);
        let inventories = await wmsMysql(ctx).query(`SELECT itemSpecId, receiptId, sn FROM inventory WHERE ${searchClause} AND sn IS NOT NULL`);
        if (_.isEmpty(inventories)) return;
        let snGroup = _.groupBy(inventories, inv => inv.receiptId + "|" + inv.itemSpecId);
        _.each(snGroup, (invs, key) => {
            let sn = _.mapUniq(invs, "sn");
            ctx.cached.receivedSNMap[key] = {
                snQty: _.size(sn),
                snList: _.join(sn, ",")
            }
        });
    }

    async function _prefetchReceivedDamaged(receiptItemLineIds) {
        if (_.isEmpty(receiptItemLineIds)) return;
        let result = await receiveLpSetupCollection(ctx).aggregate([
            {$match: {"lpDetails.type": "DAMAGE"}},
            {$project: {_id: 0, "lpDetails": 1}},
            {$unwind: "$lpDetails"},
            {
                $match: {
                    "lpDetails.type": "DAMAGE",
                    "lpDetails.items.qty": {$gt: 0},
                    "lpDetails.items.itemLineId": {$in: receiptItemLineIds}
                }
            },
            {$project: {"lpDetails.items": 1}}
        ]);
        let damagedDetails = await app.promisify(result.toArray, result)();
        if (_.isEmpty(damagedDetails)) return;
        let damagedItemDetails = _.flatMap(damagedDetails, "lpDetails.items");
        if (_.isEmpty(damagedItemDetails)) return;
        let damagedUnitIds = _.mapUniq(damagedItemDetails, "unitId");
        await itemUnitService(ctx).getUnitMapByIds(damagedUnitIds);
        let damagedMap = _.keyBy(damagedItemDetails, "itemLineId");
        _.each(damagedMap, (damageDetail, itemLineId) => {
            ctx.cached.receivedDamagedMap[itemLineId] = {
                "unitId": damageDetail.unitId,
                "qty": damageDetail.qty
            }
        });
    }

    async function _prefetchItemDynTxtProperty(itemSpecIds) {
        await itemSpecService(ctx).getItemDynPropertyGroup(itemSpecIds);
    }

    return {
        resolveInboundFields
    }
};


module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
