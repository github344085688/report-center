const _ = require('lodash');

let service = (app, ctx) => {
    async function inquiryReportSearchByPaging(criteria) {
        let pagingResult = await _searchOrderByPaging(criteria);
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["generalLevelFieldMappings"], outboundReportResolver(ctx).resolveOutboundFields);
    }

    async function itemLevelInquiryReportSearchByPaging(criteria) {
        let pagingResult = await _searchOrderItemLineByPaging(criteria);
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["detailLevelFieldMappings"], outboundReportResolver(ctx).resolveOutboundFields);
    }

    /*
     only apply to those item with Serial Number, and cutomer provide SN on RN
     */
    async function idLevelInquiryReportSearchByPaging(criteria) {
        let pagingResult = await _searchSnLevelInventoryWithOriginalLpByPaging(criteria);
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["idLevelFieldMappings"], outboundReportResolver(ctx).resolveOutboundFields);
    }

    async function _searchSnLevelInventoryWithOriginalLpByPaging(criteria) {
        let pagingResult = {paging: criteria.paging, results: []};
        let orderItemLineWithCustomerProvidedSN = await _searchOrderItemLineWithCustomerProvidedSN(criteria);
        if (!_.isEmpty(orderItemLineWithCustomerProvidedSN)) {
            pagingResult = await inventoryStatusReportServiceV2(ctx).searchInventoryByPaging({
                "orderIds": _.mapUniq(orderItemLineWithCustomerProvidedSN, "orderId"),
                "itemSpecIds": _.mapUniq(orderItemLineWithCustomerProvidedSN, "itemSpecId"),
                "snNotNull": true
            });
        }
        return pagingResult;
    }

    async function expandingInquiryReportSearchByPaging(criteria) {
        let pagingResult = await _searchOrderItemLineByPaging(criteria);
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["generalLevelFieldMappings", "detailLevelFieldMappings", "idLevelFieldMappings"], outboundReportResolver(ctx).resolveOutboundFields);
    }

    async function scheduleSummaryReportSearchByPaging(criteria) {
        let pagingResult = await orderService(ctx).aggregateSearchScheduleSummaryByPaging(criteria);
        _.each(pagingResult.results, o => {
            o.orderIds = _.uniq(o.orderIds);
            o.orderCount = _.size(o.orderIds)
        });
        commonService(ctx).assignDataOut(pagingResult.results, '_id');
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["scheduleSummaryFieldMappings"], outboundReportResolver(ctx).resolveOutboundFields);
    }

    async function shippingSummaryReportSearchByPaging(criteria) {
        let pagingResult = await orderService(ctx).aggregateSearchShippingSummaryByPaging(criteria);
        _.each(pagingResult.results, o => {
            o.orderIds = _.uniq(o.orderIds);
            o.orderCount = _.size(o.orderIds)
        });
        commonService(ctx).assignDataOut(pagingResult.results, '_id');
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["receivingOrShippingSummaryFieldMappings"], outboundReportResolver(ctx).resolveOutboundFields);
    }

    async function _searchOrderByPaging(criteria) {
        await _rebuildCriteria(criteria);
        criteria.statuses = await commonService(ctx).multiEnumToDbFormat("OrderStatus", criteria.statuses);
        let orderSearch = new OrderSearch(criteria);
        let option = orderSearch.buildClause();
        let pagingResult = await orderCollection(ctx).findByPaging(option);
        _.each(pagingResult.results, data => {
            data.orderId = data._id;
        });
        return pagingResult;
    }

    async function _searchOrderItemLineByPaging(criteria) {
        await _rebuildCriteria(criteria);
        return await orderItemLineService(ctx).aggregateSearchOrderItemLineByPaging(criteria);
    }

    async function _searchOrderItemLineWithCustomerProvidedSN(criteria) {
        await _rebuildCriteria(criteria);
        criteria.snListNotNull = true;
        return await orderItemLineService(ctx).aggregateSearchOrderItemLine(criteria);
    }

    async function _rebuildCriteria(criteria) {
        let orderIds = [];
        if (!_.isEmpty(criteria.keyword) || !_.isEmpty(criteria.itemKeyword)) {
            if (!_.isEmpty(criteria.itemKeyword)) {
                criteria.itemSpecIds = await itemSpecService(ctx).searchItemSpecIdByKeyword(criteria.itemKeyword, criteria.customerId) || ["-1"];
                let orders = await orderItemLineCollection(ctx).find({itemSpecId: {$in: criteria.itemSpecIds}}, {projection: {orderId: 1}}).toArray();
                orderIds = _.mapUniq(orders, "orderId");
            }

            if (!_.isEmpty(criteria.keyword)) {
                let [orders, inventories, shipmentDetails] = await Promise.all([
                    wmsApp(ctx).post('/outbound/order/search', {
                        "keyword": criteria.keyword,
                        "customerId": criteria.customerId
                    }),
                    wmsApp(ctx).post('/inventories/search', {
                        "sn": criteria.keyword,
                        "customerId": criteria.customerId
                    }),
                    wmsApp(ctx).post('/small-parcel-shipment/shipment-detail/search', {"trackingNo": criteria.keyword})
                ]);
                let idFromOrder = _.mapUniq(orders, "id");
                let idFromInventory = _.mapUniq(inventories, "orderId");
                let idFromShipmentDetail = _.mapUniq(_.flatMap(shipmentDetails, "itemLineDetails"), "orderId");
                orderIds = _.union(orderIds, idFromOrder, idFromInventory, idFromShipmentDetail);
            }

            if (_.isEmpty(orderIds)) {
                orderIds = ["-1"];
            }
        }
        // get order id from load
        if (!_.isEmpty(criteria.keyword) ||
            !_.isEmpty(criteria.loadCompletedWhenFrom) ||
            !_.isEmpty(criteria.loadCompletedWhenTo) ||
            !_.isEmpty(criteria.loadStatuses) ||
            !_.isEmpty(criteria.appointmentTimeFrom) ||
            !_.isEmpty(criteria.appointmentTimeTo)) {
            criteria.loadNos = criteria.keyword ? [criteria.keyword] : null;
            let loadOrders = await _loadOrderLineAggregateSearch(criteria);
            let orderIdFromLoad = _.mapUniq(_.flatMap(loadOrders, "loadOrders"), "orderId");
            if (_.isEmpty(orderIdFromLoad)) {
                orderIdFromLoad = ["-1"];
            }
            orderIds = _.union(orderIds, orderIdFromLoad);
        }
        criteria.orderIds = _.union(criteria.orderIds, orderIds);
    }

    async function _loadOrderLineAggregateSearch(criteria) {
        criteria.statuses = await commonService(ctx).multiEnumToDbFormat("LoadStatus", criteria.statuses);
        let loadSearch = new LoadSearch(criteria);
        let clause = loadSearch.buildClause();
        if (!_.isEmpty(clause)) {
            let result = await loadCollection(ctx).aggregate([
                {$match: clause},
                {
                    $lookup: {
                        from: "load_order_line",
                        localField: "_id",
                        foreignField: "loadId",
                        as: "loadOrders"
                    }
                },
                {$unwind: "$loadOrders",},
                {$project: {"loadOrders": 1}}
            ]);
            return await app.promisify(result.toArray, result)();
        }
    }

    class LoadSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'customerId'),
                loadNos: new MongoOperator('$in', 'loadNo'),
                loadStatuses: new MongoOperator('$in', 'status'),
                loadCompletedWhenFrom: new MongoOperator('$gte', 'endTime', 'Date'),
                loadCompletedWhenTo: new MongoOperator('$lte', 'endTime', 'Date'),
                appointmentTimeFrom: new MongoOperator('$gte', 'appointmentTime', 'Date'),
                appointmentTimeTo: new MongoOperator('$lte', 'appointmentTime', 'Date')
            }
        }
    }

    class OrderSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                orderIds: new MongoOperator('$in', '_id'),
                customerId: new MongoOperator('$eq', 'customerId'),
                statuses: new MongoOperator('$in', 'status'),
                timeFrom: new MongoOperator('$gte', 'shippedTime', 'Date'),
                timeTo: new MongoOperator('$lte', 'shippedTime', 'Date'),
                createdWhenFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                createdWhenTo: new MongoOperator('$lte', 'createdWhen', 'Date'),
                updatedWhenFrom: new MongoOperator('$gte', 'updatedWhen', 'Date'),
                updatedWhenTo: new MongoOperator('$lte', 'updatedWhen', 'Date'),
                // appointmentTimeFrom: new MongoOperator('$gte', 'appointmentTime', 'Date'),
                // appointmentTimeTo: new MongoOperator('$lte', 'appointmentTime', 'Date'),
                mabdFrom: new MongoOperator('$gte', 'mabd', 'Date'),
                mabdTo: new MongoOperator('$lte', 'mabd', 'Date')
            };
        }
    }

    return {
        inquiryReportSearchByPaging,
        itemLevelInquiryReportSearchByPaging,
        idLevelInquiryReportSearchByPaging,
        expandingInquiryReportSearchByPaging,
        scheduleSummaryReportSearchByPaging,
        shippingSummaryReportSearchByPaging

    }
};
module.exports = app => {
    return ctx => service(app, ctx);
};