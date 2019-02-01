const _ = require('lodash');

let service = (app, ctx) => {

    async function orderLevelSearchByPaging(criteria) {
        let trackingNo = criteria.trackingNo;
        let loadNo = criteria.loadNo;
        let head = [
            "Order Number",
            "PO #",
            "Retailer",
            "Load #",
            "PRO #",
            "Ref. #",
            "Order Status",
            "AppointmentTime",
            "Carrier",
            "SCAC Code",
            "Delivery Service",
            "Ship To",
            "Ship To State",
            "Ship To Zipcode",
            "Store#",
            "Packed Date",
            "Schedule Date"
        ];

        if (trackingNo) {
            let shipmentDetails = await shipmentDetailCollection(ctx).find({trackingNo: trackingNo}).toArray();
            if (!_.isEmpty(shipmentDetails) && shipmentDetails) {
                let orderIds = [];
                let itemLineDetails = _.flatMap(shipmentDetails, "itemLineDetails");
                _.forEach(itemLineDetails, function (detail) {
                    orderIds.push(detail.orderId);
                });
                if (orderIds) {
                    criteria.orderIds = _.uniq(orderIds);
                }
            }

            if (_.isEmpty(criteria.orderIds)) {
                return buildEmptyResult(head, head);
            }

        }

        if (loadNo) {
            let loads = await  loadCollection(ctx).find({loadNo: loadNo}).toArray();
            let loadIds = _.map(loads, "_id");
            if (!_.isEmpty(loadIds)) {
                let orderLines = await loadOrderLineCollection(ctx).find({loadId: {$in: loadIds}}).toArray();
                let orderIds = _.uniq(_.map(orderLines, "orderId"));
                if (!_.isEmpty(orderIds)) {
                    criteria.orderIds = _.uniq(_.union(criteria.orderIds, orderIds));
                }
            }

            if (_.isEmpty(criteria.orderIds)) {
                return buildEmptyResult(head, head);
            }
        }

        let orderSearch = new OrderSearch(criteria);
        let criteriaClause = orderSearch.buildClause();
        if (!criteriaClause) {
            throw new BadRequestError('Please select at least 1 criterion.');
        }

        if (!criteriaClause.shippedTime) {
            criteriaClause.shippedTime = {
                $eq: null
            }
        }

        let orders = await orderCollection(ctx).findByPaging(criteriaClause);

        if (!orders.results || orders.results.length === 0) {
            return {
                results: {
                    data: [],
                    head: head,
                    shortHead: head
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

        let packTasks = await packTaskCollection(ctx).find({orderIds: {$in: orderIds}}).toArray();
        let parcelPackHistories = await parcelPackHistoryCollection(ctx).find({orderIds: {$in: orderIds}}).toArray();
        let packTaskIds = _.map(packTasks, "_id");
        let packTaskHistories = packTaskIds && !_.isEmpty(packTaskIds) ? await packHistoryCollection(ctx).find({taskId: {$in: packTaskIds}}).toArray() : [];


        let orderLines = await loadOrderLineCollection(ctx).find({orderId: {$in: orderIds}}).toArray();
        let orderLineGroup = _.groupBy(orderLines, "orderId");
        let loadIds = _.map(orderLines, "loadId");
        let loads = await  loadCollection(ctx).find({_id: {$in: loadIds}}).toArray();


        let data = [];
        _.forEach(orders.results, order => {
            let customer = organizationMap[order.customerId];
            let retailer = organizationMap[order.retailerId];
            data.push({
                "Order Number": order._id,
                "PO #": order.poNo ? order.poNo : "",
                "Retailer": retailer ? retailer.name : "",
                "Load #": order.loadNo ? order.loadNo : getLoadNoByOrderId(order._id, orderLineGroup, loads),
                "PRO #": order.proNo ? order.poNo : "",
                "Ref. #": order.referenceNo ? order.referenceNo : "",
                "Order Status": order.status,
                "AppointmentTime": order.appointmentTime ? momentZone(order.appointmentTime).format('YYYY-MM-DD HH:mm:ss') : "",
                "Carrier": carrierMap[order.carrierId] ? carrierMap[order.carrierId].name : "",
                "SCAC Code": carrierMap[order.carrierId] ? carrierMap[order.carrierId].scac : "",
                "Delivery Service": order.deliveryService ? order.deliveryService : "",
                "Ship To": order.shipToAddress.name ? order.shipToAddress.name : "",
                "Ship To State": order.shipToAddress.state ? order.shipToAddress.state : "",
                "Ship To Zipcode": order.shipToAddress.zipCode ? order.shipToAddress.zipCode : "",
                "Store#": order.shipToAddress.storeNo ? order.shipToAddress.storeNo : "",
                "Packed Date": getOrderPackDate(order._id, parcelPackHistories, packTaskHistories, packTasks),
                "Schedule Date": order.scheduleDate ? momentZone(order.scheduleDate).format('YYYY-MM-DD HH:mm:ss') : ""

            });


        });

        return {
            results: {
                data: data,
                head: head,
                shortHead: head
            },
            paging: orders.paging
        }

    }

    async function itemlineLevelSearchByPaging(criteria) {
        let head = [
            "Title",
            "Ship To",
            "Order Status",
            "Order #",
            "PO #",
            "Ref. #",
            "Load #",
            "PRO #",
            "Ship To State",
            "Ship To Zipcode",
            "Store #",
            "Item ID",
            "Description",
            "Ordered Qty",
            "UOM",
            "Total CFT",
            "Total Weight",
            "Pallet Qty",
            "Carton Qty",
            "Units Per Pallet",
            "Tracking #",

            "Retailer",
            "Appointment Time",
            "Carrier",
            "SCAC Code",
            "Delivery Service",
            "Buyer Item ID",
            "Grade",
            "Supplier"
        ];
        let shortHead = [
            "Item ID",
            "Tracking #",
            "Description",
            "Buyer Item ID",
            "Grade",
            "Title",
            "Supplier",
            "Ordered Qty",
            "UOM",
            "Total CFT",
            "Total Weight",
            "Pallet Qty",
            "Carton Qty",
            "Units Per Pallet"
        ]

        let trackingNo = criteria.trackingNo;
        let loadNo = criteria.loadNo;
        if (trackingNo) {
            let shipmentDetails = await shipmentDetailCollection(ctx).find({trackingNo: trackingNo}).toArray();
            if (!_.isEmpty(shipmentDetails) && shipmentDetails) {
                let orderIds = [];
                let itemLineDetails = _.flatMap(shipmentDetails, "itemLineDetails");
                _.forEach(itemLineDetails, function (detail) {
                    orderIds.push(detail.orderId);
                });
                if (orderIds) {
                    criteria.orderIds = _.uniq(orderIds);
                }
            }
            if (_.isEmpty(criteria.orderIds)) {
                return buildEmptyResult(head, shortHead);
            }
        }

        if (loadNo) {
            let loads = await  loadCollection(ctx).find({loadNo: loadNo}).toArray();
            let loadIds = _.map(loads, "_id");
            if (!_.isEmpty(loadIds)) {
                let orderLines = await loadOrderLineCollection(ctx).find({loadId: {$in: loadIds}}).toArray();
                let orderIds = _.uniq(_.map(orderLines, "orderId"));
                if (!_.isEmpty(orderIds)) {
                    criteria.orderIds = _.uniq(_.union(criteria.orderIds, orderIds));
                }
            }
            if (_.isEmpty(criteria.orderIds)) {
                return buildEmptyResult(head, shortHead);
            }
        }

        let orderSearch = new OrderSearch(criteria);
        let criteriaClause = orderSearch.buildClause();
        if (!criteriaClause) {
            throw new BadRequestError('Please select at least 1 criterion.');
        }


        let orders = await orderCollection(ctx).find(criteriaClause).toArray();
        let orderIds = _.map(orders, "_id");
        if (_.isEmpty(orderIds)) {
            return buildEmptyResult(head, shortHead);
        }
        criteria.orderIds = orderIds;
        let orderItemLineSearch = new OrderItemLineSearch(criteria);
        let option = orderItemLineSearch.buildClause();

        let itemData = await orderItemLineCollection(ctx).findByPaging(option);

        if (!itemData.results || itemData.results.length === 0) {
            itemData.results = {
                data: [],
                head: head,
                shortHead: shortHead
            }
            return itemData;
        }

        let orderItemLines = itemData.results;

        orderIds = _.uniq(_.map(orderItemLines, "orderId"));

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

        let orderLines = await loadOrderLineCollection(ctx).find({orderId: {$in: orderIds}}).toArray();
        let orderLineGroup = _.groupBy(orderLines, "orderId");
        let loadIds = _.map(orderLines, "loadId");
        let loads = await  loadCollection(ctx).find({_id: {$in: loadIds}}).toArray();

        let shipmentDetails = await shipmentDetailCollection(ctx).find({
            "itemLineDetails.orderId": {$in: orderIds},
            "itemLineDetails.itemSpecId": {$in: itemSpecIds}
        }).toArray();

        let data = [];

        _.forEach(orders, function (order) {
            let customer = organizationMap[order.customerId];
            let retailer = organizationMap[order.retailerId];
            let orderTrackingNoMap = {};
            _.forEach(orderItemLineGroup[order._id], function (item) {
                let supplier = item.supplierId ? organizationMap[item.supplierId] : null;
                let itemSpec = itemMap[item.itemSpecId] || {};
                data.push({
                    "Order #": order._id,
                    "PO #": order.poNo || "",
                    "Retailer": retailer ? retailer.name : "",
                    "Load #": order.loadNo ? order.loadNo : getLoadNoByOrderId(order._id, orderLineGroup, loads),
                    "PRO #": order.proNo || "",
                    "Ref. #": order.referenceNo || "",
                    "Order Status": order.status,
                    "Appointment Time": order.appointmentTime ? momentZone(order.appointmentTime).format('YYYY-MM-DD HH:mm:ss') : "",
                    "Carrier": carrierMap[order.carrierId] ? carrierMap[order.carrierId].name : "",
                    "SCAC Code": carrierMap[order.carrierId] ? carrierMap[order.carrierId].scac : "",
                    "Delivery Service": order.deliveryService || "",
                    "Ship To": order.shipToAddress.name || "",
                    "Ship To State": order.shipToAddress.state || "",
                    "Ship To Zipcode": order.shipToAddress.zipCode || "",
                    "Store #": order.shipToAddress.storeNo || "",

                    "Item ID": itemSpec.name || "",
                    "Tracking #": getItemTrackingNos(item, shipmentDetails),
                    "Description": itemSpec.desc || "",
                    "Buyer Item ID": item.buyerItemId ? item.buyerItemId : "",
                    "Grade": itemSpec.grade || "",
                    "Title": getTitleNamesByTitleId(item.titleId, organizationMap),
                    "Supplier": supplier ? supplier.name : "",
                    "Ordered Qty": item.qty ? item.qty : 0,
                    "UOM": uomMap[item.unitId] ? uomMap[item.unitId].name : "",
                    "Total CFT": itemUnitService(ctx).getCftByUOM(uomMap[item.unitId]) * (item.qty ? item.qty : 0),
                    "Total Weight": itemUnitService(ctx).getWeightByUOM(uomMap[item.unitId]) * (item.qty ? item.qty : 0),
                    "Pallet Qty": item.adjustedPalletQty || item.palletQty || 0,
                    "Carton Qty": calcCartonQty(order._id, item.itemSpecId, shipmentDetails, orderTrackingNoMap),
                    "Units Per Pallet": confsMap[item.lpConfigurationId] ? confsMap[item.lpConfigurationId].totalQty : ""

                });

            })
        })

        itemData.results = {
            data: data,
            head: head,
            shortHead: shortHead
        };

        return itemData;


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
                appointmentTimeFrom: new MongoOperator('$gte', 'appointmentTime', 'Date'),
                appointmentTimeTo: new MongoOperator('$lt', 'appointmentTime', 'Date'),
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
        itemlineLevelSearchByPaging
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
