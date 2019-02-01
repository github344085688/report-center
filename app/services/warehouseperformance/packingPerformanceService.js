const _ = require('lodash');

let service = (app, ctx) => {
    async function searchHistoryByPaging(criteria) {
        let packHistorySearch = new PackHistorySearch(criteria);
        let pagingResult = await packHistoryCollection(ctx).findByPaging(packHistorySearch.buildClause());
        return {
            results: {
                data: pagingResult.results,
                head: []
            },
            paging: pagingResult.paging
        }
    }

    async function searchHistory(criteria) {
        let packHistorySearch = new PackHistorySearch(criteria);
        return await packHistoryCollection(ctx).find(packHistorySearch.buildClause()).toArray();
    }

    async function buildReport(histories) {
        let facility = _.upperFirst(_.split(app.conf.get('mySqlURI.wms.database'), '_')[0]);
        let header = ["Warehouse", "Description", "Employee ID", "Name", "Time", "Pieces", "Performance by Piece Qty", "Average time per piece", "PPH"];
        let data = [];

        let userNames = _.mapUniq(histories, "packedBy");
        let userMap = await userService(ctx).getUserMapByUserName(userNames);

        let employeeHistoryGroup = _.groupBy(histories, "packedBy");
        for (let employeeName of _.keys(employeeHistoryGroup)) {
            let hs = employeeHistoryGroup[employeeName];
            let workedTotalTime = performanceCommonService(ctx).getWorkedTotalTime(hs, "packedWhen");
            let workedTotalPieces = await performanceCommonService(ctx).getWorkedTotalPieces(hs, "unitId", "qty");
            let user = userMap[employeeName];
            data.push({
                "Warehouse": facility,
                "Description": "Pack",
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
                "sheetName": "Pack Performance"
            }
        }
    }

    class PackHistorySearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                dateFrom: new MongoOperator('$gte', 'packedWhen', 'Date'),
                dateTo: new MongoOperator('$lte', 'packedWhen', 'Date'),
                userName: new MongoOperator('$eq', 'packedBy')
            };
        }
    }

    return {
        searchHistory,
        searchHistoryByPaging,
        buildReport,
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};