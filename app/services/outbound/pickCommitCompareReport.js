
let service = (app, ctx) => {

    async function getCompareReport(param) {
        if (!param.customerId) {
            throw new BadRequestError('customerId can not be empty.');
        }

        param.excludeStatuses = param.excludeStatuses || ["CANCELLED","CLOSED","SHIPPED","SHORT_SHIPPED","PARTIAL_SHIPPED"];
        let search = new OrderSearch(param);
        let criteriaClause = search.buildClause();
        let orders = await orderCollection(ctx).query(criteriaClause, {projection:{status:1,orderedDate:1,referenceNo:1,longHaulId:1,shipToAddress:1}});

        let startTime = momentZone().add(-1, 'days').startOf('day').format('YYYY-MM-DD HH:mm:ss');
        let shippedOrders = await orderCollection(ctx).query({
            customerId: param.customerId,
            status:{$in:["SHIPPED","SHORT_SHIPPED","PARTIAL_SHIPPED"]},
            shippedTime: {$gte: new Date(momentZone(startTime).format())}
        }, {projection:{status:1,orderedDate:1,referenceNo:1,shippedTime:1,longHaulId:1,shipToAddress:1}});
        orders = _.union(orders, shippedOrders);

        let longHaulIds = _.compact(_.uniq(_.map(orders, "longHaulId")));

        let orderIds = _.map(orders, "_id");
        let orderIdStr = "'" + orderIds.join("','") + "'";
        let [orderItemLines, lockInventory, pickInventory, longHauls] = await Promise.all([
            orderItemLineCollection(ctx).query({"orderId": {$in: orderIds}}, {projection: {
                orderId: 1, itemSpecId: 1, unitId: 1, qty: 1, orderedQty: 1, shippedQty: 1, lotNo: 1
            }}),
            wmsMysql(ctx).query(`SELECT orderId,itemSpecId,unitId,qty,baseQty,orderItemLineId FROM inventory_lock WHERE orderId IN(${orderIdStr})`),
            wmsMysql(ctx).query(`SELECT orderId,itemSpecId,unitId,qty,lotNo FROM inventory WHERE orderId IN(${orderIdStr})`),
            longHaulCollection(ctx).find({_id:{$in:longHaulIds}}).toArray()
        ]);
        let longHaulMap = _.keyBy(longHauls, "_id");

        let itemSpecIds = _.compact(_.uniq(_.map(orderItemLines, "itemSpecId")));
        let [itemSpecs, units] = await Promise.all([
            itemSpecCollection(ctx).query({"_id": {$in: itemSpecIds}}, {projection:{name:1, desc:1}}),
            itemUnitCollection(ctx).query({"itemSpecId": {$in: itemSpecIds}}, {projection:{itemSpecId:1, name:1, baseQty:1}})
        ]);

        let itemSpecsMap = _.keyBy(itemSpecs, "_id");
        let unitsMap = _.keyBy(units, "_id");
        let orderMap = _.keyBy(orders, "_id");
        let csUomMap = _.keyBy(_.filter(units, unit => unit.name === "CS"), "itemSpecId");
        let lockInventoryGroup = _.groupBy(lockInventory, "orderItemLineId");

        _.forEach(orderItemLines, line => {
            if (_.isEmpty(line.lotNo)) line.lotNo = null;
        });
        orderItemLines = _.sortBy(orderItemLines, "lotNo");

        let data = [];
        _.each(orderItemLines, function (line) {
            let order = orderMap[line.orderId];
            let item = itemSpecsMap[line.itemSpecId];
            let orderQty = unitsMap[line.unitId] ? line.qty * unitsMap[line.unitId].baseQty : line.qty;

            let commitQty = 0;
            let lockInvs = lockInventoryGroup[line._id];
            if (lockInvs) {
                commitQty = _.sum(_.map(lockInvs, inv => unitsMap[inv.unitId] ? inv.qty * unitsMap[inv.unitId].baseQty : inv.qty));
            }
            let pickQty = 0;
            let itemInvs = _.remove(pickInventory, inv => {
                if (line.lotNo) {
                    return inv.orderId === line.orderId && inv.itemSpecId === line.itemSpecId && inv.lotNo === line.lotNo;
                } else {
                    return inv.orderId === line.orderId && inv.itemSpecId === line.itemSpecId;
                }
            });
            if (!_.isEmpty(itemInvs)) {
                pickQty = _.sum(_.map(itemInvs, inv => unitsMap[inv.unitId] ? inv.qty * unitsMap[inv.unitId].baseQty : inv.qty));
            }
            let diffEa = pickQty - commitQty;
            let diffCs = csUomMap[line.itemSpecId] ? parseInt(diffEa / csUomMap[line.itemSpecId].baseQty) : 0;
            let packQty = _.includes(["PICKING", "PICKED"], order.status) ? 0 : pickQty;

            data.push({
                "itemId": line.itemSpecId,
                "item": item ? item.name : "",
                "item desc": item ? item.desc : "",
                "order#": line.orderId,
                "status": order ? order.status : "",
                "longHaul": longHaulMap[order.longHaulId] ? longHaulMap[order.longHaulId].longHaulNo : "",
                "storeNo": order.shipToAddress ? order.shipToAddress.storeNo || "" : "",
                "order_date": order && order.orderedDate ? momentZone(order.orderedDate).format('YYYY-MM-DD HH:mm:ss') : "",
                "shipped_date": order && order.shippedTime ? momentZone(order.shippedTime).format('YYYY-MM-DD HH:mm:ss') : "",
                "reference#": order && order.referenceNo ? order.referenceNo : "",
                "uom": "EA",
                "orderQty": orderQty,
                "commitQty": commitQty,
                "pickQty": pickQty,
                "packQty": packQty,
                "Difference_EA": diffEa,
                "Diff_Case": diffCs
            });
        });

        return {
            results: {
                data: data,
                head: [
                    "itemId",
                    "item",
                    "item desc",
                    "order#",
                    "status",
                    "longHaul",
                    "storeNo",
                    "order_date",
                    "shipped_date",
                    "reference#",
                    "uom",
                    "orderQty",
                    "commitQty",
                    "pickQty",
                    "packQty",
                    "Difference_EA",
                    "Diff_Case"
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

    class OrderSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'customerId'),
                excludeStatuses: new MongoOperator('$nin', 'status'),
                timeFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                timeTo: new MongoOperator('$lte', 'createdWhen', 'Date'),
                shippedTimeFrom: new MongoOperator('$gte', 'shippedTime', 'Date'),
                shippedTimeTo: new MongoOperator('$lte', 'shippedTime', 'Date')
            };
        }
    }

    return {
        getCompareReport
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};