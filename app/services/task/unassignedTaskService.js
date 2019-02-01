const _ = require('lodash');
let service = (app, ctx) => {
    async function searchByPaging(criteria) {
        let head = [
            "Entry ID",
            "Equipment #",
            "Location",
            "Task ID",
            "Task Type",
            "Customer",
            "Priority",
            "Wait Time"
        ];
        let shortHead = [
            "Entry ID",
            "Task ID",
            "Customer",
            "Priority",
            "Wait Time"
        ];
        criteria.excludeTaskTypes = ["QC"];

        let taskSearch = new TaskSearch(criteria);
        let criteriaClause = taskSearch.buildClause();

        if (!criteriaClause.assigneeUserId) {
            criteriaClause.assigneeUserId = {
                $eq: null
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


        let packTaskIds = _.map(_.filter(taskData.results, function (o) {
            return o.taskType === "PACK";
        }), "_id");

        let putBackTaskIds = _.map(_.filter(taskData.results, function (o) {
            return o.taskType === "PUT_BACK";
        }), "_id");

        let receiveTasks = await receiveTaskCollection(ctx).find({_id: {$in: receiveTaskIds}}).toArray();

        let loadTasks = await loadTaskCollection(ctx).find({_id: {$in: loadTaskIds}}).toArray();
        let pickTasks = await pickTaskCollection(ctx).find({_id: {$in: pickTaskIds}}).toArray();
        let packTasks = await packTaskCollection(ctx).find({_id: {$in: packTaskIds}}).toArray();
        let putBackTasks = await putBackTaskCollection(ctx).find({_id: {$in: putBackTaskIds}}).toArray();

        let loadIds = _.flatMap(loadTasks, "loadIds");
        let loadOrderLines = await loadOrderLineCollection(ctx).find({loadId: {$in: loadIds}}).toArray();

        let receiveTaskMap = _.keyBy(receiveTasks, "_id");
        let pickTaskMap = _.keyBy(pickTasks, "_id");
        let packTaskMap = _.keyBy(packTasks, "_id");
        let putBackTaskMap = _.keyBy(putBackTasks, "_id");

        _.forEach(loadTasks, function (task) {
            task.orderIds = getLoadTaskOrderIds(task.loadIds);
        });

        let loadTaskGroup = _.groupBy(loadTasks, "_id");

        let loadTaskArrays = [];
        _.forEach(loadTaskGroup, function (value, key) {
            loadTaskArrays.push({_id: key, orderIds: _.flatMap(value, "orderId")});
        });
        let loadTaskMap = _.keyBy(loadTaskArrays, "_id");
        let putBackTaskGroup = _.groupBy(putBackTaskMap, "_id");
        let putBackTaskArrays = [];
        _.forEach(putBackTaskGroup, function (value, key) {
            putBackTaskArrays.push({_id: key, orderIds: _.map(value.reference, "orderId")});
        });
        let putBackTaskOrderMap = _.keyBy(putBackTaskArrays, "_id");

        let taskMaps = {
            "RECEIVE": receiveTaskMap,
            "PICK": pickTaskMap,
            "PACK": packTaskMap,
            "LOAD": loadTaskMap,
            "PUT_BACK": putBackTaskOrderMap
        };

        let dockTasks = _.union(receiveTasks, loadTasks);
        let dockIds = _.union(_.map(receiveTasks, "dockId"), _.map(loadTasks, "dockId"));
        let docks = _.isEmpty(dockIds) ? [] : await locationCollection(ctx).find({_id: {$in: dockIds}}).toArray();
        let taskDocks = getTaskDocks(dockTasks, docks);
        let taskDockMap = _.keyBy(taskDocks, "_id");

        let taskCustomerMap = await getTaskCustomerMap(taskData.results, taskMaps);
        let taskEntryIds = getTaskEntryIds(taskData.results, receiveTasks, loadTasks);
        let entryIds = _.flatMap(taskEntryIds, "entryId");
        let equipments = [];
        if (!_.isEmpty(entryIds)) {
            equipments = await ymsApp(ctx).post('/yard-equipment/search', {
                "checkInEntries": entryIds,
                "checkOutEntries": entryIds
            });
        }


        let data = [];
        for (let task of taskData.results) {
            data.push({
                "Entry ID": getEntryId(task, receiveTasks, loadTasks),
                "Equipment #": getEquipmentNo(getEntryId(task, receiveTasks, loadTasks), equipments),
                "Location": taskDockMap[task._id] ? taskDockMap[task._id].dockName : "",
                "Task ID": task._id,
                "Task Type": task.taskType,
                "Customer": taskCustomerMap[task._id] ? taskCustomerMap[task._id].customerName : "",
                "Priority": task.priority,
                "Wait Time": commonService(ctx).calculateDuration(task.createdWhen, momentZone())

            })

        }

        return {
            results: {
                data: data,
                head: head,
                shortHead: shortHead
            },
            paging: taskData.paging
        }


    }

    function getEquipmentNo(entryId, equipments) {
        let equipmentNo = "";
        if (!_.isEmpty(equipments)) {
            let equipmentNos = _.map(_.filter(equipments, o => entryId === o.checkInEntry), "equipmentNo");
            equipmentNo = _.join(equipmentNos, ",");
        }
        return equipmentNo;

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

    function getLoadTaskOrderIds(loadIds, loadOrderLines) {
        if (_.isEmpty(loadIds) || _.isEmpty(loadOrderLines)) {
            return [];
        }
        let orderIds = [];
        _.forEach(loadOrderLines, function (loadOrderLine) {
            if (_.includes(loadIds, loadOrderLine.loadId)) {
                orderIds.push(loadOrderLine.orderId);
            }
        });
        return orderIds;
    }

    function getEntryId(task, receiveTasks, loadTasks) {
        let receiveTaskGroup = _.keyBy(receiveTasks, "_id");
        let loadTaskGroup = _.keyBy(loadTasks, "_id");

        if (task.taskType == "RECEIVE") {
            return receiveTaskGroup[task._id].entryId ? receiveTaskGroup[task._id].entryId : "";
        } else if (task.taskType === "LOAD") {
            return loadTaskGroup[task._id].entryId ? loadTaskGroup[task._id].entryId : "";
        }
        return "";
    }

    function getTaskEntryIds(tasks, receiveTasks, loadTasks) {
        let receiveTaskGroup = _.keyBy(receiveTasks, "_id");
        let loadTaskGroup = _.keyBy(loadTasks, "_id");
        let entryIds = [];
        _.forEach(tasks, function (task) {
            if (task.taskType == "RECEIVE") {
                if (loadTaskGroup[task._id] && receiveTaskGroup[task._id].entryId) {
                    entryIds.push({_id: task._id, entryId: receiveTaskGroup[task._id].entryId})
                }
            } else if (task.taskType === "LOAD") {
                if (loadTaskGroup[task._id] && loadTaskGroup[task._id].entryId) {
                    entryIds.push({_id: task._id, entryId: loadTaskGroup[task._id].entryId})
                }
            }
        })

        return entryIds;

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

    async function getCustomerById(customerId) {
        let organizationMap = await organizationService(ctx).getOrganizationMap([customerId]);
        return organizationMap[customerId].name;
    }

    class TaskSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                assigneeUserId: new MongoOperator('$eq', 'assigneeUserId'),
                taskTypes: new MongoOperator('$in', 'taskType'),
                statuses: new MongoOperator('$in', 'status'),
                excludeTaskTypes: new MongoOperator('$nin', 'taskType')

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