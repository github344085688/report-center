const _ = require('lodash');

let inProgressStatuses = ["IN_PROGRESS"];

let service = (app, ctx) => {

    async function searchByPaging(criteria) {
        let generalReceiveTasks = await generalTaskCollection(ctx).find({taskType:"RECEIVE", "status": {$in: inProgressStatuses}}).toArray();
        let receiveTasks = await receiveTaskCollection(ctx).find({_id:{$in: _.map(generalReceiveTasks, "_id")}}).toArray();
        let inProgressReceiptIds = _getFlatMap(receiveTasks, "receiptIds");
        if (_.isEmpty(inProgressReceiptIds)) {
            return _noInProgressReceipt();
        }

        _.set(criteria, "receiptIds", inProgressReceiptIds);
        let receiptSearch = new ReceiptSearch(criteria);
        let result = await receiptCollection(ctx).findByPaging(receiptSearch.buildClause());
        let receipts = result.results;
        let receiptIds = _.map(receipts, "_id");

        let receiptItemLineSearch = new ReceiptItemLineSearch({receiptIds: receiptIds});
        let receiptItemLines = await receiptItemLineCollection(ctx).find(receiptItemLineSearch.buildClause()).toArray();
        let receiptItemLineGroup = _.groupBy(receiptItemLines, "receiptId");
        _addNoItemLineReceiptIntoMap(receiptItemLineGroup, receiptIds);

        let reports = await _toReports(receiptItemLineGroup, generalReceiveTasks, receiveTasks, receipts);

        return _buildResponse(reports, result.paging);
    }

    function _addNoItemLineReceiptIntoMap(receiptItemLineGroup, receiptIds) {
        let hasItemLineReceiptIds = _.keys(receiptItemLineGroup);
        let noItemLineReceiptIds = _.difference(receiptIds, hasItemLineReceiptIds);

        _.forEach(noItemLineReceiptIds, receiptId => receiptItemLineGroup[receiptId] = []);
    }

    async function _toReports(receiptItemLineGroup, generalReceiveTasks, receiveTasks, receipts) {
        let reports = [];
        let generalReceiveTaskMap = _.keyBy(generalReceiveTasks, "_id");
        let receiveTaskMap = _getReceiptTaskMap(receiveTasks);
        let receiptMap = _.keyBy(receipts, "_id");


        let dockIds = _.uniq(_.map(receiveTasks, "dockId"));
        let entryIds = _.uniq(_.map(receiveTasks, "entryId"));
        let customerIds = _.uniq(_.map(receipts, "customerId"));

        let [dockMap, entryEquipmentMap, organizationMap, userMap, receiptLPMap, liveLoadEntries] = await Promise.all([
            _getDockMap(dockIds),
            _getEntryEquipmentMap(entryIds),
            organizationService(ctx).getOrganizationMap(customerIds),
            _getTaskUserMap(generalReceiveTasks),
            _getReceiptLPMap(_getRelatedTaskIds(receiveTaskMap, receipts), _.map(receipts, "_id")),
            _getLiveLoadEntryIds(entryIds)
        ]);

        for (let receiptId in receiptItemLineGroup) {
            let receiptItemLines = receiptItemLineGroup[receiptId];

            let report = await  _toReport(receiptId, receiptItemLines, generalReceiveTaskMap, receiveTaskMap, receiptMap, dockMap, entryEquipmentMap, organizationMap, userMap, receiptLPMap, liveLoadEntries);
            reports.push(report);
        }

        return reports;
    }

    function _getRelatedTaskIds(receiveTaskMap, receipts) {
        let receiptIds = _.map(receipts, "_id");
        let taskIds = [];

        _.forEach(receiveTaskMap, (task, receiptId) => {
            if (_.includes(receipts, receiptId)) {
                taskIds.push(task._id);
            }
        });

        return _.uniq(taskIds);
    }

    function _getReceiptTaskMap(receiveTasks) {
        let receiptTaskMap = {};

        _.forEach(receiveTasks, receiveTask => {
            _.forEach(receiveTask.receiptIds, receiptId => receiptTaskMap[receiptId] = receiveTask);
        });

        return receiptTaskMap;
    }

    async function _toReport(receiptId, receiptItemLines, generalReceiveTaskMap, receiveTaskMap, receiptMap, dockMap, entryEquipmentMap, organizationMap, userMap, receiptLPMap, liveLoadEntries) {

        let receiveTask = receiveTaskMap[receiptId];
        let generalReceiveTask = generalReceiveTaskMap[receiveTask._id];
        let receipt = receiptMap[receiptId];

        let equiment = entryEquipmentMap[receiveTask.entryId] || {};
        generalReceiveTask.startTime = generalReceiveTask.startTime || momentZone();
        generalReceiveTask.endTime = generalReceiveTask.endTime || momentZone();
        let loadingTime = momentZone(generalReceiveTask.endTime).diff(momentZone(generalReceiveTask.startTime), 'minutes');
        let leftTime = loadingTime > 120 ? 0 : 120 - loadingTime;
        let isLiveLoad = _.includes(liveLoadEntries, receiveTask.entryId);

        let totalPallets = _getTotalPallets(receiptItemLines);
        let report = {
            "Entry ID": receiveTask.entryId,
            "RN #": receiptId,
            "Equipment Type": equiment.type || "",
            "Equipment #": equiment.equipmentNo || "",
            "Location": dockMap[receiveTask.dockId] ? dockMap[receiveTask.dockId].name : "",
            "Receive Type": receipt.receiveType,
            "Task ID": receiveTask._id,
            "Worker": userMap[generalReceiveTask.assigneeUserId].username,
            "Customer": organizationMap[receipt.customerId] ? organizationMap[receipt.customerId].name : "",
            "Total Pallets": totalPallets,
            "Progress": await _getProgress(receiptId, receiptLPMap, receiptItemLines) ,
            "Offload Time": Math.floor(loadingTime/60) > 0 ? `${Math.floor(loadingTime / 60)} hr ${loadingTime % 60} min` : `${loadingTime % 60} min`,
            "Time Left": _getRemainTime(isLiveLoad, leftTime)
        };

        return report;
    }

    function _getTotalPallets(receiptItemLines) {
        if (_.isEmpty(receiptItemLines)) return 0;

        if (!_.isArray(receiptItemLines)) {
            return receiptItemLines.palletQty || 0;
        }

        return _.sumBy(_.filter(receiptItemLines, o => o.palletQty), "palletQty");
    }

    async function _getProgress(receiptId, receiptLPMap, receiptItemLines) {
        let progress = 0;

        let unitIds = _.uniq(_.filter(_.map(receiptItemLines, "unitId"), o => o));
        let lpItems = _.flatMap(_.flatMap(_.filter(_.values(receiptLPMap), o => !_.isEmpty(o))), "items");
        unitIds = _.uniq(_.union(unitIds, _.filter(_.map(lpItems, "unitId"), o => o)));

        let unitMap = {};
        if (!_.isEmpty(unitIds)) {
            unitMap = await itemUnitService(ctx).getUnitMap(unitIds);
        }

        let receiptLPs = receiptLPMap[receiptId] || [];
        let receiptItems = _.filter(_.flatMap(receiptLPs, "items"), o => o);
        let totalRequiredQty = _.sumBy(receiptItemLines, itemLine => itemLine.qty * unitMap[itemLine.unitId].baseQty);
        let totalReceivedQty = _.sumBy(receiptItems, item => {
            if (_.isEmpty(unitMap[item.unitId])) {
                console.log(item);
            }
            return item.qty * unitMap[item.unitId].baseQty
        });

        if (receiptItemLines <= 0 || totalRequiredQty <= 0 || totalReceivedQty > totalRequiredQty) {
            progress = 1;
        } else {
            progress = totalReceivedQty / totalRequiredQty;
        }

        return `${Math.floor(progress * 1000) / 10}%`;
    }

    function _getRemainTime(isLiveLoad, leftTime) {
        if (!isLiveLoad) return 'N/A';

        return Math.floor(leftTime/60) > 0 ? `${Math.floor(leftTime / 60)} hr ${leftTime % 60} min` : `${leftTime % 60} min`;
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

        let users = await idmApp(ctx).post("/user/search", { "idmUserIds": userIds });

        return _.keyBy(users, "idmUserId");
    }

    async function _getReceiptLPMap(taskIds, receiptIds) {
        let lpSetUpSearch = new LPSetUpSearch({taskIds: taskIds, receiptIds: receiptIds});
        let receivedLPs = await receiveLpSetupCollection(ctx).find(lpSetUpSearch.buildClause()).toArray();

        let receiptLPMap = {};
        _.forEach(receivedLPs, receivedLP => {
            _.forEach(receivedLP.lpDetails, lpDetail => {
                let receiptLPs = receiptLPMap[lpDetail.receiptId] || [];
                receiptLPs.push(lpDetail);
                receiptLPMap[lpDetail.receiptId] = receiptLPs;
            });
        });

        return receiptLPMap;
    }

    async function _getLiveLoadEntryIds(entryIds) {
        if (_.isEmpty(entryIds)) return [];

        let liveLoadEntries = await entryTicketCheckCollection(ctx).find({entryId: {$in: entryIds}, containerOperation:"LIVE_LOAD"}).toArray();

        return _.uniq(_.map(liveLoadEntries, "entryId"));
    }

    function _buildResponse(data, paging) {
        return {
            results: {
                data: data,
                head: [
                    "Entry ID",
                    "RN #",
                    "Equipment Type",
                    "Equipment #",
                    "Location",
                    "Receive Type",
                    "Task ID",
                    "Worker",
                    "Customer",
                    "Total Pallets",
                    "Progress",
                    "Offload Time",
                    "Time Left"
                ],
                shortHead: [
                    "RN #",
                    "Equipment",
                    "Customer",
                    "Progress",
                    "Offload Time"
                ]
            },
            paging: paging
        };
    }



    function _noInProgressReceipt() {
        return _buildResponse([]);
    }

    function _getFlatMap(collection, field) {
        return _.filter(_.flatMap(collection, field), o => o);
    }

    class ReceiptSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                receiptIds: new MongoOperator('$in', '_id'),
            };
        }
    }

    class ReceiptItemLineSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                receiptIds: new MongoOperator('$in', 'receiptId')
            };
        }
    }

    class LPSetUpSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                taskIds: new MongoOperator('$in', 'taskId'),
                receiptIds: new MongoOperator('$in', 'lpDetails.receiptId')
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