let service = (app, ctx) => {

    async function getOriginalReceiveLPId(inventories) {
        let orgLpIds = _.compact(_.uniq(_.map(inventories, "originalReceiveLPId")));
        if (_.isEmpty(orgLpIds)) return {};

        let prgLpInvs = await wmsMysql(ctx).query(`select distinct lpId from inventory where qty>0 and lpId in('${orgLpIds.join("','")}')`);
        let sql = `SELECT MAX(shippedWhen) AS shippedWhen,orderId,originalReceiveLPId FROM inventory 
                    WHERE originalReceiveLPId in('${orgLpIds.join("','")}') AND status='SHIPPED' AND shippedWhen IS NOT NULL 
                    GROUP BY originalReceiveLPId`;
        let shippedInvs = await wmsMysql(ctx).query(sql);
        let shippedLpMap = _.keyBy(shippedInvs, "originalReceiveLPId");
        let invLpIds = _.map(prgLpInvs, "lpId");
        let lpStackMap = await locationService(ctx).getLocationStackLpIdMap(orgLpIds);

        let originalLps = {};
        _.forEach(orgLpIds, lp => {
            let shippedLp = shippedLpMap[lp];
            originalLps[lp] = {
                isLpCleared: !_.includes(invLpIds, lp),
                orderId: shippedLp ? shippedLp.orderId : "",
                stack: lpStackMap[lp] || ""
            }
        })
        return originalLps;
    }

    async function getOnShippingInventoryStorage(customerIds) {
        if (!customerIds || customerIds.length === 0) return [];

        let inventories = await wmsMysql(ctx).query(`select ${tabelFieldMap.inventoryFields} from inventory where status in('PICKED','PACKED','LOADED') and customerId in('${customerIds.join("','")}') and qty>0`);
        if (!inventories || inventories.length === 0) return [];

        _.forEach(inventories, inv => {
            inv.lpId = inv.originalReceiveLPId || inv.lpId;
        })

        return inventories;
    }

    async function getHistoryInventory(customerId, itemSpecIds, time) {
        if (!customerId && (!itemSpecIds || itemSpecIds.length === 0)) return [];

        let param = {};
        if (customerId) param.customerId = customerId;
        if (itemSpecIds && itemSpecIds.length > 0) param.itemSpecIds = itemSpecIds;
        if (time) param.endTime = momentZone(time).format('YYYY-MM-DDTHH:mm:ss');

        let inventories = await wmsApp(ctx).post("/inventories/generate-report", param);
        _.forEach(inventories, inv => {
            inv.qty = inv.onHandQty;
        });
        return inventories;
    }

    async function searchLpDetails(criteria) {
        let inventorySplitedByLp = await getInventoryOfLp(criteria);
        if (_.isEmpty(inventorySplitedByLp)) return;

        //fill lp details
        let lps = await searchLp({"lpIds": _.uniq(_.map(inventorySplitedByLp, "lpId"))});
        if (_.isEmpty(lps)) return;
        let lpMap = _.keyBy(lps, "id");

        let locationIds = _.uniq(_.map(lps, "locationId"));
        let locationMap = await locationService(ctx).getLocationMapById(locationIds);
        let views = [];
        _.each(inventorySplitedByLp, i => {
            views.push({
                "lpId": i.lpId,
                "location": commonService(ctx).ensureNotNull(_getLocationOfLp(i.lpId, lpMap, locationMap)),
                "qty": i.qty,
                "status": i.status,
                "palletNo": i.palletNo
            })
        });
        return views;
    }

    async function searchLp(criteria){
        let lpSearch = new LpSearch(criteria);
        let criteriaClause = lpSearch.buildClause();
        if (!criteriaClause) {
            return;
        }
        return await wmsMysql(ctx).query(`SELECT id, locationId, confId, status,  palletNo FROM lp WHERE ${criteriaClause}`);
    }

    function _getLocationOfLp(lpId, lpMap, locationMap) {
        if (lpId && lpMap[lpId]) {
            if (lpMap[lpId].locationId && locationMap[lpMap[lpId].locationId]) {
                return locationMap[lpMap[lpId].locationId].name;
            }
        }
    }

    async function getInventoryOfLp(criteria) {
        let inventorySearch = new InventorySearch(criteria);
        let criteriaClause = inventorySearch.buildClause();
        if (_.isEmpty(criteriaClause)) {
            return;
        }
        let sql = `SELECT status,lpId,itemSpecId,unitId,qty,customerId FROM inventory WHERE ${criteriaClause}`;
        let inventories = await wmsMysql(ctx).query(sql);
        if (_.isEmpty(inventories)) return;

        //convert qty to ea qty
        let unitIds = _.uniq(_.map(inventories, "unitId"));
        let unitMap = await itemUnitService(ctx).getUnitMap(unitIds, criteria.customerId, [criteria.itemSpecId]);
        _.each(inventories, i => {
            let unit = unitMap[i.unitId];
            if (unit) {
                i.baseTotalQty = i.qty * unit.baseQty
            }
        });

        //group inventory by lpId and status (eg. Allocated has 3 statuses), sum total qty
        let inventoryLpGroup = _.groupBy(inventories, i => i.lpId + '|' + i.status);
        let inventoryOfLp = [];
        _.each(inventoryLpGroup, (values, key) => {
            inventoryOfLp.push({
                "lpId": _.split(key, '|', 2)[0],
                "status": _.split(key, '|', 2)[1],
                "qty": _.sumBy(values, "baseTotalQty")
            })
        });
        return inventoryOfLp;
    }

    async function searchInventory(criteria) {
        if (commonService(ctx).isEmptyObject(criteria)) {
            throw new Error("Not support empty search on inventory!")
        }
        let inventorySearch = new InventorySearch(criteria);
        let criteriaClause = inventorySearch.buildClause();
        if (_.isEmpty(criteriaClause)) {
            return;
        }
        let sql = `SELECT * FROM inventory WHERE ${criteriaClause}`;
        return await wmsMysql(ctx).query(sql);
    }

    function buildInventorySearchClause(criteria) {
        let inventorySearch = new InventorySearch(criteria);
        return inventorySearch.buildClause();
    }

    class InventorySearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new DBOperator('=', 'customerId'),
                titleId: new DBOperator('=', 'titleId'),
                titleIds: new DBOperator('IN', 'titleId'),
                itemSpecId: new DBOperator('=', 'itemSpecId'),
                itemSpecIds: new DBOperator('IN', 'itemSpecId'),
                unitId: new DBOperator('=', 'unitId'),
                unitIds: new DBOperator('IN', 'unitId'),
                statuses: new DBOperator('IN', 'status'),
                receiptIds: new DBOperator('IN', 'receiptId'),
                excludeStatuses: new DBOperator('NIN', 'status'),
                lpIds: new DBOperator('IN', 'lpId'),
                lotNo: new DBOperator('=', 'lotNo'),
                qty: new DBOperator('>', 'qty')
            };
        }
    }

    class LpSearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                lpIds: new DBOperator('IN', 'id')
            }
        }
    }

    return {
        getOriginalReceiveLPId,
        getOnShippingInventoryStorage,
        getHistoryInventory,
        searchLpDetails,
        buildInventorySearchClause,
        searchInventory,
        searchLp
    };
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};