
let service = (app, ctx) => {

    async function getReport(lineId) {
        let conveyorLine = await conveyorLineCollection(ctx).findOne({_id:lineId});
        if (!conveyorLine) {
            throw new BadRequestError("Conveyor line not found by id " + lineId);
        }

        let branchs = await conveyorBranchCollection(ctx).find({conveyorLineId:conveyorLine._id,status:"AVAILABLE",name:{$ne:"0"}}).toArray();
        if (_.isEmpty(branchs)) return {};
        branchs = _.sortBy(branchs, "name");

        let exceptionBranch = _.filter(branchs, branch => branch.type === "EXCEPTION");
        let stores = _.compact(_.uniq(_.map(branchs,"occupiedBy")));

        let orders = await orderCollection(ctx).query({
            status: {$in:["PICKING","PICKED","PACKING","PACKED","STAGED"]},
            "shipToAddress.storeNo": {$in:stores}
        },{projection:{"shipToAddress.storeNo":1}});

        let orderIds = _.map(orders, "_id");
        let pickTasks = await pickTaskCollection(ctx).query({orderIds:{$in:orderIds},isConveyorPick:true},{projection:{orderIds:1}});
        let pickOrderIds = _.uniq(_.flatten(_.map(pickTasks, "orderIds")));
        orderIds = _.intersection(orderIds, pickOrderIds);

        let orderItemLines = await orderItemLineCollection(ctx).query({orderId:{$in:orderIds}},{projection:{orderId:1,itemSpecId:1,unitId:1,qty:1}});
        let orderItemLineGroup = _.groupBy(orderItemLines, "orderId");

        let itemSpecIds = _.uniq(_.map(orderItemLines, "itemSpecId"));
        let uoms = await itemUnitCollection(ctx).query({itemSpecId:{$in:itemSpecIds}},{projection:{itemSpecId:1,name:1,baseQty:1}});
        let uomMap = _.keyBy(uoms, "_id");
        let csUpmMap = _.keyBy(_.filter(uoms, uom => uom.name === "CS"), "itemSpecId");

        let taskIds = _.map(pickTasks, "_id");
        let invs = await wmsMysql(ctx).query(`select pickTaskId,status,unitId,qty from inventory where pickTaskId in('${taskIds.join("','")}') and orderId in('${orderIds.join("','")}')`);

        let branchDetail = [];
        _.forEach(branchs, branch => {
            let branchOrderIds = _.map(_.filter(orders, order => _.includes(orderIds, order._id) && order.shipToAddress.storeNo === branch.occupiedBy), "_id");
            let tasks = _.map(_.filter(pickTasks, task => {
                let ids = _.intersection(branchOrderIds, task.orderIds);
                return !_.isEmpty(ids);
            }),"_id");
            let orderCsQty = 0;
            let taskEaQty = 0;
            let packEaQty = 0;
            _.forEach(branchOrderIds, orderId => {
                let lines = orderItemLineGroup[orderId];
                _.forEach(lines, line => {
                    let uom = uomMap[line.unitId];
                    let csUom = csUpmMap[line.itemSpecId];
                    if (!uom || !csUom) return;

                    orderCsQty += Math.floor(line.qty * uom.baseQty / csUom.baseQty);
                })
            })

            let branchInvs = _.filter(invs, inv => _.includes(tasks, inv.pickTaskId));
            _.forEach(branchInvs, inv => {
                let uom = uomMap[inv.unitId];
                let invQty = uom ? inv.qty * uom.baseQty : inv.qty;
                taskEaQty += invQty;
                if (inv.status === "PACKED") {
                    packEaQty += invQty;
                }
            })

            branchDetail.push({
                branchId:branch._id,
                branch: branch.name,
                status: branch.status,
                type: branch.type,
                storeNo: branch.occupiedBy || "",
                orders: branchOrderIds,
                tasks: tasks,
                orderCsQty: orderCsQty,
                taskEaQty: taskEaQty,
                packEaQty: packEaQty
            })
        })

        let res = {
            conveyorLine: conveyorLine.name,
            totalBranch: branchs.length,
            availableBranchs: _.map(_.filter(branchs, branch => branch.type === "NORMAL" && _.isEmpty(branch.occupiedBy)),"name"),
            occupiedBranchs: _.map(_.filter(branchs, branch => branch.type === "NORMAL" && !_.isEmpty(branch.occupiedBy)),"name"),
            exceptionBranch: _.map(exceptionBranch, "name"),
            stores: stores,
            orders: orderIds,
            branchDetail: branchDetail
        };

        return res;
    }

    return {
        getReport
    };
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};