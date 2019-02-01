const _ = require('lodash');

let service = (app, ctx) => {
    async function buildWarehousePerformanceReport(criteria) {
        let [pickTasks, packHistories, replenishmentHistories] = await Promise.all([
            pickingPerformanceService(ctx).searchHistory(criteria),
            packingPerformanceService(ctx).searchHistory(criteria),
            replenishmentPerformanceService(ctx).searchHistory(criteria)
        ]);

        let [employeePickPerformanceReport, employeePackPerformanceReport, employeeReplenishPerformanceReport] = await Promise.all([
            pickingPerformanceService(ctx).buildReport(pickTasks, criteria.userName),
            packingPerformanceService(ctx).buildReport(packHistories),
            replenishmentPerformanceService(ctx).buildReport(replenishmentHistories)]);
        let taskLevelPerformanceReport = await _buildTaskLevelPerformanceReport(employeePickPerformanceReport.results.data, employeePackPerformanceReport.results.data, employeeReplenishPerformanceReport.results.data);

        return [taskLevelPerformanceReport, employeePickPerformanceReport, employeePackPerformanceReport, employeeReplenishPerformanceReport]
    }

    async function _buildTaskLevelPerformanceReport(pickPerformanceReport, packPerformanceReport, replenishPerformanceReport) {
        let header = ["Warehouse", "Task type Description", "Time", "Pieces", "Go To"];
        let pickHyperLinkToEmployeeSheet = "HYPERLINK(\"#'Pick Performance'!A1\",\"by Employee\")";
        let packHyperLinkToEmployeeSheet = "HYPERLINK(\"#'Pack Performance'!A1\",\"by Employee\")";
        let replenishHyperLinkToEmployeeSheet = "HYPERLINK(\"#'Replenish Performance'!A1\",\"by Employee\")";
        let pickOverallReportData = _buildOverallPerformanceReport(pickPerformanceReport, "Pick task", pickHyperLinkToEmployeeSheet);
        let packOverallReportData = _buildOverallPerformanceReport(packPerformanceReport, "Pack task", packHyperLinkToEmployeeSheet);
        let replenishOverallReportData = _buildOverallPerformanceReport(replenishPerformanceReport, "Replenish task", replenishHyperLinkToEmployeeSheet);
        let data = [pickOverallReportData, packOverallReportData, replenishOverallReportData];

        return {
            results: {
                "data": data,
                "head": header,
                "sheetName": "Performance Summary By Type"
            }
        }
    }

    function _buildOverallPerformanceReport(employeeLevelReportData, taskTypeDesc, hyperLink) {
        let facility = _.upperFirst(_.split(app.conf.get('mySqlURI.wms.database'), '_')[0]);
        return {
            "Warehouse": facility,
            "Task type Description": taskTypeDesc,
            "Time": _.sumBy(employeeLevelReportData, "Time"),
            "Pieces": _.sumBy(employeeLevelReportData, "Pieces"),
            "Go To": {f: hyperLink}
        }
    }

    return {
        buildWarehousePerformanceReport
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};