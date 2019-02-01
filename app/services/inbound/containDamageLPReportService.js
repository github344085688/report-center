const _ = require('lodash'),
    request = require('superagent');

let service = (app, ctx) => {

    async function searchByPaging(criteria) {
        let containDamageLPSearch = new ContainDamageLPSearch(criteria);
        let criteriaClause = containDamageLPSearch.buildClause();
        if (!criteriaClause) {
            throw new BadRequestError('Please select at least 1 criterion.');
        }

        let searchSql =
            `SELECT inv.customerId, inv.titleId, inv.receiptId, lp.locationId, inv.lpId, lp.goodsType, inv.itemSpecId, sum(inv.qty), inv.unitId, inv.receiveTaskId, inv.receivedWhen 
               FROM inventory inv, lp
              WHERE inv.lpId = lp.id
                AND lp.goodsType = 'CONTAIN_DAMAGE' 
                AND ${containDamageLPSearch.buildClause()}
           GROUP BY inv.lpId, inv.itemSpecId, inv.unitId`;


        let invs = await wmsMysql(ctx).queryByPaging(searchSql);

        let orgIds = _.union(_.map(invs.results, "customerId"), _.map(invs.results, "titleId"));
        let itemSpecIds = _.map(invs.results, "itemSpecId");
        let locationIds = _.map(invs.results, "locationId");
        let unitIds = _.map(invs.results, "unitId");

        let [orgMap, itemSpecMap, locationMap, unitMap] = await Promise.all([
            organizationService(ctx).getOrganizationMap(orgIds),
            itemSpecService(ctx).getItemSpecMap(itemSpecIds),
            locationService(ctx).getLocationMap(locationIds),
            itemUnitService(ctx).getUnitMap(unitIds)
        ]);

        let data = [];
        for (let inv of invs.results) {
            data.push({
                "Customer": orgMap[inv.customerId].name,
                "Title": orgMap[inv.titleId].name,
                "Receipt ID": inv.receiptId,
                "Item ID": itemSpecMap[inv.itemSpecId].name,
                "Short Description": itemSpecMap[inv.itemSpecId].shortDescription,
                "LP": inv.lpId,
                "Location": inv.locationId ? locationMap[inv.locationId].name : "",
                "Goods Type": inv.goodsType,
                "QTY": inv.qty,
                "UOM": unitMap[inv.unitId].name,
                "Receive Task ID": inv.receiveTaskId,
                "Received When": momentZone(inv.receivedWhen).format('YYYY-MM-DD HH:mm:ss')
            })
        }

        return {
            results: {
                data: data,
                head: [
                    "Customer",
                    "Title",
                    "Receipt ID",
                    "Item ID",
                    "Short Description",
                    "LP",
                    "Goods Type",
                    "QTY",
                    "UOM",
                    "Receive Task ID",
                    "Received When"
                ]
            },
            paging: invs.paging
        };
    }

    class ContainDamageLPSearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new DBOperator('=', 'customerId'),
                titleId: new DBOperator('=', 'titleId'),
                itemSpecId: new DBOperator('=', 'itemSpecId'),
                locationId: new DBOperator('=', 'locationId'),
                receiptIds: new DBOperator('=', 'receiptIds'),
                receiveTaskId: new DBOperator('=', 'receiveTaskId'),
                lpIds: new DBOperator('IN', 'lpIds'),
                receivedWhenFrom: new DBOperator('>=', 'receivedWhen', 'Date'),
                receivedWhenTo: new DBOperator('<=', 'receivedWhen', 'Date')
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




