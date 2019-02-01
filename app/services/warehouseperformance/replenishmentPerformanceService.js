const _ = require('lodash');

let service = (app, ctx) => {
    async function searchHistoryByPaging(criteria) {
        let replenishmentHistorySearch = new ReplenishmentHistorySearch(criteria);
        let pagingResult = await replenishmentStepProcess(ctx).findByPaging(replenishmentHistorySearch.buildClause());
        return {
            results: {
                data: pagingResult.results,
                head: []
            },
            paging: pagingResult.paging
        }
    }

    async function searchHistory(criteria) {
        let replenishmentHistorySearch = new ReplenishmentHistorySearch(criteria);
        return await replenishmentStepProcess(ctx).find(replenishmentHistorySearch.buildClause()).toArray();
    }

    async function buildReport(histories) {
        let facility = _.upperFirst(_.split(app.conf.get('mySqlURI.wms.database'), '_')[0]);
        let header = ["Warehouse", "Description", "Employee ID", "Name", "Time", "Pieces", "Performance by Piece Qty", "Average time per piece", "PPH"];
        let data = [];

        let userNames = _.mapUniq(histories, "createdBy");
        let userMap = await userService(ctx).getUserMapByUserName(userNames);

        let employeeHistoryGroup = _.groupBy(histories, "createdBy");
        for (let employeeName of _.keys(employeeHistoryGroup)) {
            let hs = employeeHistoryGroup[employeeName];
            let workedTotalTime = performanceCommonService(ctx).getWorkedTotalTime(hs, "createdWhen");
            let workedTotalPieces = await performanceCommonService(ctx).getWorkedTotalPieces(_.filter(hs, o => o.replenishStatus !== "COLLECT"), "toUnitId", "qty");
            let user = userMap[employeeName];
            data.push({
                "Warehouse": facility,
                "Description": "Replenish",
                "Employee ID": employeeName,
                "Name": user.name,
                "Time": workedTotalTime,
                "Pieces": workedTotalPieces,
                "Performance by Piece Qty": _.round(workedTotalTime / workedTotalPieces, 2),
                "PPH": (workedTotalTime === 0) ? 0 : _.round(workedTotalPieces / (workedTotalTime / 3600), 1)
            })
        }
        performanceCommonService(ctx).fillAvgPiecePerformance(data);
        return {
            results: {
                "data": data,
                "head": header,
                "sheetName": "Replenish Performance"
            }
        }
    }

    class ReplenishmentHistorySearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                dateFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                dateTo: new MongoOperator('$lte', 'createdWhen', 'Date'),
                userName: new MongoOperator('$eq', 'createdBy')
            };
        }
    }

    return {
        searchHistory,
        searchHistoryByPaging,
        buildReport
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};