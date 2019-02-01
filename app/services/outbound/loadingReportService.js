const _ = require('lodash');
let inProgressStatuses = ["IN_PROGRESS"];

let service = (app, ctx) => {

    async function searchByPaging(criteria) {
        let generalLoadTasks = await generalTaskCollection(ctx).find({
            taskType: "LOAD",
            "status": {$in: inProgressStatuses}
        }).toArray();
        let loadTasks = await loadTaskCollection(ctx).find({_id: {$in: _.map(generalLoadTasks, "_id")}}).toArray();
        let loadIds = _getFlatMap(loadTasks, "loadIds");
        if (_.isEmpty(loadIds)) {
            return _noInProgressOrder();
        }

        _.set(criteria, "loadIds", loadIds);
        let loadOrderSearch = new LoadOrderSearch(criteria);
        let result = await loadOrderLineCollection(ctx).findByPaging(loadOrderSearch.buildClause());

        let loadOrders = result.results;
        let orderIds = _.flatMap(loadOrders, "orderId");
        let orderSearch = new OrderSearch({orderIds: orderIds})
        let orders = await orderCollection(ctx).find(orderSearch.buildClause()).toArray();

        let orderLPSearch = new OrderLPSearch({orderIds: orderIds});
        let orderLPs = await wmsMysql(ctx).query(`SELECT DISTINCT i.lpId, i.orderId, i.status FROM inventory i where i.qty > 0 and ${orderLPSearch.buildClause()}`);
        let needLoadLPs = _.filter(orderLPs, o => o.lpId);
        let orderLPGroup = _.groupBy(needLoadLPs, "orderId");
        _addNoLPToLoadOrderIntoMap(orderLPGroup, orderIds);

        let reports = await _toReports(orderLPGroup, generalLoadTasks, loadTasks, _.keyBy(loadOrders, "orderId"), orders);

        return _buildResponse(reports, result.paging);
    }

    function _addNoLPToLoadOrderIntoMap(orderLPGroup, orderIds) {
        let hasLPToLoadLPOrderIds = _.keys(orderLPGroup);
        let noLPToLoadOrderIds = _.difference(orderIds, hasLPToLoadLPOrderIds);

        _.forEach(noLPToLoadOrderIds, orderId => orderLPGroup[orderId] = []);
    }

    async function _toReports(orderLPGroup, generalLoadTasks, loadTasks, orderLoadMap, orders) {
        let reports = [];
        let generalLoadTaskMap = _.keyBy(generalLoadTasks, "_id");
        let loadTaskMap = _getLoadTaskMap(loadTasks);
        let orderMap = _.keyBy(orders, "_id");

        let dockIds = _.uniq(_.map(loadTasks, "dockId"));
        let entryIds = _.uniq(_.map(loadTasks, "entryId"));
        let customerIds = _.uniq(_.map(orders, "customerId"));

        let [dockMap, entryEquipmentMap, organizationMap, userMap, liveLoadEntries] = await Promise.all([
            _getDockMap(dockIds),
            _getEntryEquipmentMap(entryIds),
            organizationService(ctx).getOrganizationMap(customerIds),
            _getTaskUserMap(generalLoadTasks),
            _getLiveLoadEntryIds(entryIds)
        ]);

        for (let orderId in orderLPGroup) {
            let orderLPs = orderLPGroup[orderId];

            let report = await  _toReport(orderId, orderLPs, generalLoadTaskMap, loadTaskMap, orderLoadMap, orderMap, dockMap, entryEquipmentMap, organizationMap, userMap, liveLoadEntries);
            reports.push(report);
        }

        return reports;
    }

    function _getLoadTaskMap(loadTasks) {
        let loadTaskMap = {};

        _.forEach(loadTasks, loadTask => {
            _.forEach(loadTask.loadIds, loadId => loadTaskMap[loadId] = loadTask);
        });

        return loadTaskMap;
    }

    async function _toReport(orderId, orderLps, generalLoadTaskMap, loadTaskMap, orderLoadMap, orderMap, dockMap, entryEquipmentMap, organizationMap, userMap, liveLoadEntries) {

        let loadTask = loadTaskMap[orderLoadMap[orderId].loadId];
        let generalLoadTask = generalLoadTaskMap[loadTask._id];
        let order = orderMap[orderId];

        let equiment = entryEquipmentMap[loadTask.entryId] || {};
        generalLoadTask.startTime = generalLoadTask.startTime || momentZone();
        generalLoadTask.endTime = generalLoadTask.endTime || momentZone();
        let loadingTime = momentZone(generalLoadTask.endTime).diff(momentZone(generalLoadTask.startTime), 'minutes');
        let leftTime = loadingTime > 120 ? 0 : 120 - loadingTime;
        let isLiveLoad = _.includes(liveLoadEntries, loadTask.entryId);

        let lpIds = _.union(_.filter(_.map(orderLps, "lpId"), o => o));
        let loadedLPIds = _.union(_.filter(_.map(_.filter(orderLps, o => o.status === 'LOADED' || o.status === 'SHIPPED'), "lpId"), o => o));
        let [totalPallets, loadedPallets] = await Promise.all([
            _.isEmpty(lpIds) ? [] : wmsApp(ctx).post('/lp/outermost-lpId', lpIds),
            _.isEmpty(loadedLPIds) ? [] : wmsApp(ctx).post('/lp/outermost-lpId', loadedLPIds)
        ]);

        totalPallets = _.size(totalPallets);
        loadedPallets = _.size(loadedPallets);
        let report = {
            "Entry ID": loadTask.entryId,
            "DN #": orderId,
            "Equipment Type": equiment.type || "",
            "Equipment #": equiment.equipmentNo || "",
            "Location": dockMap[loadTask.dockId] ? dockMap[loadTask.dockId].name : "",
            "Order Type": order.orderType,
            "Task ID": loadTask._id,
            "Worker": userMap[generalLoadTask.assigneeUserId].username,
            "Account": organizationMap[order.customerId] ? organizationMap[order.customerId].name : "",
            "Total Pallets": totalPallets,
            "Progress": _getProgress(loadedPallets, totalPallets),
            "Loading Time": commonService(ctx).calculateDuration(generalLoadTask.startTime, generalLoadTask.endTime),//Math.floor(loadingTime/60) > 0 ? `${Math.floor(loadingTime / 60)} hr ${loadingTime % 60} min` : `${loadingTime % 60} min`,
            "Time Left": _getRemainTime(isLiveLoad, leftTime)
        };

        return report;
    }


    function _getProgress(loadedLPCount, totalPallets) {
        let progress = 0;
        if (totalPallets <= 0) {
            progress = 1;
        } else {
            progress = loadedLPCount / totalPallets;
        }

        return `${Math.floor(progress * 1000) / 10}%`;
    }

    function _getRemainTime(isLiveLoad, leftTime) {
        if (!isLiveLoad) return 'N/A';

        return Math.floor(leftTime / 60) > 0 ? `${Math.floor(leftTime / 60)} hr ${leftTime % 60} min` : `${leftTime % 60} min`;
    }

    async function _getDockMap(dockIds) {
        if (_.isEmpty(dockIds)) return {};

        let docks = await baseApp(ctx).post('/location/search', {"locationIds": dockIds});

        return _.keyBy(docks, "id");
    }

    async function _getEntryEquipmentMap(entryIds) {
        if (_.isEmpty(entryIds)) return {};

        let equipments = await ymsApp(ctx).post('/yard-equipment/search', {
            "checkInEntries": entryIds
        });

        return _.keyBy(equipments, "checkInEntry");
    }

    async function _getTaskUserMap(tasks) {
        let userIds = _getAssigneeUserIdsByTasks(tasks);

        return await _getUserMap(userIds);
    }

    function _getAssigneeUserIdsByTasks(tasks) {
        let assigneeUserIds = [];
        tasks.forEach(task => {
            if (task.assigneeUserId) {
                assigneeUserIds.push(task.assigneeUserId);
            }
            if (task.plannedAssigneeUserId) {
                assigneeUserIds.push(task.plannedAssigneeUserId);
            }
            assigneeUserIds = _.union(assigneeUserIds, _.flatMap(task.steps, "assigneeUserIds"));
        });
        return assigneeUserIds;
    }

    async function _getUserMap(userIds) {
        userIds = Array.from(userIds);
        if (_.isEmpty(userIds)) return {};

        let users = await idmApp(ctx).post("/user/search", {"idmUserIds": userIds});

        return _.keyBy(users, "idmUserId");
    }

    async function _getLiveLoadEntryIds(entryIds) {
        if (_.isEmpty(entryIds)) return [];

        let liveLoadEntries = await entryTicketCheckCollection(ctx).find({
            entryId: {$in: entryIds},
            containerOperation: "LIVE_LOAD"
        }).toArray();

        return _.uniq(_.map(liveLoadEntries, "entryId"));
    }

    function _buildResponse(data, paging) {
        return {
            results: {
                data: data,
                head: [
                    "Entry ID",
                    "DN #",
                    "Equipment Type",
                    "Equipment #",
                    "Location",
                    "Order Type",
                    "Task ID",
                    "Worker",
                    "Account",
                    "Total Pallets",
                    "Progress",
                    "Loading Time",
                    "Time Left"
                ],
                shortHead: [
                    "DN #",
                    "Equipment #",
                    "Account",
                    "Progress",
                    "Loading Time"
                ]
            },
            paging: paging
        }
    }

    function _noInProgressOrder() {
        return _buildResponse([]);
    }

    function _getFlatMap(collection, field) {
        return _.filter(_.flatMap(collection, field), o => o);
    }

    class LoadOrderSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                loadIds: new MongoOperator('$in', 'loadId')
            };
        }
    }

    class OrderSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                orderIds: new MongoOperator('$in', '_id')
            };
        }
    }

    class OrderLPSearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                orderIds: new DBOperator('IN', 'orderId')
            };
        }
    }

    return {
        searchByPaging
    }
}

module.exports = function (app) {
    return (ctx) => service(app, ctx);
}