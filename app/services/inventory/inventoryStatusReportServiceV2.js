const _ = require('lodash');

let service = (app, ctx) => {
    /*
     criteria: customerId, titleId, itemKeyword, lotNo, reportCategory, headerList
     */
    async function searchStatusInventoryByPaging(criteria) {
        criteria.itemSpecIds = await inventoryCommonService(ctx).getItemSpecIdsByKeywordAndLotNo(criteria);
        let pagingResult = await searchInventoryViewByStatus(criteria);
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["generalLevelFieldMappings"], inventoryReportResolver(ctx).resolveFields);
    }

    async function searchItemDetailInventoryByPaging(criteria) {
        criteria.itemSpecIds = await inventoryCommonService(ctx).getItemSpecIdsByKeywordAndLotNo(criteria);
        let pagingResult = await searchInventoryByPaging(criteria);
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["generalLevelFieldMappings"], inventoryReportResolver(ctx).resolveFields);
    }

    async function searchInventoryByPaging(criteria) {
        criteria.statuses = await commonService(ctx).multiEnumToDbFormat("InventoryStatus", criteria.statuses);
        criteria.excludeStatuses = ['SHIPPED'];
        let inventorySearch = new (inventoryCommonService(ctx).InventorySearch)(criteria);
        let clause = inventorySearch.buildClause();
        let sql = `SELECT lpId, itemSpecId, unitId, lotNo, supplierId, titleId, status, qty, receivedWhen, receiptId, orderId, expirationDate, shelfLifeDays, shippedWhen,sn FROM inventory WHERE ${clause} AND qty>0`;
        return await wmsMysql(ctx).queryByPaging(sql);
    }

    async function searchInventoryViewByStatus(criteria) {
        let inventoryStatusSearch = new InventoryStatusSearch(criteria);
        let criteriaClause = inventoryStatusSearch.buildClause();
        criteriaClause = _.isEmpty(criteriaClause) ? "" : " And " + criteriaClause;

        let sql = `SELECT itemSpecId, unitId, titleId, allocatedQty, availableQty, damagedQty, holdQty, totalQty
                           FROM view_inventory_item_customer_unit_title_status
                          WHERE 1=1 ${criteriaClause}
                       ORDER BY itemSpecId, unitId, titleId`;

        return await wmsMysql(ctx).queryByPaging(sql);
    }

    class InventoryStatusSearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                itemSpecIds: new DBOperator('IN', 'itemSpecId'),
                customerId: new DBOperator('=', 'customerId'),
                titleId: new DBOperator('=', 'titleId')
            };
        }
    }

    return {
        searchStatusInventoryByPaging,
        searchItemDetailInventoryByPaging,
        searchInventoryByPaging
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};