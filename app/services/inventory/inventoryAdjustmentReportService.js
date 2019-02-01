const _ = require('lodash'),
    request = require('superagent');

let service = (app, ctx) => {

    async function searchByPaging(criteria) {
        criteria.progress = "COMPLETE";
        let adjustmentSearch = new AdjustmentSearch(criteria);
        let criteriaClause = adjustmentSearch.buildClause();
        if (!criteriaClause) {
            throw new BadRequestError('Please select at least 1 criterion.');
        }

        let response = await adjustmentCollection(ctx).findByPaging(adjustmentSearch.buildClause());

        let data = [];
        if (!_.isEmpty(response.results)) {
            data = await _fillAdjustmentDetail(response);
        }

        return {
            results: {
                data: data,
                head: [
                    "Adjust ID",
                    "Item ID",
                    "Short Description",
                    "Description",
                    "UOM",
                    "LPS",
                    "Adjust Type",
                    "From",
                    "To",
                    "Reason",
                    "Notes",
                    "Date & Time",
                    "Adjusted By"
                ]
            },
            paging: response.paging
        };
    }

    async function _fillAdjustmentDetail(response) {
        let data = [];

        let allAjusts = response.results;
        let uomAdjusts = _.filter(allAjusts, adjust => adjust.type === "ADJUST_UOM");

        let itemSpecIds = _.map(response.results, "itemSpecId");
        let unitIds = _.uniq(_.union(_.map(response.results, "unitId"), _.map(uomAdjusts, "adjustFrom"), _.map(uomAdjusts, "adjustTo")));

        let [itemSpecMap, unitMap, adjustTypeEnumFields] = await Promise.all([
            itemSpecService(ctx).getItemSpecMap(itemSpecIds),
            itemUnitService(ctx).getUnitMap(unitIds),
            wmsApp(ctx).get('/enum/AdjustmentType')
        ]);

        for (let adjust of response.results) {
            let itemSpec = itemSpecMap[adjust.itemSpecId];
            let unit = unitMap[adjust.unitId];
            data.push({
                "Adjust ID": adjust._id,
                "Item ID": itemSpec ? itemSpec.name : adjust.itemSpecId,
                "Short Description": itemSpec ? itemSpec.shortDescription : "",
                "Description": itemSpec ? itemSpec.desc : "",
                "UOM": unit ? unitMap[adjust.unitId].name : adjust.unitId,
                "LPS": adjust.lpIds.join(","),
                "Adjust Type": _translateEnum(adjust.type),
                "From": _translateAdjustDetail(adjust.type, adjust.adjustFrom),
                "To": _translateAdjustDetail(adjust.type, adjust.adjustTo),
                "Reason": adjust.reason,
                "Notes": adjust.notes,
                "Date & Time": adjust.createdWhen ? momentZone(adjust.createdWhen).format('YYYY-MM-DD HH:mm:ss') : "",
                "Adjusted By": adjust.createdBy
            })
        }

        function _translateAdjustDetail(adjustType, adjustDetail) {
            switch (adjustType) {
                case "ADJUST_UOM" :
                    return unitMap[adjustDetail] ? unitMap[adjustDetail].name : adjustDetail;
                    break;


                default:
                    return adjustDetail;

            }
        }

        function _translateEnum(adjustType) {
            let enumField = _.find(adjustTypeEnumFields, e => e.dbValue === adjustType);
            return enumField ? enumField.webValue : adjustType;
        }

        return data;
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
    return (ctx) => service(app, ctx);
};
