const _ = require('lodash');
const oneTimePickDuration = 7 * 60; //秒
const overTimePickDuration = 8 * 60; //秒

let service = (app, ctx) => {
    function fillAvgPiecePerformance(data) {
        let totalTimeOfAllEmployee = _.sumBy(data, "Time");
        let totalPieceOfAllEmployee = _.sumBy(data, "Pieces");
        let avgPiecePerformance = _.round((totalTimeOfAllEmployee / totalPieceOfAllEmployee), 1);
        _.each(data, o => {
            o["Average time per piece"] = avgPiecePerformance;
        });
    }

    function getWorkedTotalTime(histories, timeColumn) {
        let totalTime = 0;
        let historyGroup = _.groupBy(histories, "taskId");
        if (_.isEmpty(historyGroup)) return totalTime;
        _.each(historyGroup, (histories, taskId) => {
            let duration = 0;
            histories = _.orderBy(histories, [timeColumn], ["desc"]);
            if (_.size(histories) === 1) {
                duration = oneTimePickDuration;
            } else if (_.size(histories) > 1) {
                let endTime = momentZone(_.first(histories)[timeColumn]);
                let startTime = momentZone(_.last(histories)[timeColumn]);
                duration = (endTime - startTime) / 1000; //秒
                if (duration > 30 * 60) {
                    duration = overTimePickDuration;
                }
            }
            totalTime += duration;
        });
        return _.round(totalTime);
    }

    async function getWorkedTotalPieces(histories, unitIdColumn, qtyColumn) {
        let totalPieces = 0;
        if (_.isEmpty(histories)) return totalPieces;
        let unitIds = _.mapUniq(histories, unitIdColumn);
        let unitMap = await itemUnitService(ctx).getUnitMap(unitIds);
        _.each(histories, o => {
            let unit = unitMap[o[unitIdColumn]];
            if (_.isEmpty(unit)) return;
            totalPieces += unit.baseQty * o[qtyColumn];
        });
        return totalPieces;
    }

    return {
        fillAvgPiecePerformance,
        getWorkedTotalTime,
        getWorkedTotalPieces
    }

};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};