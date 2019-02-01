const _ = require('lodash');
let service = (app, ctx) => {
    async function getGenericStepGroup(taskIds) {
        let genericSteps = await genericStepCollection(ctx).find({taskId: {$in: taskIds}}).toArray();
        let genericStepGroup = _.groupBy(genericSteps, "taskId");
        return genericStepGroup;
    }

    async function getEntryTicketCheckMap(entryIds) {
        let entryTicketChecks = await entryTicketCheckCollection(ctx).find({entryId: {$in: entryIds}}).toArray();
        let entryTicketCheckMap = _.keyBy(entryTicketChecks, "entryId");
        return entryTicketCheckMap;
    }

    async function getTaskMaps(entryIds, dockIds) {
        let loadTasks = await loadTaskCollection(ctx).find({
            entryId: {$in: entryIds},
            dockId: {$in: dockIds}
        }).toArray();
        let loadTaskIds = _.map(loadTasks, "_id");
        let loadTaskMap = _.keyBy(loadTasks, "dockId");

        let receiveTasks = await receiveTaskCollection(ctx).find({
            entryId: {$in: entryIds},
            dockId: {$in: dockIds}
        }).toArray();

        let receiveTaskIds = _.map(receiveTasks, "_id");
        let receiveTaskMap = _.keyBy(receiveTasks, "dockId");

        let taskIds = _.union(loadTaskIds, receiveTaskIds);

        let generalTasks = await generalTaskCollection(ctx).find({_id: {$in: taskIds}}).toArray();
        let generalTaskMap = _.keyBy(generalTasks, "_id");
        return {taskIds, loadTaskMap, receiveTaskMap, generalTaskMap};
    }

    async function searchByPaging(criteria) {
        let head = [
            "Dock #",
            "Status",
            "CT# / Trailer#",
            "Task ID",
            "Progress",
            "Gate Check In",
            "Dock Check In",
            "Duration"
        ];

        let dockLocations = await locationCollection(ctx).aggregateByPaging([
            {$match: {type: "DOCK"}},
            {$sort: {dockStatus: -1}}
        ]);

        let entryIds = _.map(dockLocations.results, "entryId");
        let dockIds = _.map(dockLocations.results, "_id");
        let {taskIds, loadTaskMap, receiveTaskMap, generalTaskMap} = await getTaskMaps(entryIds, dockIds);

        let genericStepGroup = await getGenericStepGroup(taskIds);
        let entryTicketCheckMap = await getEntryTicketCheckMap(entryIds);

        let entryTicketTimeLines = await entryTicketTimeLineCollection(ctx).find({entryId: {$in: entryIds}}).toArray();

        let data = [];
        _.forEach(dockLocations.results, function (dock) {
            let taskId = getTaskIdByDockId(dock._id, loadTaskMap, receiveTaskMap);
            let checkInTime = getDockCheckInTime(dock.entryId, entryTicketTimeLines);
            data.push({
                "Dock #": dock.name,
                "Status": dock.dockStatus ? dock.dockStatus : "AVAILABLE",
                "CT# / Trailer#": getContainerNoAndTrailerNo(entryTicketCheckMap, dock.entryId),
                "Task ID": taskId,
                "Progress": calProgress(genericStepGroup[taskId]),
                "Gate Check In": getGateCheckInTime(dock.entryId, entryTicketTimeLines),
                "Dock Check In": checkInTime,
                "Duration": commonService(ctx).calculateDuration(checkInTime, momentZone())
            })

        })

        return {
            results: {
                data: data,
                head: head,
                shortHead: head
            },
            paging: dockLocations.paging
        }


    }

    function getGateCheckInTime(entryId, entryTicketTimeLines) {
        if (!_.isEmpty(entryTicketTimeLines)) {
            for (let entryTicketTimeLine of entryTicketTimeLines) {
                if (entryTicketTimeLine.entryId == entryId && entryTicketTimeLine.checkAction === "GATE_CHECKIN") {
                    return momentZone(entryTicketTimeLine.createdWhen).format('YYYY-MM-DD HH:mm:ss');
                }
            }
        }
        return "";
    }

    function getDockCheckInTime(entryId, entryTicketTimeLines) {
        if (!_.isEmpty(entryTicketTimeLines)) {
            for (let entryTicketTimeLine of entryTicketTimeLines) {
                if (entryTicketTimeLine.entryId === entryId && entryTicketTimeLine.checkAction === "DOCK_CHECKIN") {
                    return momentZone(entryTicketTimeLine.createdWhen).format('YYYY-MM-DD HH:mm:ss');
                }
            }
        }
        return "";
    }

    function getTaskIdByDockId(dockId, loadTaskMap, receiveTaskMap) {
        if (loadTaskMap[dockId]) {
            return loadTaskMap[dockId]._id;
        }
        if (receiveTaskMap[dockId]) {
            return receiveTaskMap[dockId]._id;
        }
        return "";
    }

    function getDockCheckInDurationTime(dockCheckInTime) {
        let waitTime = "";
        if (dockCheckInTime != "") {
            let now = momentZone().format('YYYY-MM-DD HH:mm:ss');
            waitTime = momentZone(now).diff(momentZone(dockCheckInTime), 'minutes');
        }
        return waitTime;
    }

    function getTaskWaitTime(task) {
        let waitTime = "";
        if (task) {
            let status = task.status;
            if (_.includes(["CLOSED", "FORCE_CLOSED", "CANCELLED"], status)) {
                if (task.updatedWhen) {
                    waitTime = momentZone(task.updatedWhen).diff(momentZone(task.createdWhen), 'minutes');
                }
            } else {
                waitTime = momentZone(new Date()).diff(momentZone(task.createdWhen), 'minutes')
            }
        }

        return waitTime;

    }

    function getContainerNoAndTrailerNo(entryTicketCheckMap, entryId) {
        let result = "";
        let entryTicketCheck = entryTicketCheckMap[entryId];
        if (entryTicketCheck) {
            if (!_.isEmpty(entryTicketCheck.containerNOs)) {
                result += entryTicketCheck.containerNOs.join(",");
            }
            result += "/"
            if (!_.isEmpty(entryTicketCheck.trailers)) {
                result += entryTicketCheck.trailers.join(",")
            }
            if (result == "/") {
                return "";
            }
        }
        return result;
    }

    function calProgress(steps) {
        if (_.isEmpty(steps)) {
            return "0%";
        }
        let size = steps.length;
        let doneNumber = _.filter(steps, function (o) {
            return o.status === "DONE";
        }).length;
        doneNumber = doneNumber + _.filter(steps, function (o) {
            return o.status === "FORCE_CLOSED";
        }).length;
        return (doneNumber / size).toFixed(2) * 100 + "%";
    }


    class TaskSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                assigneeUserId: new MongoOperator('$eq', 'assigneeUserId'),
                taskTypes: new MongoOperator('$in', 'taskType'),
                statuses: new MongoOperator('$in', 'status'),

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