const _ = require('lodash'),
    request = require('superagent');
const ObjectID = require('mongodb-core').BSON.ObjectID;
    moment = require('moment');

let service = (app, ctx) => {

    async function buildActivityReport(criteria) {
        _validate(criteria);

        let [receiveInfo, outboundInfo] = await Promise.all([
            _getRelatedReceiveInfo(criteria),
            _getRelatedOutboundInfo(criteria)
        ]);
        let receiptDevannedTimeMap = receiveInfo.receiptDevannedTimeMap || {};
        let orderShippedTimeMap = outboundInfo.orderShippedTimeMap || {};
        let receiveTaskIds = receiveInfo.receiveTaskIds || [];
        let pickTaskIds = outboundInfo.pickTaskIds || [];
        let packTaskIds = outboundInfo.packTaskIds || [];
        let loadTaskIds = outboundInfo.loadTaskIds || [];
        let tasks = await generalTaskCollection(ctx).find({_id: {$in: _.union(receiveTaskIds, pickTaskIds, packTaskIds, loadTaskIds)}}).toArray();
        let [, receivedLPs, packTasks, packHistories, loadTasks, loadingSteps] = await Promise.all([
            userService(ctx).fillTasksAssignee(tasks),
            _.isEmpty(receiveTaskIds) ? [] : receiveLpSetupCollection(ctx).find({taskId: {$in: receiveTaskIds}}).toArray(),
            _.isEmpty(packTaskIds) ? [] : packTaskCollection(ctx).find({_id: {$in: packTaskIds}}).toArray(),
            _.isEmpty(packTaskIds) ? [] : packHistoryCollection(ctx).find(_getPackHistoryFilter(packTaskIds, criteria)).toArray(),
            _.isEmpty(loadTaskIds) ? [] : loadTaskCollection(ctx).find({_id: {$in: loadTaskIds}}).toArray(),
            _.isEmpty(loadTaskIds) ? [] : loadingStepCollection(ctx).find({taskId: {$in: loadTaskIds}}).toArray()
        ]);

        let [receiveTaskDetailMap, pickDetailReport, packTaskDetailMap, loadTaskDetailMap] = await Promise.all([
            _toTaskReceiveDetailMap(receivedLPs, receiptDevannedTimeMap, criteria),
            _getPickDetailReport(_.merge({taskIds: pickTaskIds}, criteria), orderShippedTimeMap),
            _toTaskPackDetailMap(packTasks, packHistories, orderShippedTimeMap),
            _toTaskLoadDetailMap(loadTasks, loadingSteps, criteria)
        ]);

        let pickDetailData = pickDetailReport.results.data;
        let receiveDetailData = [];
        let packDetailData = [];
        let loadDetailData = [];
        for (let task of tasks) {
            if (task.taskType === "RECEIVE") {
                let receiveTaskDetails = receiveTaskDetailMap[task._id] || [];
                _.forEach(receiveTaskDetails, taskDetail => {
                    receiveDetailData.push(_buildRow(task, taskDetail));
                });
            }
            if (task.taskType === "PACK") {
                let packTaskDetails = packTaskDetailMap[task._id] || [];
                _.forEach(packTaskDetails, taskDetail => {
                    packDetailData.push(_buildRow(task, taskDetail));
                });
            }
            if (task.taskType === "LOAD") {
                let loadTaskDetails = loadTaskDetailMap[task._id] || [];
                _.forEach(loadTaskDetails, taskDetail => {
                    loadDetailData.push(_buildRow(task, taskDetail));
                });
            }
        }

        let receiptIds = _.uniq(_.filter(_.map(receiveDetailData, "RN"), o => o));
        let orderIds = _.uniq(_.filter(_.union(_.map(pickDetailData, "DN"), _.map(packDetailData, "DN"), _.map(loadDetailData, "DN")), o => o))

        let [materialData, manualBillData] = await Promise.all([
            _getMaterialData(criteria, receiptIds, orderIds, receiveTaskIds, pickTaskIds, packTaskIds, loadTaskIds),
            _toManualBillingDetails(criteria, receiptIds, orderIds, receiptDevannedTimeMap, orderShippedTimeMap)
        ]);

        return [
            _buildReport(_.union(_toSummaryRows(receiveDetailData), _toSummaryRows(pickDetailReport.results.data), _toSummaryRows(packDetailData), _toSummaryRows(loadDetailData)), _buildSummaryHead(), "Summary"),
            _buildReport(receiveDetailData, _buildHead("RECEIVE"), "Receive Task"),
            pickDetailReport,
            _buildReport(packDetailData, _buildHead("PACK"), "Pack Task"),
            _buildReport(loadDetailData, _buildHead("LOAD"), "Load Task"),
            _buildReport(materialData, ["TASKID", "TASKTYPE", "STATUS", "CUSTOMERID", "CUSTOMERNAME", "SUPPLIERID", "TITLE", "SHIPTO", "RN/DN", "ASSIGNEE", "ITEMID", "ITEM DESCRIPTION", "UOM", "QTY", "CARRIER", "SCAC CODE", "EQUIPMENT NO.", "EQUIPMENT TYPE", "REFERENCE NO.", "PONO.", "PRONO.", "SONO.", "RECEIVED TIME", "SHIPPED TIME"], "Materials"),
            _buildReport(manualBillData, ["RN/DN#", "ACCOUNT ITEM", "DESCRIPTION", "NOTES", "UOM", "QTY", "RECEIVED TIME", "SHIPPED TIME"], "Accessories")
        ];
    }

    function _getPackHistoryFilter(packTaskIds, criteria) {
        let filter = {taskId: {$in: packTaskIds}};
        if (criteria.itemSpecId) {
            _.merge(filter, {itemSpecId: criteria.itemSpecId});
        }
        if (criteria.lpId) {
            _.merge(filter, {$or: [{fromLPId: criteria.lpId}, {toLPId: criteria.lpId}]});
        }

        return filter;
    }

    async function _getRelatedReceiveInfo(criteria) {
        let receipts = [];
        let taskIds = [];
        if (_isSearchByReceivedTime(criteria)) {
            let receiptSearch = new ReceiptSearch(criteria);
            receipts = await receiptCollection(ctx).find(receiptSearch.buildClause(), {projection: {_id:1, devannedTime:1}}).toArray();
            let receiptIds = _.map(receipts, "_id");
            if (criteria.supplierId || criteria.itemSpecId) {
                let searchCriteria = {receiptId: {$in: receiptIds}};
                if (criteria.supplierId) _.merge(searchCriteria, {supplierId: criteria.supplierId});
                if (criteria.itemSpecId) _.merge(searchCriteria, {itemSpecId: criteria.itemSpecId});
                let receiptItemLines = await receiptItemLineCollection(ctx).find(searchCriteria, {projection: {_id:1, receiptId:1}}).toArray();
                receiptIds = _.uniq(_.map(receiptItemLines, "receiptId"));
            }
            let receiveTasks = await receiveTaskCollection(ctx).find({receiptIds: {$in: receiptIds}}, {projection: {_id:1}}).toArray();
            taskIds = _.map(receiveTasks, "_id");
        }
        if (_isSearchByTaskDate(criteria)) {
            let taskSearch = new TaskSearch(_.merge({taskTypes: ["RECEIVE"]}, criteria));
            let generalTasks = await generalTaskCollection(ctx).find(taskSearch.buildClause()).toArray();
            taskIds = _.map(generalTasks, "_id");
            let receiveTasks = await receiveTaskCollection(ctx).find({_id: {$in: taskIds}}, {projection: {_id:1, receiptIds:1}}).toArray();
            let receiptIds = _.uniq(_.filter(_.flatMap(receiveTasks, "receiptIds"), o => o));
            if (!_.isEmpty(receiptIds)) {
                let receiptSearch = new ReceiptSearch(_.merge({receiptIds: receiptIds}, criteria));
                receipts = await receiptCollection(ctx).find(receiptSearch.buildClause(), {
                    projection: {
                        _id: 1,
                        devannedTime: 1
                    }
                }).toArray();
                receiptIds = _.map(receipts, "_id");
                if (criteria.supplierId || criteria.itemSpecId) {
                    let searchCriteria = {receiptId: {$in: receiptIds}};
                    if (criteria.supplierId) _.merge(searchCriteria, {supplierId: criteria.supplierId});
                    if (criteria.itemSpecId) _.merge(searchCriteria, {itemSpecId: criteria.itemSpecId});
                    let receiptItemLines = await receiptItemLineCollection(ctx).find(searchCriteria, {
                        projection: {
                            _id: 1,
                            receiptId: 1
                        }
                    }).toArray();
                    receiptIds = _.uniq(_.map(receiptItemLines, "receiptId"));
                }
                receiveTasks = _.filter(receiveTasks, task => !_.isEmpty(_.intersection(task.receiptIds, receiptIds)));
                taskIds = _.map(receiveTasks, "_id");
            }
        }

        let receiptDevannedTimeMap = {};
        _.forEach(receipts, receipt => receiptDevannedTimeMap[receipt._id] = receipt.devannedTime || "");

        return {receiveTaskIds: taskIds, receiptDevannedTimeMap: receiptDevannedTimeMap};
    }

    async function _getRelatedOutboundInfo(criteria) {
        if (!_isSearchByTaskDate(criteria) && !_isSearchByShippedTime(criteria)) return {};

        let orders = [];
        let pickTaskIds = [];
        let packTaskIds = [];
        let loadTaskIds = [];
        if (_isSearchByShippedTime(criteria)) {
            let orderSearch = new OrderSearch(criteria);
            orders = await orderCollection(ctx).find(orderSearch.buildClause(), {projection: {_id:1, shippedTime:1}}).toArray();
            let orderIds = _.map(orders, "_id");
            if (criteria.supplierId || criteria.itemSpecId) {
                let searchCriteria = {orderId: {$in: orderIds}};
                if (criteria.supplierId) _.merge(searchCriteria, {supplierId: criteria.supplierId});
                if (criteria.itemSpecId) _.merge(searchCriteria, {itemSpecId: criteria.itemSpecId});
                let orderItemLines = await orderItemLineCollection(ctx).find(searchCriteria, {projection: {_id:1, orderId:1}}).toArray();
                orderIds = _.uniq(_.map(orderItemLines, "orderId"));
            }
            let [pickTasks, packTasks, loads] = await Promise.all([
                _.isEmpty(orderIds) ? [] : pickTaskCollection(ctx).find({orderIds: {$in: orderIds}}, {projection: {_id:1}}).toArray(),
                _.isEmpty(orderIds) ? [] : packTaskCollection(ctx).find({orderIds: {$in: orderIds}}, {projection: {_id:1}}).toArray(),
                _.isEmpty(orderIds) ? [] : loadOrderLineCollection(ctx).find({orderId: {$in: orderIds}}, {projection: {_id:1, loadId:1}}).toArray()
            ]);

            let loadIds = _.map(loads, "loadId");
            let loadTasks = _.isEmpty(loadIds) ? [] : await loadTaskCollection(ctx).find({loadIds: {$in: loadIds}}, {projection: {_id:1}}).toArray();

            pickTaskIds = _.map(pickTasks, "_id");
            packTaskIds = _.map(packTasks, "_id");
            loadTaskIds = _.map(loadTasks, "_id");
        }

        if (_isSearchByTaskDate(criteria)) {
            let taskSearch = new TaskSearch(criteria);
            let [generalTasks, closedPickTasks] = await Promise.all([
                generalTaskCollection(ctx).find(taskSearch.buildClause()).toArray(),
                generalTaskCollection(ctx).find(new TaskSearch(_.merge({taskTypes:["PICK"]}, criteria)).buildClause()).toArray(),
            ]);
            generalTasks = _.union(generalTasks, closedPickTasks);
            let pickTaskIdSet = new Set();
            let packTaskIdSet = new Set();
            let loadTaskIdSet = new Set();
            _.forEach(generalTasks, task => {
                switch (task.taskType) {
                    case "PICK": pickTaskIdSet.add(task._id); break;
                    case "PACK": packTaskIdSet.add(task._id); break;
                    case "LOAD": loadTaskIdSet.add(task._id); break;
                    default: break;
                }
            });
            pickTaskIds = Array.from(pickTaskIdSet);
            packTaskIds = Array.from(packTaskIdSet);
            loadTaskIds = Array.from(loadTaskIdSet);

            let inventorySearch = new InventorySearch(criteria);
            let whereClause = inventorySearch.buildClause();
            if (whereClause && (!_.isEmpty(pickTaskIds) || !_.isEmpty(packTaskIds) || !_.isEmpty(loadTaskIds))) {
                let clause = _buildOrClause(pickTaskIds, packTaskIds, loadTaskIds);
                whereClause += _.isEmpty(clause) ? '' : ` and (${clause})`;
                let sql = `SELECT DISTINCT pickTaskId, packTaskId, loadTaskId, orderId FROM inventory WHERE qty>0 and ${whereClause}`;
                let relatedTaskInfos = await wmsMysql(ctx).query(sql);

                pickTaskIdSet = new Set();
                packTaskIdSet = new Set();
                loadTaskIdSet = new Set();
                let orderIdSet = new Set();
                _.forEach(relatedTaskInfos, relatedTaskInfo => {
                    if (relatedTaskInfo.orderId) orderIdSet.add(relatedTaskInfo.orderId);
                    if (relatedTaskInfo.pickTaskId) pickTaskIdSet.add(relatedTaskInfo.pickTaskId);
                    if (relatedTaskInfo.packTaskId) packTaskIdSet.add(relatedTaskInfo.packTaskId);
                    if (relatedTaskInfo.loadTaskId) loadTaskIdSet.add(relatedTaskInfo.loadTaskId);
                });

                pickTaskIds = _.intersection(pickTaskIds, Array.from(pickTaskIdSet));
                packTaskIds = _.intersection(packTaskIds, Array.from(packTaskIdSet));
                loadTaskIds = _.intersection(loadTaskIds, Array.from(loadTaskIdSet));

                orders = await orderCollection(ctx).find({_id: {$in: Array.from(orderIdSet)}}, {projection: {_id:1, shippedTime:1}}).toArray();
            }
        }

        let orderShippedTimeMap = {};
        _.forEach(orders, order => orderShippedTimeMap[order._id] = order.shippedTime || "");

        return {pickTaskIds: pickTaskIds, packTaskIds: packTaskIds, loadTaskIds: loadTaskIds, orderShippedTimeMap: orderShippedTimeMap};
    }

    function _buildOrClause(pickTaskIds, packTaskIds, loadTaskIds) {
        let clause = '';
        if (!_.isEmpty(pickTaskIds)) {
            clause += `pickTaskId in ('${pickTaskIds.join("','")}')`
        }
        if (!_.isEmpty(packTaskIds)) {
            clause += (_.isEmpty(clause) ? '' : ' or ') + `packTaskId in ('${packTaskIds.join("','")}')`
        }
        if (!_.isEmpty(loadTaskIds)) {
            clause += (_.isEmpty(clause) ? '' : ' or ') + `loadTaskId in ('${loadTaskIds.join("','")}')`
        }
        return clause;
    }

    function _buildReport(data, header, sheetName) {
        return {
            results: {
                "data": data,
                "head": header,
                "sheetName": sheetName
            }
        }
    }

    async function _toTaskReceiveDetailMap(receivedLPs, receiptDevannedTimeMap, criteria) {
        if (_.isEmpty(receivedLPs)) return {};

        let taskReceiveDetailMap = _.groupBy(receivedLPs, "taskId");
        let receiptIdSet = new Set();
        let itemLineIdSet = new Set();
        let unitIdSet = new Set();
        let lpTemplateIdSet = new Set();
        let lpItems = [];
        _.forEach(taskReceiveDetailMap, (lps, taskId) => {
            let lpDetails = _.flatMap(lps, "lpDetails");
            _.forEach(lpDetails, lpDetail => {
                receiptIdSet.add(lpDetail.receiptId);
                let idRn = {lpId: lpDetail.lpId, receiptId: lpDetail.receiptId, lpTemplateId: lpDetail.lpTemplateId};
                if (lpDetail.lpTemplateId) {
                    lpTemplateIdSet.add(lpDetail.lpTemplateId);
                }
                let receivedTime = {receivedTime: receiptDevannedTimeMap[lpDetail.receiptId || ""] || ""};
                _.forEach(lpDetail.items, item => {
                    itemLineIdSet.add(item.itemLineId);
                    unitIdSet.add(item.unitId);
                    lpItems.push(_.merge(item, idRn, {taskId: taskId}, receivedTime));
                });
            });
        });

        let [receipts, itemLines, unitMap, lpTemplates, receiptEquipmentMap] = await Promise.all([
            _.isEmpty(receiptIdSet) ? [] : receiptCollection(ctx).find({_id: {$in: Array.from(receiptIdSet)}}, {projection: {_id:1, customer:1, titleId:1, carrierId:1, palletQty:1, poNo:1, referenceNo:1}}).toArray(),
            _.isEmpty(itemLineIdSet) ? [] : receiptItemLineCollection(ctx).find({_id: {$in: _.map(Array.from(itemLineIdSet), id => new ObjectID(id))}}, {projection: {_id:1, receiptId:1, itemSpecId:1, supplierId:1}}).toArray(),
            _.isEmpty(unitIdSet) ? {} : itemUnitService(ctx).getUnitMap(Array.from(unitIdSet)),
            _.isEmpty(lpTemplateIdSet) ? [] : singleItemLpConfigurationCollection(ctx).find({_id: {$in: Array.from(lpTemplateIdSet)}}, {projection: {_id:1, name:1, totalQty:1}}).toArray(),
            _.isEmpty(receiptIdSet) ? {} : _getEntryEquipmentsMap(Array.from(receiptIdSet), "RECEIVE")
        ]);

        _.forEach(itemLines, itemLine => {
            itemLine._id = itemLine._id.toString();
        });

        let receiptMap = _.keyBy(receipts, "_id");
        let itemLineMap = _.keyBy(itemLines, "_id");
        let lpTemplateMap = _.keyBy(lpTemplates, "_id");
        let carrierIds = _.filter(_.uniq(_.map(receipts, "carrierId")), o => o);
        let organizationIds = _.filter(_.uniq(_.union(_.map(receipts, "customerId"), _.map(receipts, "titleId"), _.map(receipts, "carrierId"), _.map(itemLines, "supplierId"))), o => o);
        let itemSpecIds = _.filter(_.union(_.map(itemLines, "itemSpecId")), o => o);

        let [carrierMap, organizationMap, itemSpecs] = await Promise.all([
            _.isEmpty(carrierIds) ? {} : carrierService(ctx).getCarrierMap(carrierIds),
            _.isEmpty(organizationIds) ? {} : organizationService(ctx).getOrganizationMap(organizationIds),
            _.isEmpty(itemSpecIds) ? [] : itemSpecCollection(ctx).find({_id: {$in: itemSpecIds}}, {projection: {_id:1, name:1, desc:1, grade:1}}).toArray()
        ]);

        let itemSpecMap = _.keyBy(itemSpecs, "_id");

        _.forEach(lpItems, lpItem => {
            let receipt = receiptMap[lpItem.receiptId] || {};
            let itemLine = itemLineMap[lpItem.itemLineId] || {};
            let uom = unitMap[lpItem.unitId] || {};
            let itemSpec = itemSpecMap[itemLine.itemSpecId] || {};
            let equipment = receiptEquipmentMap[lpItem.receiptId] || {};
            let lpConfiguration = lpItem.lpTemplateId && lpTemplateMap[lpItem.lpTemplateId] ? lpTemplateMap[lpItem.lpTemplateId] : {};
            lpItem.customerId = receipt.customerId || "";
            lpItem.customerName = organizationMap[lpItem.customerId] ? organizationMap[lpItem.customerId].name : "";
            lpItem.supplierId = itemLine.supplierId || "";
            lpItem.supplierName = organizationMap[lpItem.supplierId] ? organizationMap[lpItem.supplierId].name : "";
            lpItem.titleId = receipt.titleId || "";
            lpItem.titleName = organizationMap[lpItem.titleId] ? organizationMap[lpItem.titleId].name : "";
            lpItem.itemSpecId = itemLine.itemSpecId || "";
            lpItem.itemDescription = itemSpec.desc || "";
            lpItem.itemName = itemSpec.name || "";
            lpItem.grade = itemSpec.grade || "";
            lpItem.uom = uom.name || "";
            lpItem.carrierId = receipt.carrierId || "";
            lpItem.carrierName = organizationMap[lpItem.carrierId] ? organizationMap[lpItem.carrierId].name : "";
            lpItem.palletQty = receipt.palletQty || "";
            lpItem.scacCode = carrierMap[receipt.carrierId] ? carrierMap[receipt.carrierId].scac : "";
            lpItem.equipmentNo = equipment.equipmentNo || "";
            lpItem.equipmentType = equipment.equipmentType || "";
            lpItem.unitsPallet = lpConfiguration.totalQty || "";
            lpItem.lpConfiguration = lpConfiguration.name || "";
            lpItem.itemCFT = _getItemCFT(lpItem.qty, uom);
            lpItem.itemWGT = _getItemWGT(lpItem.qty, uom);
            lpItem.referenceNo = receipt.referenceNo || "";
            lpItem.poNo = receipt.poNo || "";
        });

        let filter = {};
        if (criteria.itemSpecId) _.merge(filter, {itemSpecId: criteria.itemSpecId});
        if (criteria.lpId) _.merge(filter, {lpId: criteria.lpId});
        if (!_.isEmpty(filter)) {
            lpItems = _.filter(lpItems, filter);
        }

        let taskDetailMap = _.groupBy(lpItems, "taskId");
        return taskDetailMap;
    }

    async function _getPickDetailReport(criteria, orderShippedDateMap) {
        let cloneCriteria = _.cloneDeep(criteria);
        _.unset(cloneCriteria, "timeFrom");
        _.unset(cloneCriteria, "timeTo");
        let pickDetailReport = _.isEmpty(cloneCriteria.taskIds) ? pickDetailReportService(ctx).emptyResult() : await commonService(ctx).getAllPages(pickDetailReportService(ctx).searchByPaging, cloneCriteria);
        let pickTaskMap = {};
        if (!_.isEmpty(cloneCriteria.taskIds)) {
            let pickTasks = await generalTaskCollection(ctx).find({_id: {$in: cloneCriteria.taskIds}}, {projection: {_id:1, status:1}}).toArray();
            pickTaskMap = _.keyBy(pickTasks, "_id");
        }
        _.forEach(pickDetailReport.results.data, row => {
            row["STARTTIME"] = _formatTime(row["STARTTIME"]);
            row["ENDTIME"] = _formatTime(row["ENDTIME"]);
            row["SHIPPED TIME"] = _formatTime(orderShippedDateMap[row["DN"]] || "");
            row["STATUS"] = pickTaskMap[row["TASKID"] || ""] ? pickTaskMap[row["TASKID"] || ""].status : "";
        });
        if (cloneCriteria.itemSpecId || cloneCriteria.lpId) {
            let itemSpec = !cloneCriteria.itemSpecId ? {} : await itemSpecCollection(ctx).findOne({_id: cloneCriteria.itemSpecId}, {projection: {_id:1, name:1, desc:1, grade:1}});
            pickDetailReport.results.data = _.filter(pickDetailReport.results.data, o => {
                let meetFilter = true;
                if (cloneCriteria.itemSpecId) meetFilter = meetFilter && o["ITEM"] === itemSpec.name
                if (cloneCriteria.lpId) meetFilter = meetFilter && o["FROMLPNO."] === cloneCriteria.lpId || o["TOLPNO."] === cloneCriteria.lpId
                return meetFilter;
            });
        }
        pickDetailReport.results.head.splice(2, 0,"STATUS");
        pickDetailReport.results.head.push("SHIPPED TIME");
        pickDetailReport.results.sheetName = "Pick Task";
        return pickDetailReport;
    }

    async function _toTaskPackDetailMap(packTasks, packHistories, orderShippedDateMap) {
        if (_.isEmpty(packTasks)) return {};

        let taskPackDetailMap = _.groupBy(packHistories, "taskId");
        let lpIds = _.uniq(_.union(_.map(packHistories, "fromLPId"), _.map(packHistories, "toLPId")));

        let inventorySearch = new InventorySearch({lpIds: lpIds});
        let sql = `SELECT distinct packTaskId as taskId, itemSpecId, lpId, orderId FROM inventory WHERE ${inventorySearch.buildClause()}`;
        let lpPackDetails = _.isEmpty(lpIds) ? [] : await wmsMysql(ctx).query(sql);
        let lpOrderMap = _.keyBy(lpPackDetails, _buildPackItemKey);
        let orderIds = _.uniq(_.map(lpPackDetails, "orderId"));

        let lpSearch = new LPSearch({lpIds: lpIds});
        let lpSearchSql = `SELECT id as lpId, confId FROM lp WHERE ${lpSearch.buildClause()}`;
        let lps = _.isEmpty(lpIds) ? [] : await wmsMysql(ctx).query(lpSearchSql);
        let lpTemplateIds = _.filter(_.uniq(_.map(lps, "confId")));
        let lpConfMap = _.keyBy(lps, "lpId");

        let unitIds = _.uniq(_.map(packHistories, "unitId"));
        let [orders, itemLines, unitMap, lpTemplates] = await Promise.all([
            _.isEmpty(orderIds) ? [] : orderCollection(ctx).find({_id: {$in: orderIds}}, {projection: {_id:1, customerId:1, poNo:1, referenceNo:1, shipToAddress:1}}).toArray(),
            _.isEmpty(orderIds) ? [] : orderItemLineCollection(ctx).find({orderId: {$in: orderIds}}, {projection: {_id:1, orderId:1, itemSpecId:1, titleId:1, supplierId:1, lotNo:1}}).toArray(),
            _.isEmpty(unitIds) ? {} : itemUnitService(ctx).getUnitMap(unitIds),
            _.isEmpty(lpTemplateIds) ? {} : singleItemLpConfigurationCollection(ctx).find({_id: {$in: lpTemplateIds}}, {projection: {_id:1, name:1, totalQty:1}}).toArray()
        ]);

        let lpItems = [];
        _.forEach(taskPackDetailMap, (taskPackHistories) => {
            _.forEach(taskPackHistories, packHistory => {
                let lpOrder = lpOrderMap[_buildPackItemKey(packHistory, "fromLPId")] || lpOrderMap[_buildPackItemKey(packHistory, "toLPId")] || {};
                let item = {lpId: packHistory.fromLPId, toLPNo: packHistory.toLPId || "", orderId: lpOrder.orderId || "", lpTemplateId: lpConfMap[packHistory.fromLPId] || ""};
                let shippedTime = {shippedTime: orderShippedDateMap[lpOrder.orderId || ""] || ""};
                lpItems.push(_.merge(packHistory, item, shippedTime));
            });
        });

        _.forEach(itemLines, itemLine => {
            itemLine._id = itemLine._id.toString();
        });

        let orderMap = _.keyBy(orders, "_id");
        let lpTemplateMap = _.keyBy(lpTemplates, "_id");
        let organizationIds = _.filter(_.uniq(_.union(_.map(orders, "customerId"), _.map(itemLines, "titleId"), _.map(itemLines, "supplierId"))), o => o);
        let itemSpecIds = _.filter(_.union(_.map(itemLines, "itemSpecId")), o => o);

        let [organizationMap, itemSpecs] = await Promise.all([
            _.isEmpty(organizationIds) ? {} : organizationService(ctx).getOrganizationMap(organizationIds),
            _.isEmpty(itemSpecIds) ? [] : itemSpecCollection(ctx).find({_id: {$in: itemSpecIds}}, {projection: {_id:1, name:1, desc:1, grade:1}}).toArray()
        ]);

        let itemSpecMap = _.keyBy(itemSpecs, "_id");

        _.forEach(lpItems, lpItem => {
            let order = orderMap[lpItem.orderId] || {};
            let itemLine = _.first(_.filter(itemLines, {orderId: lpItem.orderId, itemSpecId: lpItem.itemSpecId})) || {};
            let uom = unitMap[lpItem.unitId] || {};
            let itemSpec = itemSpecMap[itemLine.itemSpecId || ""] || {};
            let lpConfiguration = lpItem.lpTemplateId && lpTemplateMap[lpItem.lpTemplateId] ? lpTemplateMap[lpItem.lpTemplateId] : {};
            lpItem.customerId = order.customerId || "";
            lpItem.customerName = organizationMap[lpItem.customerId] ? organizationMap[lpItem.customerId].name : "";
            lpItem.supplierId = itemLine.supplierId || "";
            lpItem.supplierName = organizationMap[lpItem.supplierId] ? organizationMap[lpItem.supplierId].name : "";
            lpItem.titleId = itemLine.titleId || "";
            lpItem.titleName = organizationMap[lpItem.titleId] ? organizationMap[lpItem.titleId].name : "";
            lpItem.shipTo = _.get(order, "shipToAddress.name"),
            lpItem.itemDescription = itemSpec.desc || "";
            lpItem.itemName = itemSpec.name || "";
            lpItem.grade = itemSpec.grade || "";
            lpItem.lotNo = itemLine.lotNo || "";
            lpItem.uom = uom.name || "";
            lpItem.isPallet = lpItem.isEntireLPPack ? "Y" : "N";
            lpItem.packQty = lpItem.qty || "";
            lpItem.unitsPallet = lpConfiguration.totalQty || "";
            lpItem.lpConfiguration = lpConfiguration.name || "";
            lpItem.itemCFT = _getItemCFT(lpItem.qty, uom);
            lpItem.itemWGT = _getItemWGT(lpItem.qty, uom);
            lpItem.referenceNo = order.referenceNo || "";
            lpItem.poNo = order.poNo || "";
        });

        let taskDetailMap = _.groupBy(lpItems, "taskId");
        return taskDetailMap;
    }

    function _buildPackItemKey(packItem, lpIdField) {
        let lpId = _.get(packItem, "lpId");
        if (lpIdField) {
            lpId = _.get(packItem, lpIdField);
        }
        return `${packItem.packTaskId}|${packItem.itemSpecId}|${lpId}`;
    }

    async function _toTaskLoadDetailMap(loadTasks, loadingSteps, criteria) {
        if (_.isEmpty(loadTasks)) return {};

        let loadTaskIds = _.map(loadTasks, "_id");
        let loadItemSearch = new LoadItemSearch({loadTaskIds: loadTaskIds});
        let sql = `SELECT loadTaskId, orderId, lpId, itemSpecId, unitId, sum(ifnull(qty, 0)) as shippedQty, shippedWhen as shippedTime FROM inventory WHERE qty > 0 and ${loadItemSearch.buildClause()} group by loadTaskId, orderId, lpId, itemSpecId, unitId`;
        let loadItems = await wmsMysql(ctx).query(sql);

        let orderIdSet = new Set();
        let lpIdSet = new Set();
        let itemSpecIdSet = new Set();
        let unitIdSet = new Set();
        _.forEach(loadItems, loadItem => {
            orderIdSet.add(loadItem.orderId);
            lpIdSet.add(loadItem.lpId);
            itemSpecIdSet.add(loadItem.itemSpecId);
            unitIdSet.add(loadItem.unitId);
        });

        let lpSearch = new LPSearch({lpIds: Array.from(lpIdSet)});
        let lpSearchSql = `SELECT id as lpId, confId FROM lp WHERE ${lpSearch.buildClause()}`;
        let lps = await wmsMysql(ctx).query(lpSearchSql);
        let lpTemplateIds = _.filter(_.uniq(_.map(lps, "confId")));
        let lpConfMap = _.keyBy(lps, "lpId");

        let loadIds = _.flatMap(loadTasks, "loadIds");

        let [orders, itemLines, unitMap, lpTemplates, loadEquipmentMap, loadOrderLines] = await Promise.all([
            _.isEmpty(orderIdSet) ? [] : orderCollection(ctx).find({_id: {$in: Array.from(orderIdSet)}}, {projection: {_id:1, customerId:1, poNo:1, referenceNo:1, shipToAddress:1}}).toArray(),
            _.isEmpty(orderIdSet) ? [] : orderItemLineCollection(ctx).find({orderId: {$in: Array.from(orderIdSet)}}, {projection: {_id:1, orderId:1, itemSpecId:1, titleId:1, supplierId:1, lotNo:1}}).toArray(),
            _.isEmpty(unitIdSet) ? {} : itemUnitService(ctx).getUnitMap(Array.from(unitIdSet)),
            _.isEmpty(lpTemplateIds) ? {} : singleItemLpConfigurationCollection(ctx).find({_id: {$in: lpTemplateIds}}, {projection: {_id:1, name:1, totalQty:1}}).toArray(),
            _.isEmpty(loadIds) ? {} : _getEntryEquipmentsMap(loadIds, "LOAD"),
            _.isEmpty(loadIds) ? [] : loadOrderLineCollection(ctx).find({loadId: {$in: loadIds}}).toArray()
        ]);

        let orderLoadMap = _.keyBy(loadOrderLines, "orderId");
        let taskLoadDetailMap = _.groupBy(loadItems, "loadTaskId");
        let lpItems = [];
        _.forEach(taskLoadDetailMap, (loadDetails, taskId) => {
            _.forEach(loadDetails, loadDetail => {
                let item = {toLPNo: loadDetail.lpId, orderId: loadDetail.orderId, lpTemplateId: lpConfMap[loadDetail.lpId] || ""};
                lpItems.push(_.merge(loadDetail, item, {taskId: taskId}));
            });
        });

        _.forEach(itemLines, itemLine => {
            itemLine._id = itemLine._id.toString();
        });

        let orderMap = _.keyBy(orders, "_id");
        let lpTemplateMap = _.keyBy(lpTemplates, "_id");
        let carrierIds = _.filter(_.uniq(_.map(orders, "carrierId")), o => o);
        let organizationIds = _.filter(_.uniq(_.union(_.map(orders, "customerId"), _.map(orders, "titleId"), _.map(orders, "carrierId"), _.map(itemLines, "supplierId"))), o => o);
        let itemSpecIds = _.filter(_.union(_.map(itemLines, "itemSpecId")), o => o);

        let [carrierMap, organizationMap, itemSpecs] = await Promise.all([
            _.isEmpty(carrierIds) ? {} : carrierService(ctx).getCarrierMap(carrierIds),
            _.isEmpty(organizationIds) ? {} : organizationService(ctx).getOrganizationMap(organizationIds),
            _.isEmpty(itemSpecIds) ? [] : itemSpecCollection(ctx).find({_id: {$in: itemSpecIds}}, {projection: {_id:1, name:1, desc:1, grade:1}}).toArray()
        ]);

        let itemSpecMap = _.keyBy(itemSpecs, "_id");

        _.forEach(lpItems, lpItem => {
            let order = orderMap[lpItem.orderId] || {};
            let itemLine = _.first(_.filter(itemLines, {orderId: lpItem.orderId, itemSpecId: lpItem.itemSpecId}));
            let uom = unitMap[lpItem.unitId] || {};
            let itemSpec = itemSpecMap[itemLine.itemSpecId] || {};
            let loadId = orderLoadMap[lpItem.orderId] ? orderLoadMap[lpItem.orderId].loadId : "";
            let equipment = loadEquipmentMap[loadId] || {};
            let lpConfiguration = lpItem.lpTemplateId && lpTemplateMap[lpItem.lpTemplateId] ? lpTemplateMap[lpItem.lpTemplateId] : {};
            lpItem.customerId = order.customerId || "";
            lpItem.customerName = organizationMap[lpItem.customerId] ? organizationMap[lpItem.customerId].name : "";
            lpItem.supplierId = itemLine.supplierId || "";
            lpItem.supplierName = organizationMap[lpItem.supplierId] ? organizationMap[lpItem.supplierId].name : "";
            lpItem.titleId = order.titleId || "";
            lpItem.titleName = organizationMap[lpItem.titleId] ? organizationMap[lpItem.titleId].name : "";
            lpItem.shipTo = _.get(order, "shipToAddress.name"),
            lpItem.itemSpecId = itemLine.itemSpecId || "";
            lpItem.itemDescription = itemSpec.desc || "";
            lpItem.itemName = itemSpec.name || "";
            lpItem.grade = itemSpec.grade || "";
            lpItem.lotNo = itemLine.lotNo || "";
            lpItem.uom = uom.name || "";
            lpItem.palletQty = order.palletQty || "";
            lpItem.scacCode = carrierMap[order.carrierId] ? carrierMap[order.carrierId].scac : "";
            lpItem.equipmentNo = equipment.equipmentNo || "";
            lpItem.equipmentType = equipment.equipmentType || "";
            lpItem.unitsPallet = lpConfiguration.totalQty || "";
            lpItem.lpConfiguration = lpConfiguration.name || "";
            lpItem.itemCFT = _getItemCFT(lpItem.shippedQty, uom);
            lpItem.itemWGT = _getItemWGT(lpItem.shippedQty, uom);
            lpItem.referenceNo = order.referenceNo || "";
            lpItem.poNo = order.poNo || "";
        });

        let filter = {};
        if (criteria.itemSpecId) _.merge(filter, {itemSpecId: criteria.itemSpecId});
        if (criteria.lpId) _.merge(filter, {lpId: criteria.lpId});
        if (!_.isEmpty(filter)) {
            lpItems = _.filter(lpItems, filter);
        }

        let taskDetailMap = _.groupBy(lpItems, "taskId");
        return taskDetailMap;
    }

    async function _getMaterialData(criteria, receiptIds, orderIds, receiveTaskIds, pickTaskIds, packTaskIds, loadTaskIds) {
        let cloneCriteria = _.merge({}, criteria);
        _.unset(cloneCriteria, "customerId");
        let materialSearch = new MaterialSearch(cloneCriteria);
        let clause = materialSearch.buildClause();
        clause = _.merge(clause, {$or: [{receiptId: {$in: receiptIds}}, {orderId: {$in: orderIds }}, {receiveTaskId: {$in: receiveTaskIds}}, {pickTaskId: {$in: pickTaskIds}}, {packTaskId: {$in: packTaskIds}}, {loadTaskId: {$in: loadTaskIds}}]});
        let materials = await materialLineCollection(ctx).find(clause).toArray();

        let taskIdSet = new Set();
        let receiptIdSet = new Set();
        let orderIdSet = new Set();
        let itemSpecIdSet = new Set();
        let unitIdSet = new Set();
        let orgIdSet = new Set();
        _.forEach(materials, material => {
            let taskId = material.receiveTaskId || material.pickTaskId || material.packTaskId || material.loadTaskId || material.ccTaskId || "";
            material.taskId = taskId;
            if (taskId) taskIdSet.add(taskId);
            if (material.receiptId) receiptIdSet.add(material.receiptId);
            if (material.orderId) orderIdSet.add(material.orderId);
            if (material.itemSpecId) itemSpecIdSet.add(material.itemSpecId);
            if (material.unitId) unitIdSet.add(material.unitId);
            if (material.customerId) orgIdSet.add(material.customerId);
            if (material.titleId) orgIdSet.add(material.titleId);
            if (material.supplierId) orgIdSet.add(material.supplierId);
        });

        let [tasks, receipts, orders, itemSpecs, unitMap, organizationMap, equipmentMap] = await Promise.all([
            _.isEmpty(taskIdSet) ? [] : generalTaskCollection(ctx).find({_id: {$in: Array.from(taskIdSet)}}).toArray(),
            _.isEmpty(receiptIdSet) ? [] : receiptCollection(ctx).find({_id: {$in: Array.from(receiptIdSet)}}, {projection: {_id:1, customer:1, titleId:1, carrierId:1, palletQty:1, poNo:1, referenceNo:1, devannedTime:1}}).toArray(),
            _.isEmpty(orderIdSet) ? [] : orderCollection(ctx).find({_id: {$in: Array.from(orderIdSet)}}, {projection: {_id:1, customerId:1, poNo:1, referenceNo:1, shipToAddress:1, shippedTime:1}}).toArray(),
            _.isEmpty(itemSpecIdSet) ? [] : itemSpecCollection(ctx).find({_id: {$in: Array.from(itemSpecIdSet)}}, {projection: {_id:1, name:1, desc:1, grade:1}}).toArray(),
            _.isEmpty(unitIdSet) ? {} : itemUnitService(ctx).getUnitMap(Array.from(unitIdSet)),
            _.isEmpty(orgIdSet) ? [] : organizationService(ctx).getOrganizationMap(Array.from(orgIdSet)),
            _.isEmpty(receiptIdSet) ? {} : _getEntryEquipmentsMap(Array.from(receiptIdSet), "RECEIVE")
        ]);

        await userService(ctx).fillTasksAssignee(tasks);

        let carrierIds = _.uniq(_.union(_.map(orders, "carrierId"), _.map(receipts, "carrierId")));
        let taskMap = _.keyBy(tasks, "_id");
        let receiptMap = _.keyBy(receipts, "_id");
        let orderMap = _.keyBy(orders, "_id");
        let itemSpecMap = _.keyBy(itemSpecs, "_id");
        let carrierMap = await _.isEmpty(carrierIds) ? {} : carrierService(ctx).getCarrierMap(carrierIds);

        let materialRows = [];
        _.forEach(materials, material => {
            let task = taskMap[material.taskId] || {};
            let receipt = receiptMap[material.receiptId || ""] || {};
            let order = orderMap[material.orderId || ""] || {};
            let worker = task.assignee ? task.assignee : (task.plannedAssignee ? task.plannedAssignee : "");
            let itemSpec = itemSpecMap[material.itemSpecId || ""] || {};
            let uom = unitMap[material.unitId || ""] || {};
            let carrier = carrierMap[order.carrierId || ""] || carrierMap[receipt.carrierId || ""] || "";
            let equipment = equipmentMap[material.receiptId || ""] || {};

            materialRows.push({
                "TASKID": task._id || "",
                "TASKTYPE": task.taskType || "",
                "STATUS": task.status || "",
                "CUSTOMERID": material.customerId || "",
                "CUSTOMERNAME": organizationMap[material.customerId || ""] ? organizationMap[material.customerId].name : "",
                "SUPPLIEID": organizationMap[material.supplierId || ""] ? organizationMap[material.supplierId].name : "",
                "TITLE": organizationMap[material.titleId || ""] ? organizationMap[material.titleId].name : "",
                "SHIPTO": _.get(order, "shipToAddress.name"),
                "RN/DN": material.receiptId || material.orderId || "",
                "ASSIGNEE": worker ? worker.username : "",
                "ITEMID": itemSpec.name || "",
                "ITEM DESCRIPTION": itemSpec.desc || "",
                "UOM": uom.name || "",
                "QTY": material.qty || "",
                "CARRIER": carrier.name || "",
                "SCAC CODE": carrier.scac || "",
                "EQUIPMENT NO.": equipment.equipmentNo || "",
                "EQUIPMENT TYPE": equipment.equipmentType || "",
                "REFERENCE NO.": order.referenceNo || receipt.referenceNo || "",
                "PONO.": order.poNo || receipt.poNo || "",
                "PRONO.": task.proNo || "",
                "SONO.": task.soNo || "",
                "RECEIVED TIME": _formatTime(receipt.devannedTime),
                "SHIPPED TIME": _formatTime(order.shippedTime)
            });
        });

        return materialRows;
    }

    async function _toManualBillingDetails(criteria, receiptIds, orderIds, receiptDevannedTimeMap, orderShippedTimeMap) {
        let cloneCriteria = _.merge({}, criteria);
        _.unset(cloneCriteria, "customerId");
        let billingSearch = new BillingSearch(cloneCriteria);
        let clause = billingSearch.buildClause();
        clause = _.merge(clause, {$or: [{receiptId: {$in: receiptIds}}, {orderId: {$in: orderIds }}]});
        let manualBillings = await billingManualCollection(ctx).find(clause).toArray();

        let manualBillingsRows = [];
        _.forEach(manualBillings, billing => {
            if (billing.qty && billing.qty > 0) {
                manualBillingsRows.push({
                    "RN/DN#": billing.receiptId || billing.orderId,
                    "ACCOUNT ITEM": billing.billingCode || "",
                    "DESCRIPTION": billing.billingDesc || "",
                    "NOTES": billing.note || "",
                    "UOM": billing.billingUom || "",
                    "QTY": billing.qty || "",
                    "RECEIVED TIME": _formatTime(receiptDevannedTimeMap[billing.receiptId || ""] || ""),
                    "SHIPPED TIME": _formatTime(orderShippedTimeMap[billing.orderId || ""] || "")
                });
            }
        });

        return manualBillingsRows;
    }

    function _isSearchByTaskDate(criteria) {
        return !_.isEmpty(criteria.timeFrom) || !_.isEmpty(criteria.timeTo);
    }

    function _isSearchByReceivedTime(criteria) {
        return !_.isEmpty(criteria.receivedTimeFrom) || !_.isEmpty(criteria.receivedTimeTo);
    }

    function _isSearchByShippedTime(criteria) {
        return !_.isEmpty(criteria.shippedTimeFrom) || !_.isEmpty(criteria.shippedTimeTo);
    }

    async function _getEntryEquipmentsMap(ids, taskType) {
        let entryTickets = await entryTicketActivityCollection(ctx).find({
            "taskType": taskType,
            "subTaskId": {$in: ids}
        }).toArray();

        if (_.isEmpty(entryTickets)) return;
        let entryIds = _.uniq(_.map(entryTickets, "entryId"));
        if (_.isEmpty(entryIds)) return;
        let [entryTicketCheckRecords, equipments] = await Promise.all([
            entryTicketCheckCollection(ctx).find({"entryId": {$in: entryIds}}).toArray(),
            ymsApp(ctx).post('/yard-equipment/search', {
                "checkInEntries": entryIds
            })
        ]);
        if (_.isEmpty(entryTicketCheckRecords)) return;

        let entryActivitiesGroupByReceiptId = _.groupBy(entryTickets, "subTaskId");
        let receiptEquipmentInfoMap = {};
        _.each(ids, id => {
            let entryActivities = entryActivitiesGroupByReceiptId[id];
            if (_.isEmpty(entryActivities)) return;
            let entryIds = _.uniq(_.map(entryActivities, "entryId"));
            let equipmentTypes = _.uniq(_.map(_.filter(entryTicketCheckRecords, e => _.includes(entryIds, e.entryId)), "equipmentType"));
            let equipmentNos = _.map(_.filter(equipments, o => _.includes(entryIds, o.checkInEntry)), "equipmentNo");

            receiptEquipmentInfoMap[id] = {
                equipmentType: _.join(equipmentTypes, ","),
                equipmentNo: _.join(equipmentNos, ",")
            };
        });

        return receiptEquipmentInfoMap;
    }

    function _getItemCFT(qty, uom) {
        let cft = 0;
        if (!qty) return 0;

        cft = qty * itemUnitService(ctx).getCftByUOM(uom);
        return cft;
    }

    function _getItemWGT(qty, uom) {
        let weight = 0;
        if (!qty) return 0;

        weight = qty * itemUnitService(ctx).getWeightByUOM(uom);

        return weight;
    }

    function _buildRow(task, taskDetail) {
        let worker = task.assignee ? task.assignee : (task.plannedAssignee ? task.plannedAssignee : "");

        let row = {
            "TASKID": task._id,
            "TASKTYPE": task.taskType,
            "STATUS": task.status,
            "CUSTOMERID": taskDetail.customerName,
            "CUSTOMERNAME": taskDetail.customerName,
            "SUPPLIERID": taskDetail.supplierName,
            "TITLE": taskDetail.titleName || "",
            "SHIPTO": taskDetail.shipTo || "",
            "RN": taskDetail.receiptId || "",
            "DN": taskDetail.orderId || "",
            "ASSIGNEE": worker ? worker.username : "",
            "STARTTIME": _formatTime(task.startTime),
            "ENDTIME": _formatTime(task.endTime),
            "TIMESPAN (MINS)": _getTimeSpan(task.startTime, task.endTime),
            "ITEM ID": taskDetail.itemName,
            "ITEM DESCRIPTION": taskDetail.itemDescription,
            "GRADE": taskDetail.grade,
            "LOTNO.": taskDetail.lotNo,
            "LPNO": taskDetail.lpId,
            "FROMLPNO.": taskDetail.lpId,
            "TOLPNO.": taskDetail.toLPNo || "",
            "UOM": taskDetail.uom,
            "RECEIVEDQTY": taskDetail.qty || "",
            "SHIPPEDQTY": taskDetail.shippedQty || "",
            "PALLET QTY": taskDetail.palletQty || "",
            "CARRIER": taskDetail.carrierName || "",
            "SCACCODE": taskDetail.scacCode || "",
            "EQUIPMENTNO.": taskDetail.equipmentNo || "",
            "EQUIPMENTTYPE": taskDetail.equipmentType || "",
            "IS PALLET": taskDetail.isPallet || "",
            "PACKQTY": taskDetail.packQty || "",
            "UNITS PALLET": taskDetail.unitsPallet || "",
            "LP CONFIGURATION": taskDetail.lpConfiguration,
            "ITEM CFT": taskDetail.itemCFT || "",
            "ITEM WGT": taskDetail.itemWGT || "",
            "REFERENCE NO.": taskDetail.referenceNo || "",
            "PO NO.": taskDetail.poNo || "",
            "PRO NO.": task.proNo || "",
            "SONO.": task.soNo || "",
            "RECEIVED TIME": _formatTime(taskDetail.receivedTime),
            "SHIPPED TIME": _formatTime(taskDetail.shippedTime)
        };

        if (task.taskType === "RECEIVE") {
            _unset(row, ["SHIPTO", "DN", "FROMLPNO.", "TOLPNO.", "IS PALLET", "PACKQTY", "SHIPPEDQTY", "SHIPPED TIME"]);
        }

        if (task.taskType === "PACK") {
            _unset(row, ["LPNO", "RECEIVEDQTY", "PALLET QTY", "CARRIER", "SCACCODE", "EQUIPMENTNO.","EQUIPMENTTYPE", "SHIPPEDQTY", "RECEIVED TIME"]);
        }

        if (task.taskType === "LOAD") {
            _unset(row, ["LPNO", "RECEIVEDQTY", "PALLET QTY", "RECEIVED TIME"]);
        }

        return row;
    }

    function _getTimeSpan(startTime, endTime, unit) {
        if (!startTime) return "";

        let endMoment = endTime ? moment(endTime) : moment();

        return unit ? endMoment.diff(moment(startTime), unit) : endMoment.diff(moment(startTime), 'minutes')
    }

    function _unset(row, fields) {
        _.forEach(fields, field => _.unset(row, field));
    }

    function _formatTime(time) {
        return time ? momentZone(time).format('MM/DD/YYYY HH:mm:ss') : "";
    }

    function _buildHead(taskType) {
        let head = [
            "TASKID",
            "TASKTYPE",
            "STATUS",
            "CUSTOMERID",
            "CUSTOMERNAME",
            "SUPPLIERID",
            "TITLE",
            "SHIPTO",
            "RN",
            "DN",
            "ASSIGNEE",
            "STARTTIME",
            "ENDTIME",
            "TIMESPAN (MINS)",
            "ITEM ID",
            "ITEM DESCRIPTION",
            "GRADE",
            "LOTNO.",
            "LPNO",
            "FROMLPNO.",
            "TOLPNO.",
            "UOM",
            "RECEIVEDQTY",
            "SHIPPEDQTY",
            "PALLET QTY",
            "CARRIER",
            "SCACCODE",
            "EQUIPMENTNO.",
            "EQUIPMENTTYPE",
            "IS PALLET",
            "PACKQTY",
            "UNITS PALLET",
            "LP CONFIGURATION",
            "ITEM CFT",
            "ITEM WGT",
            "REFERENCE NO.",
            "PO NO.",
            "PRO NO.",
            "SONO.",
            "RECEIVED TIME",
            "SHIPPED TIME"
        ];

        if (taskType === "RECEIVE") {
            _.pullAll(head, ["SHIPTO", "DN", "FROMLPNO.", "TOLPNO.", "IS PALLET", "PACKQTY", "SHIPPEDQTY", "SHIPPED TIME"]);
        }

        if (taskType === "PACK") {
            _.pullAll(head, ["LPNO", "RECEIVEDQTY", "PALLET QTY", "CARRIER", "SCACCODE", "EQUIPMENTNO.","EQUIPMENTTYPE", "SHIPPEDQTY", "RECEIVED TIME"]);
        }

        if (taskType === "LOAD") {
            _.pullAll(head, ["LPNO", "RECEIVEDQTY", "PALLET QTY", "RECEIVED TIME"]);
        }

        return head;
    }

    function _toSummaryRows(data) {
        let rows = [];
        _.forEach(data, o => rows.push({
            "TASKID": o["TASKID"],
            "TASKTYPE": o["TASKTYPE"],
            "STATUS": o["STATUS"],
            "CUSTOMERID": o["CUSTOMERID"],
            "CUSTOMERNAME": o["CUSTOMERNAME"],
            "SUPPLIERID": o["SUPPLIERID"],
            "TITLE": o["TITLE"],
            "RN": o["RN"],
            "DN": o["DN"],
            "ASSIGNEE": o["ASSIGNEE"],
            "Start Tran Date": _getDayTime(o["STARTTIME"], "date"),
            "Start Tran Time": _getDayTime(o["STARTTIME"], "time"),
            "End Tran Date": _getDayTime(o["ENDTIME"], "date"),
            "End Tran Time": _getDayTime(o["ENDTIME"], "time"),
            "TIMESPAN (SECS)": _getTimeSpan(o["STARTTIME"], o["ENDTIME"], "seconds"),
            "Received Date": o["RECEIVED TIME"] || "",
            "Shipped Date": o["SHIPPED TIME"] || "",
            "ITEM ID": o["ITEM ID"] || o["ITEM"] || "",
            "ITEM DESCRIPTION": o["ITEM DESCRIPTION"] || "",
            "GRADE": o["GRADE"] || "",
            "LOTNO.": o["LOTNO."] || "",
            "ReceivedLPNO": o["LPNO"] || "",
            "FROMLPNO.": o["FROMLPNO"] || o["FROMLPNO."]|| "",
            "TOLPNO.": o["TOLPNO"] || o["TOLPNO."] || "",
            "Tran QTY": o["RECEIVEDQTY"] || o["SHIPPEDQTY"] || o["PICKQTY"],
            "UOM": o["UOM"] || "",
            "CARRIER": o["CARRIER"] || "",
            "SCACCODE": o["SCACCODE"] || "",
            "EQUIPMENTNO.": o["EQUIPMENTNO."] || "",
            "EQUIPMENTTYPE": o["EQUIPMENTTYPE"] || "",
            "UNITS PALLET": o["UNITS PALLET"] || "",
            "LP CONFIGURATION": o["LP CONFIGURATION"] || "",
            "TOTAL CFT": o["ITEM CFT"] || "",
            "TOTAL WGT": o["ITEM WGT"] || "",
            "REFERENCE NO.": o["REFERENCE NO."] || "",
            "PO NO.": o["PO NO."] || "",
            "PRO NO.": o["PRO NO."] || "",
            "SONO.": o["SONO."] || ""
        }));

        return rows;
    }

    function _getDayTime(time, whichPart) {
        if (!time) return "";

        if (whichPart === "date") {
            return _.split(time, " ")[0];
        }

        if (whichPart === "time") {
            return _.split(time, " ")[1];
        }
    }

    function _minutesToSeconds(minutes) {
        if (!minutes) return "";

        return minutes * 60;
    }

    function _buildSummaryHead() {
        return [
            "TASKID",
            "TASKTYPE",
            "STATUS",
            "CUSTOMERID",
            "CUSTOMERNAME",
            "SUPPLIERID",
            "TITLE",
            "RN",
            "DN",
            "ASSIGNEE",
            "Start Tran Date",
            "Start Tran Time",
            "End Tran Date",
            "End Tran Time",
            "TIMESPAN (SECS)",
            "Received Date",
            "Shipped Date",
            "ITEM ID",
            "ITEM DESCRIPTION",
            "GRADE",
            "LOTNO.",
            "ReceivedLPNO",
            "FROMLPNO.",
            "TOLPNO.",
            "Tran QTY",
            "UOM",
            "CARRIER",
            "SCACCODE",
            "EQUIPMENTNO.",
            "EQUIPMENTTYPE",
            "UNITS PALLET",
            "LP CONFIGURATION",
            "TOTAL CFT",
            "TOTAL WGT",
            "REFERENCE NO.",
            "PO NO.",
            "PRO NO.",
            "SONO."
        ];
    }

    function _validate(criteria) {
        if (!criteria.customerId) {
            throw new BadRequestError('Customer can not be empty.');
        }

        if (!criteria.timeFrom && !criteria.receivedTimeFrom && !criteria.shippedTimeFrom) {
            throw new BadRequestError('TimeFrom can not be empty.');
        }

        if ((!_.isEmpty(criteria.timeFrom) || !_.isEmpty(criteria.timeTo)) && (!_.isEmpty(criteria.receivedTimeFrom) || !_.isEmpty(criteria.receivedTimeTo))) {
            throw new BadRequestError('Can not search by both Task Date and Received Time.');
        }

        if ((!_.isEmpty(criteria.timeFrom) || !_.isEmpty(criteria.timeTo)) && (!_.isEmpty(criteria.shippedTimeFrom) || !_.isEmpty(criteria.shippedTimeTo))) {
            throw new BadRequestError('Can not search by both Task Date and Shipped Time.');
        }
    }

    class TaskSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                taskIds: new MongoOperator('$in', '_id'),
                taskTypes: new MongoOperator('$in', 'taskType'),
                statues: new MongoOperator('$in', 'status'),
                timeFrom: new MongoOperator('$gte', 'startTime', 'Date'),
                timeTo: new MongoOperator('$lte', 'startTime', 'Date'),
            };
        }
    }

    class ClosedPickTaskSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                taskIds: new MongoOperator('$in', '_id'),
                taskTypes: new MongoOperator('$in', 'taskType'),
                statues: new MongoOperator('$in', 'status'),
                timeFrom: new MongoOperator('$gte', 'endTime', 'Date'),
                timeTo: new MongoOperator('$lte', 'endTime', 'Date'),
            };
        }
    }

    class InventorySearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                lpIds: new DBOperator('IN', 'lpId'),
                customerId: new DBOperator('=', 'customerId'),
                supplierId: new DBOperator('=', 'supplierId'),
                titleId: new DBOperator('=', 'titleId')
            };
        }
    }

    class LPSearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                lpIds: new DBOperator('IN', 'id')
            };
        }
    }

    class LoadItemSearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                loadTaskIds: new DBOperator('IN', 'loadTaskId')
            };
        }
    }

    class BillingSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'customerId'),
                timeFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                timeTo: new MongoOperator('$lte', 'createdWhen', 'Date'),
            };
        }
    }

    class MaterialSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'customerId'),
                timeFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                timeTo: new MongoOperator('$lte', 'createdWhen', 'Date'),
            };
        }
    }

    class ReceiptSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'customerId'),
                receiptIds: new MongoOperator('$in', '_id'),
                receivedTimeFrom: new MongoOperator('$gte', 'devannedTime', 'Date'),
                receivedTimeTo: new MongoOperator('$lte', 'devannedTime', 'Date'),
            };
        }
    }

    class OrderSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'customerId'),
                shippedTimeFrom: new MongoOperator('$gte', 'shippedTime', 'Date'),
                shippedTimeTo: new MongoOperator('$lte', 'shippedTime', 'Date')
            };
        }
    }

    return {
        buildActivityReport
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
