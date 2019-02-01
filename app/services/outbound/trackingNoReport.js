let service = (app, ctx) => {

    class OrderSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'customerId'),
                status: new MongoOperator('$eq', 'status'),
                orderIds: new MongoOperator('$in', '_id'),
                referenceNos: new MongoOperator('$in', 'referenceNo'),
                createdWhenFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                createdWhenTo: new MongoOperator('$lte', 'createdWhen', 'Date'),
                shippedTimeFrom: new MongoOperator('$gte', 'shippedTime', 'Date'),
                shippedTimeTo: new MongoOperator('$lte', 'shippedTime', 'Date'),
                timeFrom: new MongoOperator('$gte', 'shippedTime', 'Date'),
                timeTo: new MongoOperator('$lte', 'shippedTime', 'Date')
            };
        }
    }


    async function searchByPaging(criteria) {
        let aggregatePipelines = [{
            // filter matched orders
            $match: await _buildOrderSearchClause(criteria)
        }, {
            // join shipment_detail collection by orderId
            $lookup: {
                from: "shipment_detail",
                localField: "_id",
                foreignField: "itemLineDetails.orderId",
                as: "shipmentDetails"
            }
        }, {
            $project: {
                _id: 0,
                customerId: 1,
                retailerId: 1,
                carrierId: 1,
                referenceNo: 1,
                poNo: 1,
                createdWhen: 1,
                scheduleDate: 1,
                shippedTime: 1,
                shipTo: "$shipToAddress.name",
                shipmentDetails: 1,
            }
        }, {
            $unwind: {path: "$shipmentDetails", includeArrayIndex: "cartonIndex"}
        }, {
            $project: {
                "shipmentDetails.trackingNo": 1,
                "shipmentDetails.itemLineDetails": 1,
                cartonIndex: 1,
                customerId: 1,
                retailerId: 1,
                carrierId: 1,
                referenceNo: 1,
                poNo: 1,
                createdWhen: 1,
                scheduleDate: 1,
                shippedTime: 1,
                shipTo: 1
            }
        }, {
            $unwind: "$shipmentDetails.itemLineDetails"
        }, {
            $project: {
                cartonIndex: 1,
                customerId: 1,
                retailerId: 1,
                carrierId: 1,
                referenceNo: 1,
                poNo: 1,
                createdWhen: 1,
                scheduleDate: 1,
                shippedTime: 1, shipTo: 1,
                trackingNo: "$shipmentDetails.trackingNo",
                orderId: "$shipmentDetails.itemLineDetails.orderId",
                itemSpecId: "$shipmentDetails.itemLineDetails.itemSpecId",
                qty: "$shipmentDetails.itemLineDetails.qty",
                unitId: "$shipmentDetails.itemLineDetails.unitId"

            }
        }];

        if (!_.isEmpty(criteria.trackingNos)) {
            aggregatePipelines.push({
                // filter by trackingNos
                $match: {"trackingNo": {$in: criteria.trackingNos}}
            })
        }

        let response = await orderCollection(ctx).aggregateByPaging(aggregatePipelines);
        let head = [
            "CUSTOMER",
            "RETAILER",
            "ORDER ID",
            "CARTON NO.",
            "ITEM ID",
            "ITEM DESCRIPTION",
            "REFERENCE NO.",
            "PO NO.",
            "CREATE DATE",
            "SCHEDULE DATE",
            "SHIPPED DATE",
            "SHIP TO",
            "SHIPPED QTY",
            "UOM",
            "CARRIER",
            "TRACKING NO.",
            "SHIPPING COST"
        ];
        if (_.isEmpty(response.results)) {
            return {
                results: {
                    data: [],
                    head: head
                },
                paging: response.paging
            }
        }


        let shipmentItemDetails = response.results;
        let trackingNos = _.map(shipmentItemDetails, "trackingNo");
        let orgIds = _.uniq(_.compact(_.union(_.map(shipmentItemDetails, "customerId"), _.map(shipmentItemDetails, "retailerId"), _.map(shipmentItemDetails, "carrierId"))));
        let itemSpecIds = _.uniq(_.map(shipmentItemDetails, "itemSpecId"));
        let unitIds = _.uniq(_.map(shipmentItemDetails, "unitId"));

        let [shipmentMap, orgMap, itemSpecMap, unitMap] = await Promise.all([
            _getShipmentMap(trackingNos),
            organizationService(ctx).getOrganizationMap(orgIds),
            itemSpecService(ctx).getItemSpecMap(itemSpecIds),
            itemUnitService(ctx).getUnitMap(unitIds)
        ]);

        let data = [];

        _.each(shipmentItemDetails, detail => {
            data.push({
                "CUSTOMER": orgMap[detail.customerId] ? orgMap[detail.customerId].name : "",
                "RETAILER": orgMap[detail.retailerId] ? orgMap[detail.retailerId].name : "",
                "ORDER ID": detail.orderId,
                "CARTON NO.": detail.cartonIndex + 1,
                "ITEM ID": itemSpecMap[detail.itemSpecId].name,
                "ITEM DESCRIPTION": itemSpecMap[detail.itemSpecId].desc,
                "REFERENCE NO.": detail.referenceNo,
                "PO NO.": detail.poNo,
                "CREATE DATE": detail.createdWhen ? momentZone(detail.createdWhen).format('MM/DD/YYYY') : "",
                "SCHEDULE DATE": detail.scheduleDate ? momentZone(detail.scheduleDate).format('MM/DD/YYYY') : "",
                "SHIPPED DATE": detail.shippedTime ? momentZone(detail.shippedTime).format('MM/DD/YYYY') : "",
                "SHIP TO": detail.shipTo,
                "SHIPPED QTY": detail.qty,
                "UOM": unitMap[detail.unitId] ? unitMap[detail.unitId].name : "",
                "CARRIER": orgMap[detail.carrierId] ? orgMap[detail.carrierId].name : "",
                "TRACKING NO.": detail.trackingNo,
                "SHIPPING COST": _getShippingCost(shipmentMap, detail.trackingNo)
            });
        });

        return {
            results: {
                data: data,
                head: head
            },
            paging: response.paging
        }

    }

    async function _buildOrderSearchClause(criteria) {
        if (_.isEmpty(criteria)) {
            throw new BadRequestError("Please select at least 1 criterion.");
        }

        criteria.orderType = "DS";
        if (criteria.status) {
            criteria.status = await commonService(ctx).enumToDbFormat("OrderStatus", criteria.status);
        }
        let orderSearch = new OrderSearch(criteria);
        return orderSearch.buildClause();
    }

    async function _getShipmentMap(trackingNos) {
        if (_.isEmpty(trackingNos)) {
            return {};
        }

        let shipments = await smallParcelShipmentCollection(ctx).find({trackingNo: {$in: trackingNos}}, {projection:{
            trackingNo: 1,
            shippingCost: 1
        }}).toArray();

        return _.keyBy(shipments, "trackingNo");
    }

    function _getShippingCost(shipmentMap, trackingNo) {
        let shippingCost = shipmentMap[trackingNo] ? shipmentMap[trackingNo].shippingCost : 0.00;
        delete shipmentMap[trackingNo];
        return shippingCost;
    }


    return {
        searchByPaging
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};