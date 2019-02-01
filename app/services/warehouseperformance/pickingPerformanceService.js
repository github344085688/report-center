const _ = require('lodash');

let service = (app, ctx) => {
    async function searchHistoryByPaging(criteria) {
        let pickHistorySearch = new PickHistorySearch(criteria);
        let pagingResult = await pickTaskCollection(ctx).findByPaging(pickHistorySearch.buildClause());
        return {
            results: {
                data: pagingResult.results,
                head: []
            },
            paging: pagingResult.paging
        }
    }

    async function searchHistory(criteria) {
        let pickHistorySearch = new PickHistorySearch(criteria);
        return await pickTaskCollection(ctx).find(pickHistorySearch.buildClause()).toArray();
    }

    async function searchAllHistories(criteria) {
        let param = {
            "pickedDateFrom": criteria.dateFrom,
            "pickedDateTo": criteria.dateTo,
            "pickedBy": criteria.userName
        };
        return await commonService(ctx).getAllPageDataFromAPI(wmsApp, "/outbound/pick/task/search-by-paging", param, "tasks");
    }

    async function buildReport(pickTasks, userName) {
        let facility = _.upperFirst(_.split(app.conf.get('mySqlURI.wms.database'), '_')[0]);
        let header = ["Warehouse", "Description", "Employee ID", "Name", "Time", "Pieces", "Performance by Piece Qty", "Average time per piece", "PPH"];
        let data = [];

        _.each(pickTasks, task => {
            _.each(task.pickHistories, history => {
                history.taskId = task._id;
            })
        });
        let histories = _.flatten(_.map(pickTasks, "pickHistories"));
        if (!_.isEmpty(userName)) {
            histories = _.filter(histories, o => o.pickedBy === userName);
        }

        let userNames = _.mapUniq(histories, "pickedBy");
        let userMap = await userService(ctx).getUserMapByUserName(userNames);

        let employeeHistoryGroup = _.groupBy(histories, "pickedBy");
        for (let employeeName of _.keys(employeeHistoryGroup)) {
            let hs = employeeHistoryGroup[employeeName];
            let workedTotalTime = performanceCommonService(ctx).getWorkedTotalTime(hs, "pickedWhen");
            let workedTotalPieces = _.sumBy(hs, "pickedBaseQty");
            let user = userMap[employeeName];
            data.push({
                "Warehouse": facility,
                "Description": "Pick",
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
                "sheetName": "Pick Performance"
            }
        }
    }

    class PickHistorySearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                dateFrom: new MongoOperator('$gte', 'pickHistories.pickedWhen', 'Date'),
                dateTo: new MongoOperator('$lte', 'pickHistories.pickedWhen', 'Date'),
                userName: new MongoOperator('$eq', 'pickHistories.pickedBy')
            };
        }
    }

    return {
        searchHistory,
        searchHistoryByPaging,
        buildReport,
        searchAllHistories
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};