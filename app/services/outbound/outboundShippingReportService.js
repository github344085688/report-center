const _ = require('lodash');

let service = (app, ctx) => {

    async function orderLevelSearchByPaging(criteria) {
        if (!_.isEmpty(criteria.keyword)) {
            let orderIdFromKeyword = await orderService(ctx).searchOrderIdByKeyword(criteria.keyword);
            criteria.orderIds = _.union(criteria.orderIds, orderIdFromKeyword);
            if (_.isEmpty(criteria.orderIds)) {
                return buildEmptyResult(orderLevelHeader, orderLevelHeader)
            }
        }

        let orderSearch = new OrderSearch(criteria);
        let criteriaClause = orderSearch.buildClause();
        if (!criteriaClause) {
            throw new BadRequestError('Please select at least 1 criterion.');
        }

        if (!criteriaClause.shippedTime) {
            criteriaClause.shippedTime = {
                $ne: null
            }
        }

        let orders = await orderCollection(ctx).findByPaging(criteriaClause);

        if (!orders.results || orders.results.length === 0) {
            return {
                results: {
                    data: [],
                    head: orderLevelHeader,
                    shortHead: orderLevelHeader
                },
                paging: orders.paging
            }
        }

        let orderIds = _.map(orders.results, "_id");
        let carrierIds = _.uniq(_.map(_.filter(orders.results, order => !_.isEmpty(order.carrierId)), "carrierId"));
        let carriers = await carrierCollection(ctx).find({_id: {$in: carrierIds}}).toArray();
        let carrierMap = _.keyBy(carriers, "_id");

        let customerIds = _.uniq(_.map(_.filter(orders.results, order => !_.isEmpty(order.customerId)), "customerId"));
        let retailerIds = _.uniq(_.map(_.filter(orders.results, order => !_.isEmpty(order.retailerId)), "retailerId"));

        let organizationIds = _.uniq(_.union(customerIds, retailerIds));
        let organizationMap = await organizationService(ctx).getOrganizationMap(organizationIds);

        let [packTasks,parcelPackHistories] = await Promise.all([
            packTaskCollection(ctx).find({orderIds: {$in: orderIds}}).toArray(),
            parcelPackHistoryCollection(ctx).find({orderIds: {$in: orderIds}}).toArray()
        ]);
        let packTaskIds = _.compact(_.uniq(_.map(packTasks, "_id")));
        let packTaskHistories = [];
        if (!_.isEmpty(packTaskIds)) {
            packTaskHistories = await packHistoryCollection(ctx).find({taskId: {$in: packTaskIds}}).toArray();
        }

        let orderLines = await loadOrderLineCollection(ctx).find({orderId: {$in: orderIds}}).toArray();
        let orderLineGroup = _.groupBy(orderLines, "orderId");
        let loadIds = _.map(orderLines, "loadId");
        let loads = await  loadCollection(ctx).find({_id: {$in: loadIds}}).toArray();

        let [orderItemLines,shipmentTickets] = await Promise.all([
            orderItemLineCollection(ctx).query({orderId:{$in:orderIds}},{projection:{orderId:1,adjustedPalletQty:1,palletQty:1}}),
            shipmentTicketCollection(ctx).query({orderId:{$in:orderIds}},{projection:{orderId:1,loadedSlpIds:1}})
        ]);
        let orderItemLineGroup = _.groupBy(orderItemLines, "orderId");
        let shipmentTicketGroup = _.groupBy(shipmentTickets, "orderId");

        let data = [];
        _.forEach(orders.results, order => {
            let customer = organizationMap[order.customerId];
            let retailer = organizationMap[order.retailerId];
            let itemLines = orderItemLineGroup[order._id] || [];
            let shipmentTickets = shipmentTicketGroup[order._id] || [];

            data.push({
                "Order #": order._id,
                "PO #": order.poNo ? order.poNo : "",
                "Retailer": retailer ? retailer.name : "",
                "Load #": order.loadNo ? order.loadNo : getLoadNoByOrderId(order._id, orderLineGroup, loads),
                "PRO #": order.proNo ? order.proNo : "",
                "Ref. #": order.referenceNo ? order.referenceNo : "",
                "Status": order.status,
                "Carrier": carrierMap[order.carrierId] ? carrierMap[order.carrierId].name : "",
                "SCAC Code": carrierMap[order.carrierId] ? carrierMap[order.carrierId].scac : "",
                "Delivery Service": order.deliveryService ? order.deliveryService : "",
                "Shipped Date": order.shippedTime ? momentZone(order.shippedTime).format('YYYY-MM-DD') : "",
                "Shipped Time": order.shippedTime ? momentZone(order.shippedTime).format('HH:mm:ss') : "",
                "Shipped To": order.shipToAddress.name ? order.shipToAddress.name : "",
                "Packed Date": getOrderPackDate(order._id, parcelPackHistories, packTaskHistories, packTasks),
                "Pallet Quanity": orderService(ctx).getOrderPalletQty(order, customer, itemLines, shipmentTickets)
            });
        });

        return {
            results: {
                data: data,
                head: orderLevelHeader,
                shortHead: orderLevelHeader
            },
            paging: orders.paging
        }

    }

    async function itemlineLevelSearchByPaging(criteria) {
        if (!_.isEmpty(criteria.keyword)) {
            let orderIdByKeyword = await orderService(ctx).searchOrderIdByKeyword(criteria.keyword);
            criteria.orderIds = _.union(criteria.orderIds, orderIdByKeyword);
            if (_.isEmpty(criteria.orderIds)) {
                return buildEmptyResult(orderLevelHeader, orderLevelHeader)
            }
        }

        let orderSearch = new OrderSearch(criteria);
        let criteriaClause = orderSearch.buildClause();
        if (!criteriaClause) {
            throw new BadRequestError('Please select at least 1 criterion.');
        }


        let orders = await orderCollection(ctx).query(criteriaClause, {projection:{_id:1}});

        let orderIds = _.uniq(_.map(orders, "_id"));
        if (_.isEmpty(orderIds)) {
            orderIds = ["-1"];
        }

        criteria.orderIds = orderIds;
        let orderItemLineSearch = new OrderItemLineSearch(criteria);
        let option = orderItemLineSearch.buildClause();

        let itemData = await orderItemLineCollection(ctx).findByPaging(option);

        if (!itemData.results || itemData.results.length === 0) {
            itemData.results = {
                data: [],
                head: itemLevelHeader,
                shortHead: itemLevelShortHeader
            }
            return itemData;
        }
        let orderItemLines = itemData.results;

        orderIds = _.uniq(_.map(orderItemLines, "orderId"));
        orders = await orderCollection(ctx).query({_id: {$in: orderIds}});

        let customerIds = _.uniq(_.map(_.filter(orders, order => !_.isEmpty(order.customerId)), "customerId"));
        let retailerIds = _.uniq(_.map(_.filter(orders, order => !_.isEmpty(order.retailerId)), "retailerId"));
        let titleIds = _.uniq(_.map(_.filter(orderItemLines, line => !_.isEmpty(line.titleId)), "titleId"));
        let supplierIds = _.uniq(_.map(_.filter(orderItemLines, line => !_.isEmpty(line.supplierId)), "supplierId"));
        let organizationIds = _.uniq(_.union(titleIds, customerIds, supplierIds, retailerIds));
        let organizationMap = await organizationService(ctx).getOrganizationMap(organizationIds);
        let orderItemLineGroup = _.groupBy(orderItemLines, "orderId");

        let carrierIds = _.uniq(_.map(_.filter(orders, order => !_.isEmpty(order.carrierId)), "carrierId"));
        let carriers = await carrierCollection(ctx).find({_id: {$in: carrierIds}}).toArray();
        let carrierMap = _.keyBy(carriers, "_id");

        let itemSpecIds = _.uniq(_.map(orderItemLines, "itemSpecId"));
        let items = await itemSpecCollection(ctx).find({_id: {$in: itemSpecIds}}, tabelFieldMap.itemSpecFields).toArray();
        let itemMap = _.keyBy(items, "_id");
        let uoms = await itemUnitCollection(ctx).find({itemSpecId: {$in: itemSpecIds}}).toArray();
        let uomMap = _.keyBy(uoms, "_id");

        let confIds = _.map(orderItemLines, "lpConfigurationId");
        let confs = await singleLpTemplateCollection(ctx).find({_id: {$in: confIds}}).toArray();
        let confsMap = _.keyBy(confs, "_id");

        let packTasks = await packTaskCollection(ctx).find({orderIds: {$in: orderIds}}).toArray();
        let parcelPackHistories = await parcelPackHistoryCollection(ctx).find({orderIds: {$in: orderIds}}).toArray();
        let packTaskIds = _.map(packTasks, "_id");
        let packTaskHistories = packTaskIds && !_.isEmpty(packTaskIds) ? await packHistoryCollection(ctx).find({taskId: {$in: packTaskIds}}).toArray() : [];


        let orderLines = await loadOrderLineCollection(ctx).find({orderId: {$in: orderIds}}).toArray();
        let orderLineGroup = _.groupBy(orderLines, "orderId");
        let loadIds = _.map(orderLines, "loadId");
        let loads = await  loadCollection(ctx).find({_id: {$in: loadIds}}).toArray();

        let shipmentDetails = await shipmentDetailCollection(ctx).find({
            "itemLineDetails.orderId": {$in: orderIds},
            "itemLineDetails.itemSpecId": {$in: itemSpecIds}
        }).toArray();

        let orderIdStr = "'" + orderIds.join("','") + "'";
        let [lockInventory, pickInventory] = await Promise.all([
            wmsMysql(ctx).query(`SELECT orderId,itemSpecId,unitId,qty,baseQty,orderItemLineId FROM inventory_lock WHERE orderId IN(${orderIdStr})`),
            wmsMysql(ctx).query(`SELECT orderId,itemSpecId,unitId,qty,lotNo FROM inventory WHERE orderId IN(${orderIdStr})`)
        ]);
        let lockInventoryGroup = _.groupBy(lockInventory, "orderItemLineId");

        let data = [];

        _.forEach(orders, function (order) {
            let customer = organizationMap[order.customerId];
            let retailer = organizationMap[order.retailerId];
            let orderTrackingNoMap = {};
            _.forEach(orderItemLineGroup[order._id], function (item) {
                let commitQty = 0;
                let lockInvs = lockInventoryGroup[item._id];
                if (lockInvs) {
                    commitQty = _.sum(_.map(lockInvs, inv => uomMap[inv.unitId] ? inv.qty * uomMap[inv.unitId].baseQty : inv.qty));
                }
                let pickQty = 0;
                let itemInvs = _.remove(pickInventory, inv => {
                    if (item.lotNo) {
                        return inv.orderId === item.orderId && inv.itemSpecId === item.itemSpecId && inv.lotNo === item.lotNo;
                    } else {
                        return inv.orderId === item.orderId && inv.itemSpecId === item.itemSpecId;
                    }
                });
                if (!_.isEmpty(itemInvs)) {
                    pickQty = _.sum(_.map(itemInvs, inv => uomMap[inv.unitId] ? inv.qty * uomMap[inv.unitId].baseQty : inv.qty));
                }

                let supplier = item.supplierId ? organizationMap[item.supplierId] : null;
                data.push({
                    "Order #": order._id,
                    "PO #": order.poNo ? order.poNo : "",
                    "Retailer": retailer ? retailer.name : "",
                    "Load #": order.loadNo ? order.loadNo : getLoadNoByOrderId(order._id, orderLineGroup, loads),
                    "PRO #": order.proNo,
                    "Ref. #": order.referenceNo ? order.referenceNo : "",
                    "Status": order.status,
                    "Carrier": carrierMap[order.carrierId] ? carrierMap[order.carrierId].name : "",
                    "SCAC Code": carrierMap[order.carrierId] ? carrierMap[order.carrierId].scac : "",
                    "Delivery Service": order.deliveryService ? order.deliveryService : "",
                    "Shipped Date": order.shippedTime ? momentZone(order.shippedTime).format('YYYY-MM-DD') : "",
                    "Shipped Time": order.shippedTime ? momentZone(order.shippedTime).format('HH:mm:ss') : "",
                    "Shipped To": order.shipToAddress.name ? order.shipToAddress.name : "",
                    "Packed Date": getOrderPackDate(order._id, parcelPackHistories, packTaskHistories, packTasks),


                    "Item ID": itemMap[item.itemSpecId] ? itemMap[item.itemSpecId].name : "",
                    "Tracking #": getItemTrackingNos(item, shipmentDetails),
                    "Description": itemMap[item.itemSpecId] ? itemMap[item.itemSpecId].desc : "",
                    "Buyer Item ID": item.buyerItemId ? item.buyerItemId : "",
                    "Grade": itemMap[item.itemSpecId] ? itemMap[item.itemSpecId].grade : "",
                    "Title": getTitleNamesByTitleId(item.titleId, organizationMap),
                    "Supplier": supplier ? supplier.name : "",
                    "Ordered Qty": item.qty ? item.qty : 0,
                    "Committed Qty": commitQty,
                    "Picked Qty": pickQty,
                    "Shipped Qty": item.shippedQty ? item.shippedQty : 0,
                    "UOM": uomMap[item.unitId] ? uomMap[item.unitId].name : "",
                    "Total Weight": itemUnitService(ctx).getWeightByUOM(uomMap[item.unitId]) * (item.shippedQty ? item.shippedQty : 0),
                    "Shipped Total CFT": itemUnitService(ctx).getCftByUOM(uomMap[item.unitId]) * (item.shippedQty ? item.shippedQty : 0),
                    "Carton Qty": calcCartonQty(order._id, item.itemSpecId, shipmentDetails, orderTrackingNoMap),
                    "Units Per Pallet": confsMap[item.lpConfigurationId] ? confsMap[item.lpConfigurationId].totalQty : ""

                });

            })
        })

        itemData.results = {
            data: data,
            head: itemLevelHeader,
            shortHead: itemLevelShortHeader
        };

        return itemData;

    }

    function getItemTrackingNos(item, shipmentDetails) {
        if (!_.isEmpty(shipmentDetails)) {
            let trackingNoList = _.uniq(_.map(_.filter(shipmentDetails, function (detail) {
                let itemLineDetails = _.filter(detail.itemLineDetails, i => i.orderId == item.orderId && i.itemSpecId == item.itemSpecId);
                if (!_.isEmpty(itemLineDetails)) return true;
            }), "trackingNo"));
            if (!_.isEmpty(trackingNoList)) {
                return _.join(trackingNoList, ",");
            }

        }
        return "";
    }

    function buildEmptyResult(head, shortHead) {
        return {
            results: {
                data: [],
                head: head,
                shortHead: shortHead
            },
            paging: {}
        }
    }


    function getOrderPackDate(orderId, parcelPackHistories, packHistories, packTasks) {
        if (!parcelPackHistories && !packHistories) {
            return "";
        }
        let res = _.filter(parcelPackHistories, function (parcelPackHistory) {
            return _.includes(parcelPackHistory.orderIds, orderId);
        });
        if (res && res.length > 0) {
            return res[0].packedWhen ? momentZone(res[0].packedWhen).format('YYYY-MM-DD HH:mm:ss') : "";
        }

        let orderTask = _.filter(packTasks, function (packTask) {
            return _.includes(packTask.orderIds, orderId);
        });

        if (orderTask && orderTask.length > 0) {
            let taskId = orderTask[0]._id;
            res = _.filter(packHistories, function (packHistory) {
                return _.includes(packHistory.taskId, taskId);
            });
            if (res && res.length > 0) {
                return res[0].packedWhen ? momentZone(res[0].packedWhen).format('YYYY-MM-DD HH:mm:ss') : "";
            }
        }

        return "";
    }

    function getTitleNamesByTitleId(titleId, organizationMap) {
        if (titleId) {
            if (organizationMap[titleId].name) {
                return organizationMap[titleId].name;
            }
        }
        return "";

    }

    function calcCartonQty(orderId, itemSpecId, shipmentDetails, orderTrackingNoMap) {
        let cartonQty = 0;
        let trackingNoList = _.uniq(_.map(_.filter(shipmentDetails, function (detail) {
            let itemLineDetails = _.filter(detail.itemLineDetails, i => i.orderId == orderId && i.itemSpecId == itemSpecId);
            if (!_.isEmpty(itemLineDetails)) return true;
        }), "trackingNo"));
        if (orderTrackingNoMap[orderId]) {
            trackingNoList = _.difference(trackingNoList, orderTrackingNoMap[orderId]);
        }
        cartonQty = _.isEmpty(trackingNoList) ? 0 : trackingNoList.length;
        orderTrackingNoMap[orderId] = _.uniq(_.concat(trackingNoList, orderTrackingNoMap[orderId]));

        return cartonQty;
    }

    function getLoadNoByOrderId(orderId, orderLineGroup, loads) {
        let orderLine = orderLineGroup[orderId];
        if (orderLine && orderLine.length > 0) {
            let loadId = orderLine[0].loadId;
            for (let load of loads) {
                if (load._id == loadId) {
                    return load.loadNo ? load.loadNo : "";
                }
            }
        }
        return "";
    }

    let orderLevelHeader = [
        "Order #",
        "PO #",
        "Retailer",
        "Load #",
        "PRO #",
        "Ref. #",
        "Status",
        "Carrier",
        "SCAC Code",
        "Delivery Service",
        "Shipped Date",
        "Shipped Time",
        "Shipped To",
        "Packed Date",
        "Pallet Quanity"
    ];

    let itemLevelHeader = [
        "Order #",
        "PO #",
        "Retailer",
        "Load #",
        "PRO #",
        "Ref. #",
        "Status",
        "Carrier",
        "SCAC Code",
        "Delivery Service",
        "Shipped Date",
        "Shipped Time",
        "Shipped To",
        "Packed Date",

        "Item ID",
        "Tracking #",
        "Description",
        "Buyer Item ID",
        "Grade",
        "Title",
        "Supplier",
        "Ordered Qty",
        "Committed Qty",
        "Picked Qty",
        "Shipped Qty",
        "UOM",
        "Total Weight",
        "Shipped Total CFT",
        "Carton Qty",
        "Units Per Pallet"
    ];

    let itemLevelShortHeader = [
        "Item ID",
        "Tracking #",
        "Description",
        "Buyer Item ID",
        "Grade",
        "Title",
        "Supplier",
        "Ordered Qty",
        "Shipped Qty",
        "UOM",
        "Total Weight",
        "Shipped Total CFT",
        "Carton Qty",
        "Pallet Qty",
        "Units Per Pallet"
    ];

    class OrderSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                orderId: new MongoOperator('$eq', '_id'),
                orderIds: new MongoOperator('$in', '_id'),
                customerId: new MongoOperator('$eq', 'customerId'),
                retailerIds: new MongoOperator('$in', 'retailerId'),
                shippedTimeFrom: new MongoOperator('$gte', 'shippedTime', 'Date'),
                shippedTimeTo: new MongoOperator('$lt', 'shippedTime', 'Date'),
                orderedDateFrom: new MongoOperator('$gte', 'orderedDate', 'Date'),
                orderedDateTo: new MongoOperator('$lt', 'orderedDate', 'Date'),
                scheduleDateFrom: new MongoOperator('$gte', 'scheduleDate', 'Date'),
                scheduleDateTo: new MongoOperator('$lt', 'scheduleDate', 'Date'),
                createdTimeFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                createdTimeTo: new MongoOperator('$lte', 'createdWhen', 'Date'),
                statuses: new MongoOperator('$in', 'status')
            };
        }
    }

    class OrderItemLineSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                itemSpecId: new MongoOperator('$eq', 'itemSpecId'),
                orderIds: new MongoOperator('$in', 'orderId')
            };
        }
    }


    return {
        orderLevelSearchByPaging,
        itemlineLevelSearchByPaging,
        OrderSearch
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
