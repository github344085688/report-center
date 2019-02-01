const _ = require('lodash'),
    request = require('superagent');

let service = (app, ctx) => {

    async function searchByPaging(criteria) {
        let inventorySearch = new InventorySearch(criteria);
        let criteriaClause = inventorySearch.buildClause();
        if (!criteriaClause) {
            throw new BadRequestError('Please select at least 1 criterion.');
        }

        let pagingSql =
            `SELECT itemSpecId, customerId, titleId, supplierId, qty, unitId
               FROM view_inventory_item_customer_title_unit
              WHERE ${inventorySearch.buildClause()}
           ORDER BY itemSpecId, unitId`;
        let invs = await wmsMysql(ctx).queryByPaging(pagingSql);

        let data = [];
        if (!_.isEmpty(invs.results)) {
            data = await _getInventoryAgeData(invs);
        }

        return {
            results: {
                data: data,
                head: [
                    "Item ID",
                    "Short Description",
                    "Description",
                    "UOM",
                    "Title",
                    "Supplier",
                    "Current QTY",
                    "0-15",
                    "16-30",
                    "31-45",
                    "46-60",
                    "61-75",
                    "76-90",
                    "91-105",
                    "106-120",
                    "120+",
                ]
            },
            paging: invs.paging
        };
    }

    async function _getInventoryAgeData(invs) {
        let data = [];

        let orgIds = _.compact(_.union(_.map(invs.results, "customerId"), _.map(invs.results, "titleId"), _.map(invs.results, "supplierId")));
        let itemSpecIds = _.map(invs.results, "itemSpecId");
        let unitIds = _.map(invs.results, "unitId");

        let [orgMap, itemSpecMap, unitMap] = await Promise.all([
            organizationService(ctx).getOrganizationMap(orgIds),
            itemSpecService(ctx).getItemSpecMap(itemSpecIds),
            itemUnitService(ctx).getUnitMap(unitIds)
        ]);

        let inventoryAgeSearch = new InventoryAgeSearch({
            "itemSpecIds": _.uniq(_.map(invs.results, "itemSpecId")),
            "customerIds": _.uniq(_.map(invs.results, "customerId")),
            "titleIds": _.uniq(_.map(invs.results, "titleId")),
            "unitIds": _.uniq(_.map(invs.results, "unitId")),
        });
        let ageSql =
            `SELECT itemSpecId, customerId, titleId, supplierId, qty, unitId, age
               FROM view_inventory_item_customer_title_unit_age
              WHERE ${inventoryAgeSearch.buildClause()}
           ORDER BY itemSpecId, unitId`;
        let withAgeInvs = await wmsMysql(ctx).query(ageSql);
        let withAgeInvsGroupByKey = _.groupBy(withAgeInvs, _buildKey);

        for (let inv of invs.results) {
            data.push({
                "Item ID": itemSpecMap[inv.itemSpecId].name,
                "Short Description": itemSpecMap[inv.itemSpecId].shortDescription,
                "Description": itemSpecMap[inv.itemSpecId].desc,
                "UOM": unitMap[inv.unitId].name,
                "Title": orgMap[inv.titleId] ? orgMap[inv.titleId].name : '',
                "Supplier": orgMap[inv.supplierId] ? orgMap[inv.supplierId].name : '',
                "Current QTY": inv.qty,
                "0-15": _countQtyByAgeRange(inv, withAgeInvsGroupByKey, 0, 15),
                "16-30": _countQtyByAgeRange(inv, withAgeInvsGroupByKey, 16, 30),
                "31-45": _countQtyByAgeRange(inv, withAgeInvsGroupByKey, 31, 45),
                "46-60": _countQtyByAgeRange(inv, withAgeInvsGroupByKey, 46, 60),
                "61-75": _countQtyByAgeRange(inv, withAgeInvsGroupByKey, 61, 75),
                "76-90": _countQtyByAgeRange(inv, withAgeInvsGroupByKey, 76, 90),
                "91-105": _countQtyByAgeRange(inv, withAgeInvsGroupByKey, 91, 105),
                "106-120": _countQtyByAgeRange(inv, withAgeInvsGroupByKey, 106, 120),
                "120+": _countQtyByAgeRange(inv, withAgeInvsGroupByKey, 120, Number.MAX_SAFE_INTEGER)
            })
        }

        return data;
    }

    function _countQtyByAgeRange(inv, withAgeInvsGroupByKey, startAge, endAge) {
        let key = _buildKey(inv);
        let withAgeInvs = withAgeInvsGroupByKey[key];
        let inRangeInvs = _.filter(withAgeInvs, inv => inv.age >= startAge && inv.age <= endAge);
        return _.sumBy(inRangeInvs, "qty");
    }

    function _buildKey(inv) {
        return `${inv.itemSpecId}|${inv.customerId}|${inv.titleId}|${inv.supplierId}|${inv.unitId}`;
    }

    class InventorySearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new DBOperator('=', 'customerId'),
                titleId: new DBOperator('=', 'titleId'),
                itemSpecId: new DBOperator('=', 'itemSpecId'),
                unitId: new DBOperator('=', 'unitId')
            };
        }
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
    return (ctx) => service(app, ctx);
};
