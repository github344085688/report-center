const ObjectID = require('mongodb-core').BSON.ObjectID;
let service = (app, ctx) => {

    async function getOrderMap(orderIds) {
        return await app.util.getMapFromCache(ctx.cached.orderMap, orderIds, _getOrderMap);
    }

    async function _getOrderMap(orderIds) {
        if (_.isEmpty(orderIds)) return {};
        let orders = await orderCollection(ctx).find({_id: {$in: orderIds}}).toArray();
        return _.keyBy(orders, "_id");
    }

    async function getOrders(customerId, orderTypes, timeFrom, timeTo) {
        let orderSearch = new OrderSearch({
            customerId: customerId,
            orderTypes: orderTypes,
            timeFrom: timeFrom,
            timeTo: timeTo
        });
        let option = orderSearch.buildClause();
        let orders = await orderCollection(ctx).query(option, {projection: tabelFieldMap.orderFields});
        return orders;
    }

    async function getOrderItemLines(orderIds, itemSpecIds) {
        if ((!orderIds || orderIds.length === 0) && (!itemSpecIds || itemSpecIds.length === 0)) return;

        let orderItemLines = [];
        let orderIdGroups = _.chunk(orderIds, 500);
        for (let idGroup of orderIdGroups) {
            let param = {orderId: {$in: idGroup}};
            if (itemSpecIds && itemSpecIds.length > 0) {
                param.itemSpecId = {$in: itemSpecIds};
            }
            let itemLines = await orderItemLineCollection(ctx).query(param, {projection: tabelFieldMap.orderItemLineFields});
            orderItemLines = _.union(orderItemLines, itemLines);
        }
        return orderItemLines;
    }

    async function getOutBoundData(customerId, itemSpecIds, orderTypes, timeFrom, timeTo) {
        let orders = await getOrders(customerId, orderTypes, timeFrom, timeTo);
        let orderIds = _.map(orders, "_id");
        let orderInventories = [];
        if (orderIds && orderIds.length > 0) {
            orderInventories = await wmsMysql(ctx).query(`select ${tabelFieldMap.inventoryFields} from inventory where qty>0 and orderId in ('${orderIds.join("','")}')`);
        }
        let unitMap = await itemUnitService(ctx).getUnitMap(null, customerId, itemSpecIds);

        let data = [];
        _.forEach(orderInventories, inv => {
            let uom = unitMap[inv.unitId];
            data.push({
                orderId: inv.orderId,
                eaQty: inv.qty ? (uom ? inv.qty * uom.baseQty : inv.qty) : 0,
                lotNo: inv.lotNo,
                itemSpecId: inv.itemSpecId
            });
        })
        return data;
    }

    async function searchByPagingForOrderExport(criteria) {
        let reportHeader = _buildOrderExportHeader();
        let pagingResult = await wmsApp(ctx).post('/outbound/order/search-by-paging', criteria);
        if (!pagingResult.orders || pagingResult.orders.length === 0) {
            return commonService(ctx).buildReportReturnBody([], reportHeader, pagingResult.paging);
        }

        await _fillShipmentDetails(pagingResult.orders);
        await _fillOrgName(pagingResult.orders);
        let orderIds = _.uniq(_.map(pagingResult.orders, "id"));
        let orderItemLineMap = await getOrderItemLineMap(orderIds);

        let reportData = [];
        _.each(pagingResult.orders, order => {
            let orderItemLines = orderItemLineMap[order.id];
            if (!orderItemLines) return;
            _.each(orderItemLines, itemLine => {
                let data = _.cloneDeep(order);
                data["ITEM"] = itemLine.itemName;
                data["SHORT DESC"] = commonService(ctx).ensureNotNull(itemLine.shortDesc);
                data["DESCRIPTION"] = commonService(ctx).ensureNotNull(itemLine.desc);
                data["UNIT"] = commonService(ctx).ensureNotNull(itemLine.unitName);
                data["QTY"] = itemLine.qty;
                data["PALLETLABELS"] = order.palletLabels ? _.join(order.palletLabels, ";") : "";
                //to keep the same with original report ,put below fields empty
                data["SOLDTOADDRESS"] = "";
                data["STOREADDRESS"] = "";
                data["BILLTOADDRESS"] = "";
                data["DYNAMICFIELDS"] = "";
                data["SONOS"] = commonService(ctx).unwindList(data.soNos);
                data["TRACKINGNO"] = _getTrackingNo(order.shipmentDetails, itemLine.itemSpecId);
                // add shipToAddress info
                data["NAME"] = commonService(ctx).ensureNotNull(data.shipToAddress.name);
                data["EMAIL"] = commonService(ctx).ensureNotNull(data.shipToAddress.email);
                data["PHONE"] = commonService(ctx).ensureNotNull(data.shipToAddress.phone);
                data["ADDRESS1"] = commonService(ctx).ensureNotNull(data.shipToAddress.address1);
                data["ADDRESS2"] = commonService(ctx).ensureNotNull(data.shipToAddress.address2);
                data["CITY"] = commonService(ctx).ensureNotNull(data.shipToAddress.city);
                data["STATE"] = commonService(ctx).ensureNotNull(data.shipToAddress.state);
                data["ZIPCODE"] = commonService(ctx).ensureNotNull(data.shipToAddress.zipCode);
                data["COUNTRY"] = commonService(ctx).ensureNotNull(data.shipToAddress.country);
                data = commonService(ctx).convertObjectKeyByFunction(data, _.toUpper);
                data = commonService(ctx).convertToYNObjectLevel(data);
                reportData.push(data);
            });
        });
        return commonService(ctx).buildReportReturnBody(reportData, reportHeader, pagingResult.paging);
    }

    function _getTrackingNo(shipmentDetails, itemSpecId) {
        let matchedShipments = _.filter(shipmentDetails, function (s) {
            let matched = _.filter(s.itemLineDetails, o => o.itemSpecId === itemSpecId);
            if (!_.isEmpty(matched))
                return s;
        });
        if (_.isEmpty(matchedShipments)) return "";
        return _.join(_.map(matchedShipments, "trackingNo"), ",");
    }

    async function _fillOrgName(orders) {
        let orgIds = _.union(_.map(orders, "customerId"), _.map(orders, "retailerId"), _.map(orders, "carrierId"));
        let orgMap = await organizationService(ctx).getOrganizationMap(orgIds);
        _.each(orders, o => {
            o.customer = o.customerId ? (orgMap[o.customerId] ? commonService(ctx).ensureNotNull(orgMap[o.customerId].name) : "") : "";
            o.carrier = o.carrierId ? (orgMap[o.carrierId] ? commonService(ctx).ensureNotNull(orgMap[o.carrierId].name) : "") : "";
            o.retailer = o.retailerId ? (orgMap[o.retailerId] ? commonService(ctx).ensureNotNull(orgMap[o.retailerId].name) : "") : "";
        })
    }

    async function _fillShipmentDetails(orders) {
        let orderIds = _.uniq(_.map(orders, "id"));
        if (_.isEmpty(orderIds)) return;
        let shipmentDetails = await shipmentDetailCollection(ctx).find({"itemLineDetails.orderId": {$in: orderIds}}).toArray();
        for (let order of orders) {
            let matchedShipments = _.filter(shipmentDetails, function (sd) {
                let orderIds = _.uniq(_.map(sd.itemLineDetails, "orderId"));
                if (_.includes(orderIds, order.id)) {
                    return sd;
                }
            });
            order.shipmentDetails = matchedShipments;
        }
    }

    async function getOrderItemLineMap(orderIds) {
        if (_.isEmpty(orderIds)) return {};

        let orderItemLines = await orderItemLineCollection(ctx).query({"orderId": {$in: orderIds}});
        if (_.isEmpty(orderItemLines)) return {};
        //get itemName
        let itemSpecIds = _.uniq(_.map(orderItemLines, "itemSpecId"));
        let itemSpecs = await itemSpecCollection(ctx).find({"_id": {$in: itemSpecIds}}).toArray();
        let itemSpecMap = _.keyBy(itemSpecs, "_id");

        //get unitName
        let unitIds = _.map(_.uniq(_.map(orderItemLines, "unitId")), unitId => new ObjectID(unitId));
        let itemUnits = await itemUnitCollection(ctx).find({"_id": {$in: unitIds}}).toArray();
        let itemUnitMap = _.keyBy(itemUnits, "_id");

        _.each(orderItemLines, o => {
            //fill itemSpec Info
            let item = itemSpecMap[o.itemSpecId];
            if (item) {
                o.itemName = item.name;
                o.desc = item.desc;
                o.shortDesc = item.shortDescription;
            }

            //fill itemSpec Info
            let unit = itemUnitMap[o.unitId];
            if (unit) {
                o.unitName = unit.name;
            }
        });
        return _.groupBy(orderItemLines, "orderId");
    }

    async function searchOrderIdByKeyword(criteria) {
        /*
         keyword can be:
         _id,poNo,soNos,proNo,bolNo,referenceNo,upcCode,upcCodeCase,eanCode,name,desc,shortDescription,batchCommitmentNo;
         snNo;
         trackingNo of small parcel shipment;
         loadNo;
         itemKeyword can be item keyword or AKA value
         */
        let orderIds = [];
        if (!_.isEmpty(criteria.itemKeyword)) {
            criteria.itemSpecIds = await itemSpecService(ctx).searchItemSpecIdByKeyword(criteria.itemKeyword, criteria.customerId);
            let orders = await orderItemLineCollection(ctx).find({itemSpecId: {$in: criteria.itemSpecIds}}, {projection:{orderId: 1}}).toArray();
            orderIds = _.mapUniq(orders, "orderId");
        }

        if (!_.isEmpty(criteria.keyword)) {
            let [orders, inventories, shipmentDetails, loads] = await Promise.all([
                wmsApp(ctx).post('/outbound/order/search', {"keyword": criteria.keyword}),
                wmsApp(ctx).post('/inventories/search', {"sn": criteria.keyword}),
                wmsApp(ctx).post('/small-parcel-shipment/shipment-detail/search', {"trackingNo": criteria.keyword}),
                wmsApp(ctx).post('/outbound/load/search', {"loadNos": [criteria.keyword]})
            ]);
            let idFromOrder = _.mapUniq(orders, "id");
            let idFromInventory = _.mapUniq(inventories, "orderId");
            let idFromShipmentDetail = _.mapUniq(_.flatMap(shipmentDetails, "itemLineDetails"), "orderId");
            let idFromLoad = _.mapUniq(_.flatMap(loads, "orderLines"), "orderId");
            orderIds = _.union(orderIds, idFromOrder, idFromInventory, idFromShipmentDetail, idFromLoad);
        }
        return orderIds;
    }

    function _buildOrderExportHeader() {
        let reportHeader = [
            "ID", "ITEM", "SHORT DESC", "DESCRIPTION", "TRACKINGNO", "UNIT", "QTY", "ONETIME", "STATUS", "PRESTATUS", "CARRIERSIGNATURE", "SHIPPERSIGNATURE", "CUSTOMER", "CARRIER",
            "RETAILER", "PRONO", "REFERENCENO", "BATCHNO", "BATCHCOMMITMENTNO", "BOLNO", "LOADNO", "ORDEREDDATE", "SHIPNOTBEFORE", "SHIPNOLATER", "ROUTEDDATE", "SHIPMETHOD",
            "DELIVERYSERVICE", "STORE", "STOREID", "SHIPPINGACCOUNTNO", "TOTALWEIGHT", "TOTALCUBICFOOT", "CONTAINERSIZE", "CARTONNO", "PICKWAY", "PONO", "SONOS", "FREIGHTTERM",
            "MABD", "CARRIERSIGNATURETIME", "SHIPPERSIGNATURETIME", "APPOINTMENTTIME", "INYARDTIME", "CANCELEDDATE", "SCHEDULEDATE", "SHIPPEDTIME", "PLACEMENTTIME", "SHIPFROM",
            "SHIPFROMID", "SOLDTOADDRESS", "NAME", "EMAIL", "PHONE", "ADDRESS1", "ADDRESS2", "CITY", "STATE", "ZIPCODE", "COUNTRY", "STOREADDRESS", "BILLTOADDRESS", "ORDERNOTE",
            "LABELNOTE", "PICKNOTE", "LOADNOTE", "BOLNOTE", "SOURCE", "PDFID", "ALLOWPARTIALLOCKINVENTORY", "COMMITMENTINCLUDEWIP", "COMPANYID", "PRIORITYPOINTS", "ISUSERSPECIFIED",
            "SHIPMENTTRACKINGTYPE", "CANCELNOTE", "DYNAMICFIELDS", "ORDERTYPE", "ORDERTYPECODE", "ISTRANSLOAD", "TOTALPALLETS", "PALLETLABELS", "LONGHAULID", "ENABLEAUTOCOMMIT",
            "ISALLOWRETRYCOMMIT", "ATTEMPTEDCOMMITDATE", "ISRUSH", "BILLINGMANUALVIEWS", "ITEMLINECOUNT", "CREATEDBY", "CREATEDWHEN", "UPDATEDBY", "UPDATEDWHEN"
        ];
        return reportHeader;
    }

    async function aggregateSearchScheduleSummaryByPaging(criteria) {
        criteria.appointmentTimeNotNull = true;
        let orderSearchCriteria = new OrderSearch(criteria);

        let searchPipeline = [
            {$match: orderSearchCriteria.buildClause()},
            {
                $lookup: {
                    from: "order_itemline",
                    localField: "_id",
                    foreignField: "orderId",
                    as: "orderItemLine"
                }
            },
            {$unwind: "$orderItemLine"},
            {
                $group: {
                    _id: {
                        customerId: "$customerId",
                        titleId: "$titleId",
                        itemSpecId: "$orderItemLine.itemSpecId",
                        unitId: "$orderItemLine.unitId",
                        appointmentDate: {$dateToString: {format: "%Y-%m-%d", date: "$appointmentTime"}}
                    },
                    orderIds: {$push: "$_id"}
                }
            }
        ];
        return await orderCollection(ctx).aggregateByPaging(searchPipeline);
    }

    async function aggregateSearchShippingSummaryByPaging(criteria) {
        criteria.shippedTimeNotNull = true;
        let orderSearchCriteria = new OrderSearch(criteria);

        let searchPipeline = [
            {$match: orderSearchCriteria.buildClause()},
            {
                $lookup: {
                    from: "order_itemline",
                    localField: "_id",
                    foreignField: "orderId",
                    as: "orderItemLine"
                }
            },
            {$unwind: "$orderItemLine"},
            {
                $group: {
                    _id: {
                        customerId: "$customerId",
                        titleId: "$titleId",
                        itemSpecId: "$orderItemLine.itemSpecId",
                        unitId: "$orderItemLine.unitId",
                        shippedDate: {$dateToString: {format: "%Y-%m-%d", date: "$shippedTime"}}
                    },
                    orderIds: {$push: "$_id"}
                }
            }
        ];
        return await orderCollection(ctx).aggregateByPaging(searchPipeline);
    }

    function getOrderPalletQty(order, customer, itemLines, shipmentTickets) {
        if (customer.orderTotalPalletsFirst && order.totalPallets) return order.totalPallets;

        let palletQty = 0;
        _.forEach(itemLines, line => palletQty += line.adjustedPalletQty || 0);
        if (palletQty > 0) return palletQty;

        _.forEach(shipmentTickets, ticket => palletQty += ticket.loadedSlpIds ? ticket.loadedSlpIds.length : 0);
        if (palletQty > 0) return palletQty;

        _.forEach(itemLines, line => palletQty += line.palletQty || 0);
        if (palletQty > 0) return palletQty;

        return order.totalPallets || 0;
    }

    class OrderSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'customerId'),
                orderTypes: new MongoOperator('$in', 'orderType'),
                timeFrom: new MongoOperator('$gte', 'shippedTime', 'Date'),
                timeTo: new MongoOperator('$lte', 'shippedTime', 'Date'),
                shippedTimeNotNull: new MongoOperator('$notnull', 'shippedTime'),
                appointmentTimeNotNull: new MongoOperator('$notnull', 'appointmentTime')
            };
        }
    }

    return {
        getOrderPalletQty,
        getOrderItemLines,
        getOrders,
        getOutBoundData,
        searchByPagingForOrderExport,
        getOrderMap,
        searchOrderIdByKeyword,
        aggregateSearchScheduleSummaryByPaging,
        aggregateSearchShippingSummaryByPaging
    };
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};