const _ = require('lodash');
let service = (app, ctx) => {
    async function searchByPaging(criteria) {
        let head = [
            "Task Type",
            "Task ID",
            "Order #",
            "Location",
            "Customer",
            "Worker",
            "Progress",
            "Duration",
            "Status"
        ];
        let shortHead = [
            "Task Type",
            "Task ID",
            "Order #",
            "Progress",
            "Status"
        ];

        let taskSearch = new TaskSearch(criteria);
        let criteriaClause = taskSearch.buildClause();

        if (!criteriaClause.createdWhenFrom) {
            let startDate = momentZone().add(-7, 'days').startOf('day').format('YYYY-MM-DD HH:mm:ss');
            criteriaClause.createdWhen = {
                $gte: new Date(startDate)
            };
        }
        if (!criteriaClause.status) {
            criteriaClause.status = {
                $eq: "IN_PROGRESS"
            }
        }


        let taskData = await generalTaskCollection(ctx).findByPaging(criteriaClause);
        if (!taskData.results || taskData.results.length === 0) {
            return {
                results: {
                    data: [],
                    head: head,
                    shortHead: shortHead
                },
                paging: taskData.paging
            }
        }
        let taskIds = _.map(taskData.results, "_id");
        let receiveTaskIds = _.map(_.filter(taskData.results, function (o) {
            return o.taskType === "RECEIVE";
        }), "_id");

        let loadTaskIds = _.map(_.filter(taskData.results, function (o) {
            return o.taskType === "LOAD";
        }), "_id");

        let pickTaskIds = _.map(_.filter(taskData.results, function (o) {
            return o.taskType === "PICK";
        }), "_id");

        let qcTaskIds = _.map(_.filter(taskData.results, function (o) {
            return o.taskType === "QC";
        }), "_id");

        let packTaskIds = _.map(_.filter(taskData.results, function (o) {
            return o.taskType === "PACK";
        }), "_id");

        let putBackTaskIds = _.map(_.filter(taskData.results, function (o) {
            return o.taskType === "PUT_BACK";
        }), "_id");

        let receiveTasks = await receiveTaskCollection(ctx).find({_id: {$in: receiveTaskIds}}).toArray();

        let loadTasks = await loadTaskCollection(ctx).find({_id: {$in: loadTaskIds}}).toArray();
        let pickTasks = await pickTaskCollection(ctx).find({_id: {$in: pickTaskIds}}).toArray();
        let qcTasks = await qcTaskCollection(ctx).find({_id: {$in: qcTaskIds}}).toArray();
        let packTasks = await packTaskCollection(ctx).find({_id: {$in: packTaskIds}}).toArray();
        let putBackTasks = await putBackTaskCollection(ctx).find({_id: {$in: putBackTaskIds}}).toArray();

        let loadIds = _.flatMap(loadTasks, "loadIds");
        let loadOrderLines = await loadOrderLineCollection(ctx).find({loadId: {$in: loadIds}}).toArray();

        let receiveTaskMap = _.keyBy(receiveTasks, "_id");
        let pickTaskMap = _.keyBy(pickTasks, "_id");
        let qcTaskMap = _.keyBy(qcTasks, "_id");
        let packTaskMap = _.keyBy(packTasks, "_id");
        let putBackTaskMap = _.keyBy(putBackTasks, "_id");


        let loadTaskArrays = getLoadTaskOrderIds(loadTasks, loadOrderLines);
        let loadTaskMap = _.keyBy(loadTaskArrays, "_id");

        let putBackTaskGroup = _.groupBy(putBackTaskMap, "_id");
        let putBackTaskOrderArrays = [];
        _.forEach(putBackTaskGroup, function (value, key) {
            putBackTaskOrderArrays.push({_id: key, orderIds: _.map(value.reference, "orderId")});
        });
        let putBackTaskOrderMap = _.keyBy(putBackTaskOrderArrays, "_id");

        let taskMaps = {
            "RECEIVE": receiveTaskMap,
            "PICK": pickTaskMap,
            "PACK": packTaskMap,
            "LOAD": loadTaskMap,
            "QC": qcTaskMap,
            "PUT_BACK": putBackTaskOrderMap
        };

        let dockTasks = _.union(receiveTasks, loadTasks);
        let dockIds = _.union(_.map(receiveTasks, "dockId"), _.map(loadTasks, "dockId"));
        let docks = _.isEmpty(dockIds) ? [] : await locationCollection(ctx).find({_id: {$in: dockIds}}).toArray();
        let taskDocks = getTaskDocks(dockTasks, docks);
        let taskDockMap = _.keyBy(taskDocks, "_id");

        let genericSteps = await genericStepCollection(ctx).find({taskId: {$in: taskIds}}).toArray();
        let genericStepGroup = _.groupBy(genericSteps, "taskId");

        let assigneeUserIds = getAssigneeUserIdsByTasks(taskData.results, genericSteps);
        let userMap = await userService(ctx).getUserMap(assigneeUserIds, genericStepGroup);

        let taskCustomerMap = await getTaskCustomerMap(taskData.results, taskMaps);


        let data = [];
        _.forEach(taskData.results, function (task) {
            fillTaskAssigneeWithUserMap(task, userMap, genericStepGroup)
            let worker = task.assignee ? task.assignee : (task.plannedAssignee ? task.plannedAssignee : "");
            data.push({
                "Task Type": task.taskType,
                "Task ID": task._id,
                "Order #": getTaskOrders(task, taskMaps),
                "Location": taskDockMap[task._id] ? taskDockMap[task._id].dockName : "",
                "Customer": taskCustomerMap[task._id] ? taskCustomerMap[task._id].customerName : "",
                "Worker": worker ? worker.username : "",
                "Progress": calProgress(genericStepGroup[task._id]),
                "Duration": commonService(ctx).calculateDuration(task.createdWhen, momentZone()),
                "Status": task.status
            });
        })

        return {
            results: {
                data: data,
                head: head,
                shortHead: shortHead
            },
            paging: taskData.paging
        }
    };

    function getLoadTaskOrderIds(loadTasks, loadOrderLines) {
        let loadTaskOrderIds = [];
        _.forEach(loadTasks, function (task) {
            let orderIds = _.flatMap(_.filter(loadOrderLines, e => {
                return _.includes(task.loadIds, e.loadId);
            }), "orderId");
            if (!_.isEmpty(orderIds)) {
                loadTaskOrderIds.push({_id: task._id, orderIds: orderIds});
            }
        })

        return loadTaskOrderIds;

    }

    function getTaskDocks(tasks, docks) {
        let taskDocks = [];
        let dockMap = _.keyBy(docks, "_id");
        _.forEach(tasks, function (task) {
            let dock = dockMap[task.dockId];
            if (dock) {
                taskDocks.push({_id: task._id, dockName: dock.name});
            }
        })
        return taskDocks;
    }


    function getTaskOrders(task, taskMaps) {
        let taskMap = taskMaps[task.taskType];
        if (taskMap) {
            if (taskMap[task._id]) {
                if (task.taskType == "RECEIVE") {
                    return taskMap[task._id].receiptIds ? _.join(taskMap[task._id].receiptIds, ",") : "";
                }
                return taskMap[task._id].orderIds ? _.join(taskMap[task._id].orderIds, ",") : "";
            }
        }
        return "";

    }

    function fillTaskAssigneeWithUserMap(task, userMap, genericStepGroup) {
        if (task.assigneeUserId) {
            task.assignee = userMap[task.assigneeUserId];
        }
        if (task.plannedAssigneeUserId) {
            task.plannedAssignee = userMap[task.plannedAssigneeUserId];
        }
        if (_.isEmpty(genericStepGroup[task._id])) return;
        genericStepGroup[task._id].forEach(step => {
            if (!_.isEmpty(step.assigneeUserIds)) {
                let stepAssignees = [];
                step.assigneeUserIds.forEach(assigneeUserId => stepAssignees.push(userMap[assigneeUserId]));
                step.assignees = stepAssignees;
            }
        });
    }

    function getAssigneeUserIdsByTasks(tasks, genericStepGroup) {
        let assigneeUserIds = [];
        tasks.forEach(task => {
            if (task.assigneeUserId) {
                assigneeUserIds.push(task.assigneeUserId);
            }
            if (task.plannedAssigneeUserId) {
                assigneeUserIds.push(task.plannedAssigneeUserId);
            }
            assigneeUserIds = _.union(assigneeUserIds, _.flatMap(genericStepGroup[task._id], "assigneeUserIds"));
        });
        return assigneeUserIds;
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


    async function getTaskCustomerMap(tasks, taskMaps) {
        let taskCustomerArrays = [];
        let taskReceiveIdArrays = [];
        let receiveTasks = _.filter(tasks, s => s.taskType == "RECEIVE");
        if (!_.isEmpty(receiveTasks)) {
            _.forEach(receiveTasks, function (task) {
                let taskMap = taskMaps[task.taskType];
                if (taskMap) {
                    let receiptIds = taskMap[task._id] ? taskMap[task._id].receiptIds : [];
                    if (receiptIds && receiptIds.length > 0) {
                        taskReceiveIdArrays.push({_id: task._id, receiptId: receiptIds[0]});
                    }
                }

            })
        }
        let receiptIds = _.flatMap(taskReceiveIdArrays, "receiptId");
        if (!_.isEmpty(receiptIds)) {
            let receipts = await receiptCollection(ctx).find({_id: {$in: receiptIds}}).toArray();
            let receiptMap = _.keyBy(receipts, "_id");
            let customerIds = _.map(receipts, "customerId");
            let customerMap = await organizationService(ctx).getOrganizationMap(customerIds);
            _.forEach(taskReceiveIdArrays, function (o) {
                let receipt = receiptMap[o.receiptId];
                if (receipt) {
                    let customer = customerMap[receipt.customerId];
                    if (customer) {
                        taskCustomerArrays.push({
                            _id: o._id,
                            customerName: customer.name
                        })
                    }
                }
            })
        }

        let taskOrderIdArrays = [];
        _.forEach(tasks, function (task) {
            let taskMap = taskMaps[task.taskType];
            if (taskMap) {
                let orderIds = taskMap[task._id] ? taskMap[task._id].orderIds : [];
                if (orderIds && orderIds.length > 0) {
                    taskOrderIdArrays.push({
                            _id: task._id,
                            orderId: orderIds[0]
                        }
                    )
                }
            }

        })

        let orderIds = _.flatMap(taskOrderIdArrays, "orderId");
        if (_.isEmpty(orderIds)) {
            let taskCustomerMap = _.keyBy(taskCustomerArrays, "_id");
            return taskCustomerMap;
        }
        ;
        let orders = await orderCollection(ctx).find({_id: {$in: orderIds}}).toArray();
        let orderMap = _.keyBy(orders, "_id");
        let customerIds = _.map(orders, "customerId");
        let customerMap = await organizationService(ctx).getOrganizationMap(customerIds);

        _.forEach(taskOrderIdArrays, function (o) {
            let order = orderMap[o.orderId];
            if (order) {
                let customer = customerMap[order.customerId];
                if (customer) {
                    taskCustomerArrays.push({
                        _id: o._id,
                        customerName: customer.name
                    })
                }
            }
        })
        let taskCustomerMap = _.keyBy(taskCustomerArrays, "_id");
        return taskCustomerMap;
    }

    class TaskSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                taskTypes: new MongoOperator('$in', 'taskType'),
                statuses: new MongoOperator('$in', 'status'),
                createdWhenFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
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