let service = (app, ctx) => {
    /*
     get itemspecId by itemkeyword, lot#
     */
    async function getItemSpecIdsByKeywordAndLotNo(criteria) {
        if (_.isEmpty(criteria.customerId)) {
            throw new Error("customerId is required!");
        }
        if (!_.isEmpty(criteria.itemKeyword)) {
            let itemSpecIdsByKeyword = await getItemSpecIdsByKeyword(criteria.itemKeyword, criteria.customerId);
            let itemSpecIdsByLotNo = await getItemSpecIdsByLotNo(criteria.itemKeyword, criteria.customerId);
            let itemSpecIds = _.union(itemSpecIdsByKeyword, itemSpecIdsByLotNo);
            if (_.size(itemSpecIds) > 1) {
                _.pull(itemSpecIds, "-1");
                return itemSpecIds;
            }
        }
    }

    async function getItemSpecIdsByKeyword(keyword, customerId) {
        if (_.isEmpty(customerId)) {
            throw new Error("customerId is required!");
        }
        if (_.isEmpty(keyword)) return;
        let itemSpecs = await itemSpecService(ctx).itemSearch({
            keyword: keyword,
            customerId: customerId
        });
        return _.mapUniq(itemSpecs, "_id") || ["-1"];
    }

    async function getItemSpecIdsByLotNo(lotNo, customerId) {
        if (_.isEmpty(lotNo)) return;
        let inventorySearch = new InventorySearch({lotNo: lotNo, customerId: customerId});
        let criteriaClause = inventorySearch.buildClause();
        if (_.isEmpty(criteriaClause)) {
            return;
        }
        let sql = `SELECT itemSpecId FROM inventory WHERE ${criteriaClause}`;
        let invs = await wmsMysql(ctx).query(sql);
        return _.mapUniq(invs, "itemSpecId") || ["-1"];
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
                receiptId: new DBOperator('=', 'receiptId'),
                receiptIds: new DBOperator('IN', 'receiptId'),
                orderId: new DBOperator('=', 'orderId'),
                orderIds: new DBOperator('IN', 'orderId'),
                excludeStatuses: new DBOperator('NIN', 'status'),
                lpIds: new DBOperator('IN', 'lpId'),
                lotNo: new DBOperator('=', 'lotNo'),
                qty: new DBOperator('>', 'qty', 'Number'),
                sns: new DBOperator('IN', 'sn'),
                activityTimeFrom: new DBOperator('>', 'createdWhen'),
                activityTimeTo: new DBOperator('<', 'createdWhen'),
                snNotNull: new DBOperator('NOTNULL', 'sn')
            };
        }
    }

    return {
        getItemSpecIdsByKeywordAndLotNo,
        getItemSpecIdsByKeyword,
        getItemSpecIdsByLotNo,
        InventorySearch: InventorySearch
    }
};
module.exports = function (app) {
    return (ctx) => service(app, ctx);
};