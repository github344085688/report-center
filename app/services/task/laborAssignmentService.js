const _ = require('lodash');
let service = (app, ctx) => {
    async function getGenericStepGroup(tasks) {
        let taskIds = _.map(tasks, "_id");
        let genericSteps = await genericStepCollection(ctx).find({taskId: {$in: taskIds}}).toArray();
        let genericStepGroup = _.groupBy(genericSteps, "taskId");
        return genericStepGroup;
    }

    async function getAssigneeMap(userIds) {
        let userMap = await userService(ctx).getUserMap(userIds);
        return userMap;
    }

    async function searchByPaging(criteria) {
        let head = [
            "Assignee",
            "Task Type",
            "Task #",
            "Status",
            "Progress",
            "Duration"
        ];


        let taskSearch = new TaskSearch(criteria);
        let criteriaClause = taskSearch.buildClause();
        let generalTaskData = await generalTaskCollection(ctx).findByPaging(criteriaClause);
        if (_.isEmpty(generalTaskData.results)) {
            return {
                results: {
                    data: [],
                    head: head,
                    shortHead: head
                },
                paging: generalTaskData.paging
            }
        }


        let assigneeUserIds = _.map(generalTaskData.results, "assigneeUserId");
        let assigneeMap = await getAssigneeMap(assigneeUserIds);
        let genericStepGroup = await getGenericStepGroup(generalTaskData.results);

        let data = [];
        _.forEach(generalTaskData.results, function (task) {
            let waitTime = getTaskWaitTime(task);
            data.push({
                "Assignee": assigneeMap[task.assigneeUserId] ? assigneeMap[task.assigneeUserId].username : "",
                "Task Type": task.taskType,
                "Task #": task._id,
                "Status": task.status,
                "Progress": calProgress(genericStepGroup[task._id]),
                "Duration": commonService(ctx).calculateDuration(waitTime, momentZone())
            })

        })

        return {
            results: {
                data: data,
                head: head,
                shortHead: head
            },
            paging: generalTaskData.paging
        }


    }

    function getTaskWaitTime(task) {
        let waitTime = "";
        if (task) {
            let status = task.status;
            if (_.includes(["CLOSED", "FORCE_CLOSED", "CANCELLED"], status)) {
                if (task.updatedWhen) {
                    return task.updatedWhen;
                }
            } else {
                return task.createdWhen;
            }
        }

        return waitTime;

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

    function getTaskDocks(tasks, docks) {
        let taskDocks = [];
        let dockMap = _.keyBy(docks, "_id");
        _.forEach(tasks, function (task) {
            let dock = dockMap[task.dockId];
            if (dock) {
                taskDocks.push({_id: task._id, dockName: dock.name, dockStatus: dock.dockStatus});
            }
        })
        return taskDocks;
    }

    function calculateWaitDuration(time) {
        if (!time) {
            return "";
        }
        let now = momentZone();
        let checkInTime = momentZone(time);
        let durationTime = (now - checkInTime); //毫秒

        let days = durationTime / (3600000 * 24); //day
        if (_.floor(days) === 1) {
            return _.round((days)) + " day";
        }
        if (_.floor(days) > 1) {
            return _.round((days)) + " days";
        }

        let hours = durationTime / 3600000; //hour
        if (_.floor(hours) === 1) {
            return _.round((hours)) + " hr";
        }
        if (_.floor(hours) > 1) {
            result = _.round((hours)) + " hrs";
        }

        let mins = durationTime / 60000; //min
        return _.round((mins)) + " min"
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