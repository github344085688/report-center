
let service = (app, ctx) => {

    function emptyResult() {
        return {
            results: {
                data: [],
                head: [
                    "TASKID",
                    "TASKTYPE",
                    "CUSTOMERID",
                    "SHIPTO",
                    "DN",
                    "PICKING",
                    "STARTTIME",
                    "ENDTIME",
                    "TIMESPAN (MINS)",
                    "ITEM",
                    "ITEM DESCRIPTION",
                    "LOTNO.",
                    "FROMLPNO.",
                    "TOLPNO.",
                    "IS ENTIRE LP PICK",
                    "PICKQTY",
                    "UOM",
                    "PALLETPICKQTY",
                    "CASEPICKQTY",
                    "INNERPICKQTY",
                    "PIECEPICKQTY",
                    "CASE RELOCATE QTY",
                    "INNER RELOCATE QTY",
                    "PIECE RELOCATE QTY",
                    "UNITS PALLET (CASE)",
                    "UNITS PALLET (INNER)",
                    "UNITS PALLET (PIECE)",
                    "LP CONFIGURATION",
                    "ITEM CFT",
                    "ITEM WGT",
                    "REFERENCE NO.",
                    "PO NO.",
                    "PRO NO.",
                    "SONO."
                ]
            },
            paging: {
                totalCount: 1,
                pageNo: 1,
                totalPage: 1,
                startIndex: 1,
                endIndex: 1,
            }
        };
    }

    /*
        * param = {
        *   customerId:"ORG-3",
        *   timeFrom:"",
        *   timeTo:""
        * }
        * */
    async function searchByPaging(param) {
        _validate(param);
        let result = emptyResult();

        let pTasks = await _getPickTasks(param);
        param.pickTaskIds = _.map(pTasks, "_id");

        if (param.shippedTimeFrom || param.shippedTimeTo) {
            let orderSearch = new OrderSearch(param);
            let orders = await orderCollection(ctx).query(orderSearch.buildClause(), {projection:{_id:1}});
            if (_.isEmpty(orders)) return result;
            param.orderIds = _.map(orders, "_id");
            if (param.orderId && !_.includes(param.orderIds, param.orderId)) return result;
        }

        let inventorySearch = new InventorySearch(param);
        let pagingSql = `select count(1) as num,itemSpecId,lpId,titleId,orderId from inventory where qty>0 and ${inventorySearch.buildClause()} group by itemSpecId,lpId,titleId,orderId`;
        let pageRes = await wmsMysql(ctx).queryByPaging(pagingSql);

        param.orderIds = _.compact(_.uniq(_.map(pageRes.results, "orderId")));
        param.itemSpecIds = _.compact(_.uniq(_.map(pageRes.results, "itemSpecId")));
        param.lpIds = _.compact(_.uniq(_.map(pageRes.results, "lpId")));
        param.titleIds = _.compact(_.uniq(_.map(pageRes.results, "titleId")));
        inventorySearch = new InventorySearch(param);

        let sql = `SELECT itemSpecId,unitId,qty,lpId,orderId,pickTaskId,lotNo,shippedWhen,customerId FROM inventory WHERE qty>0 and ${inventorySearch.buildClause()}`;
        let inventories = await wmsMysql(ctx).selectAll(sql);

        let pickTaskIds = _.concat(_.uniq(_.map(inventories, "pickTaskId")));
        let orderIds = _.concat(_.uniq(_.map(inventories, "orderId")));
        let [orders, orderItemLines, generalTasks, pickTasks] = await Promise.all([
            orderCollection(ctx).query({_id:{$in:orderIds}},{projection:tabelFieldMap.orderFields}),
            orderService(ctx).getOrderItemLines(orderIds),
            generalTaskCollection(ctx).query({_id:{$in:pickTaskIds}},{projection:{assigneeUserId:1,startTime:1,endTime:1}}),
            pickTaskCollection(ctx).query({_id:{$in:pickTaskIds}},{projection:{orderIds:1,pickType:1,pickWay:1,pickHistories:1}})
        ]);
        let orderMap = _.keyBy(orders, "_id");
        let generalTaskMap = _.keyBy(generalTasks, "_id");
        let pickTaskMap = _.keyBy(pickTasks, "_id");

        let itemSpecIds = _.compact(_.uniq(_.map(inventories, "itemSpecId")));
        let [items, uoms, organizationMap, itemLpConfigurations] = await Promise.all([
            itemSpecCollection(ctx).query({_id:{$in:itemSpecIds}},{projection:{name:1,desc:1,shortDescription:1}}),
            itemUnitCollection(ctx).query({itemSpecId:{$in:itemSpecIds}}),
            organizationService(ctx).getOrganizationMap([param.customerId]),
            itemLpConfigurationService(ctx).getItemLpConfigurations(itemSpecIds)
        ]);
        let customer = organizationMap[param.customerId];

        let itemMap = _.keyBy(items, "_id");
        let uomMap = _.keyBy(uoms, "_id");
        let csUoms = _.filter(uoms, uom => uom.name === "CS");
        let csUomMap = _.keyBy(csUoms, "itemSpecId");
        let inUoms = _.filter(uoms, uom => uom.name === "IN");
        let inUomMap = _.keyBy(inUoms, "itemSpecId");

        let invGroup = _.groupBy(inventories, inv => inv.lpId + inv.itemSpecId + inv.titleId + inv.orderId);
        let data = [];
        for (let key of _.keys(invGroup)) {
            let invs = invGroup[key];
            let itemLines = _.filter(orderItemLines, line => line.orderId === invs[0].orderId && line.itemSpecId === invs[0].itemSpecId);
            let lotNos = _.uniq(_.map(itemLines, "lotNo"));
            for (let lotNo of lotNos) {
                let lotNoInvs = _.filter(invs, inv => lotNo ? inv.lotNo === lotNo : true);
                let row = await _buildReportRow(lotNoInvs, orderMap, generalTaskMap, pickTaskMap, itemMap, uomMap, csUomMap, inUomMap, itemLpConfigurations, customer);
                if (row) data.push(row);
            }
        }

        result.results.data = data;
        result.paging = pageRes.paging;
        return result;
    }

    function _validate(param) {
        if (!param.customerId) {
            throw new BadRequestError('CustomerId can not be empty.');
        }
        if (param.taskId || param.orderId || param.taskIds) return;

        if (!param.timeFrom && !param.shippedTimeFrom) {
            throw new BadRequestError('TimeFrom can not be empty.');
        }
    }

    async function _getPickTasks(param) {
        if (!param.taskId && !param.timeFrom && !param.timeTo && !param.taskIds) return [];

        let taskClause = {taskType:"PICK"};
        if (param.timeFrom) {
            taskClause.endTime = {
                $gte: new Date(momentZone(param.timeFrom).format())
            }
        }
        if (param.timeTo) {
            taskClause.endTime = taskClause.endTime || {};
            taskClause.endTime.$lt = new Date(momentZone(param.timeTo).format());
        }
        if (param.taskId) {
            taskClause._id = param.taskId;
        }
        if (param.taskIds) {
            taskClause._id = {$in: param.taskIds};
        }

        return await generalTaskCollection(ctx).query(taskClause, {projection:{_id:1}});
    }

    async function _buildReportRow(invs, orderMap, generalTaskMap, pickTaskMap, itemMap, uomMap, csUomMap, inUomMap, itemLpConfigurations, customer) {
        if (_.isEmpty(invs)) return;
        let inv = invs[0];
        let baseQty = _.sum(_.map(invs, o => uomMap[o.unitId] ? uomMap[o.unitId].baseQty * o.qty : o.qty));
        let order = orderMap[inv.orderId];
        let generalTask = generalTaskMap[inv.pickTaskId];
        let pickTask = pickTaskMap[inv.pickTaskId];
        let pickHistory;
        if (pickTask && pickTask.pickHistories) {
            pickHistory = _.filter(pickTask.pickHistories, history => {
                if (history.fromLPId !== inv.lpId && history.toLPId !== inv.lpId) return false;
                if (history.itemSpecId !== inv.itemSpecId) return false;
                if (history.pickedBaseQty > baseQty) return false;
                return true;
            })
            if (_.isEmpty(pickHistory)) {
                pickHistory = _.filter(pickTask.pickHistories, history => {
                    if (history.itemSpecId !== inv.itemSpecId) return false;
                    if (history.pickedBaseQty > baseQty) return false;
                    return true;
                })
            }
            pickHistory = pickHistory.length > 0 ? pickHistory[0] : {};
        }

        let item = itemMap[inv.itemSpecId];
        let uom = uomMap[inv.unitId];
        let isCaseUom = await itemUnitService(ctx).isCaseUom(uom);
        let csUom = isCaseUom ? uom : csUomMap[inv.itemSpecId];
        let inUom = inUomMap[inv.itemSpecId];

        let lpConfiguration = _.find(itemLpConfigurations, conf => conf.itemSpecId === inv.itemSpecId && conf.isDefault);
        let pickQty = await billingShippingReportService(ctx).calPickQty(customer, itemLpConfigurations, invs, [pickTask], uomMap, csUom, inUom);

        return {
            TASKID: inv.pickTaskId,
            TASKTYPE: "PICK",
            CUSTOMERID: customer ? customer.name : "",
            SHIPTO: order ? order.shipToAddress.name : "",
            DN: inv.orderId,
            PICKING: pickTask.pickType,
            STARTTIME: generalTask.startTime ? momentZone(generalTask.startTime).format('YYYY-MM-DD HH:mm:ss') : "",
            ENDTIME: generalTask.endTime ? momentZone(generalTask.endTime).format('YYYY-MM-DD HH:mm:ss') : "",
            "TIMESPAN (MINS)": "",
            ITEM: item ? item.name : "",
            "ITEM DESCRIPTION": item && item.desc ? item.desc : (item.shortDescription || ""),
            "LOTNO.": inv.lotNo || "",
            "FROMLPNO.": pickHistory ? pickHistory.fromLPId : "",
            "TOLPNO.": pickHistory ? pickHistory.toLPId : "",
            "IS ENTIRE LP PICK": pickHistory ? pickHistory.isEntireLPPick : "",
            PICKQTY: uom ? Math.floor(baseQty / uom.baseQty) : baseQty,
            UOM: uom ? uom.name : "",
            PALLETPICKQTY: pickQty.palletPickQty,
            CASEPICKQTY: pickQty.casePickQty,
            INNERPICKQTY: pickQty.innerPickQty,
            PIECEPICKQTY: pickQty.piecePickQty,
            "CASE RELOCATE QTY": pickQty.relocateCaseQty,
            "INNER RELOCATE QTY": pickQty.relocateInnerQty,
            "PIECE RELOCATE QTY": pickQty.relocatePieceQty,
            "UNITS PALLET (CASE)": pickQty.unitsPalletCase,
            "UNITS PALLET (INNER)": pickQty.unitsPalletInner,
            "UNITS PALLET (PIECE)": pickQty.unitsPalletPiece,
            "LP CONFIGURATION": lpConfiguration ? lpConfiguration.name : "",
            "ITEM CFT": itemUnitService(ctx).getCftByUOM(uom),
            "ITEM WGT": itemUnitService(ctx).getWeightByUOM(uom),
            "REFERENCE NO.": order ? order.referenceNo : "",
            "PO NO.": order ? order.poNo : "",
            "PRO NO.": order ? order.proNo : "",
            "SONO.": order && order.soNos ? order.soNos.join(",") : ""
        };
    }

    class OrderSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                orderId: new MongoOperator('$eq', '_id'),
                customerId: new MongoOperator('$eq', 'customerId'),
                shippedTimeFrom: new MongoOperator('$gte', 'shippedTime', 'Date'),
                shippedTimeTo: new MongoOperator('$lte', 'shippedTime', 'Date')
            };
        }
    }
    class InventorySearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new DBOperator('=', 'customerId'),
                pickTaskIds: new DBOperator('IN', 'pickTaskId'),
                orderId: new DBOperator('=', 'orderId'),
                orderIds: new DBOperator('IN', 'orderId'),
                itemSpecIds: new DBOperator('IN', 'itemSpecId'),
                lpIds: new DBOperator('IN', 'lpId'),
                titleIds: new DBOperator('IN', 'titleId'),
                lotNos: new DBOperator('IN', 'lotNo')
            };
        }
    }

    return {
        searchByPaging,
        emptyResult
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};