let service = (app, ctx) => {
    /*
     criteria: itemKeyword,types,lpIds,startTime,endTime, timeFrom, timeTo, see AdjustmentSearch below for more details
     */
    async function searchByPaging(criteria) {
        if (_.isEmpty(criteria)) return {};
        criteria.itemSpecIds = await inventoryCommonService(ctx).getItemSpecIdsByKeyword(criteria.itemKeyword, criteria.customerId);
        let pagingResult = await _searchAdjustmentByPaging(criteria);
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["generalLevelFieldMappings"], inventoryReportResolver(ctx).resolveFields);
    }

    async function _searchAdjustmentByPaging(criteria) {
        criteria.progress = "COMPLETE";
        criteria.types = await commonService(ctx).multiEnumToDbFormat("AdjustmentType", criteria.types);
        let adjustmentSearch = new AdjustmentSearch(criteria);
        let criteriaClause = adjustmentSearch.buildClause();
        let pagingResult = await adjustmentCollection(ctx).findByPaging(criteriaClause);
        for (let o of pagingResult.results) {
            o.type = await commonService(ctx).enumToWebFormat("AdjustmentType", o.type);
            o.lpIds = _.join(o.lpIds, ",");
        }
        return pagingResult;
    }

    class AdjustmentSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'customerId'),
                progress: new MongoOperator('$eq', 'progress'),
                titleId: new MongoOperator('$eq', 'titleId'),
                itemSpecId: new MongoOperator('$eq', 'itemSpecId'),
                itemSpecIds: new MongoOperator('$in', 'itemSpecId'),
                types: new MongoOperator('$in', 'type'),
                lpIds: new MongoOperator('$in', 'lpIds'),
                startTime: new MongoOperator('$gte', 'createdWhen', 'Date'),
                endTime: new MongoOperator('$lte', 'createdWhen', 'Date'),
                timeFrom: new MongoOperator('$gte', 'approveWhen', 'Date'),
                timeTo: new MongoOperator('$lte', 'approveWhen', 'Date')
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