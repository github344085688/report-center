let service = (app, ctx) => {
    /*
     criteria: item keyword
     */
    async function searchByPaging(criteria) {
        if (_.isEmpty(criteria)) return {};
        criteria.itemSpecIds = await inventoryCommonService(ctx).getItemSpecIdsByKeyword(criteria.itemKeyword, criteria.customerId);
        let pagingResult = await _searchInventoryViewByPaging(criteria);
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["generalLevelFieldMappings"], inventoryReportResolver(ctx).resolveFields);
    }

    async function _searchInventoryViewByPaging(criteria) {
        let inventorySearch = new (inventoryCommonService(ctx).InventorySearch)(criteria);
        let criteriaClause = inventorySearch.buildClause();
        let pagingSql =
            `SELECT itemSpecId, customerId, titleId, supplierId, qty, unitId
               FROM view_inventory_item_customer_title_unit
              WHERE ${criteriaClause}
           ORDER BY itemSpecId, unitId`;
        let pagingResult = await wmsMysql(ctx).queryByPaging(pagingSql);
        await _calculateAndFillAgingQty(pagingResult.results);
        return pagingResult;
    }

    async function _calculateAndFillAgingQty(inventories) {
        if (_.isEmpty(inventories)) return;
        let inventoryAgeSearch = new InventoryAgeSearch({
            "itemSpecIds": _.uniq(_.map(inventories, "itemSpecId")),
            "customerIds": _.uniq(_.map(inventories, "customerId")),
            "titleIds": _.uniq(_.map(inventories, "titleId")),
            "unitIds": _.uniq(_.map(inventories, "unitId")),
        });

        let ageSql =
            `SELECT itemSpecId, customerId, titleId, supplierId, qty, unitId, age
               FROM view_inventory_item_customer_title_unit_age
              WHERE ${inventoryAgeSearch.buildClause()}
           ORDER BY itemSpecId, unitId`;
        let inventoryWithAge = await wmsMysql(ctx).query(ageSql);
        let agingInventoryGroup = _.groupBy(inventoryWithAge, _buildKey);
        _.each(inventories, inv => {
            inv["0-15"] = _sumQtyByAgeRange(inv, agingInventoryGroup, 0, 15);
            inv["16-30"] = _sumQtyByAgeRange(inv, agingInventoryGroup, 16, 30);
            inv["31-45"] = _sumQtyByAgeRange(inv, agingInventoryGroup, 31, 45);
            inv["46-60"] = _sumQtyByAgeRange(inv, agingInventoryGroup, 46, 60);
            inv["61-75"] = _sumQtyByAgeRange(inv, agingInventoryGroup, 61, 75);
            inv["76-90"] = _sumQtyByAgeRange(inv, agingInventoryGroup, 76, 90);
            inv["91-105"] = _sumQtyByAgeRange(inv, agingInventoryGroup, 91, 105);
            inv["106-120"] = _sumQtyByAgeRange(inv, agingInventoryGroup, 106, 120);
            inv["120+"] = _sumQtyByAgeRange(inv, agingInventoryGroup, 120, Number.MAX_SAFE_INTEGER)
        })
    }

    function _sumQtyByAgeRange(inv, agingInventoryGroup, startAge, endAge) {
        let key = _buildKey(inv);
        let withAgeInvs = agingInventoryGroup[key];
        let inRangeInvs = _.filter(withAgeInvs, inv => inv.age >= startAge && inv.age <= endAge);
        return _.sumBy(inRangeInvs, "qty");
    }

    function _buildKey(inv) {
        return `${inv.itemSpecId}|${inv.customerId}|${inv.titleId}|${inv.supplierId}|${inv.unitId}`;
    }

    class InventoryAgeSearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                itemSpecIds: new DBOperator('IN', 'itemSpecId'),
                customerIds: new DBOperator('IN', 'customerId'),
                titleIds: new DBOperator('IN', 'titleId'),
                unitIds: new DBOperator('IN', 'unitId')
            };
        }
    }

    return {
        searchByPaging
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx)
};