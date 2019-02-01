
let service = (app, ctx) => {

    function _getEmptyPage() {
        let head = [
            "Customer ID",
            "Supplier ID",
            "Order No.",
            "Account ID",
            "Picking Type",
            "Date Created",
            "Order Date",
            "PS (Print Status)",
            "Item ID",
            "Item Description",
            "Lot Number",
            "Line No",
            "Item CFT",
            "Item WGT",
            "Scan required",
            "Reference Number",
            "PO No",
            "Load No.",
            "Request Date",
            "Schedule Date",
            "Appointment Date",
            "Shipped Date",
            "Ship to",
            "Carrier",
            "Pro No.",
            "Master BOL",
            "Master Ship to",
            "Pallet Type",
            "Order QTY",
            "Shipped QTY",
            "Units Pallet",
            "Pallet QTY"
        ];

        return {
            results: {
                data: [],
                head: head
            }
        };
    }

    function _validate(param) {
        if (!param.customerId) {
            throw new BadRequestError('Please select one customer.');
        }
    }

    async function searchByPaging(param) {
        param.statuses = await commonService(ctx).multiEnumToDbFormat("OrderStatus", param.statuses);

        _validate(param);
        let resData = _getEmptyPage();

        let aggregatePipelines = _getAggregatePipelines(param);
        let orderData = await orderCollection(ctx).aggregateByPaging(aggregatePipelines);
        resData.paging = orderData.paging;

        let orgIds = [param.customerId];
        let carrierIds = _.concat(_.uniq(_.map(orderData.results, "carrierId")));
        let supplierIds = _.concat(_.uniq(_.map(orderData.results, "supplierId")));
        orgIds = _.union(orgIds, carrierIds);
        orgIds = _.union(orgIds, supplierIds);
        orgIds = _.concat(_.uniq(orgIds));

        let itemSpecIds = _.concat(_.uniq(_.map(orderData.results, "itemSpecId")));
        let orderIds = _.concat(_.uniq(_.map(orderData.results, "_id")));

        let [orgMap, items, uoms, itemLpConfigurations, pickTaskOrderMap, loadLines] = await Promise.all([
            organizationService(ctx).getOrganizationMap(orgIds),
            itemSpecCollection(ctx).query({_id:{$in:itemSpecIds}},{projection:{name:1,desc:1,shortDescription:1}}),
            itemUnitCollection(ctx).query({itemSpecId:{$in:itemSpecIds}}),
            itemLpConfigurationService(ctx).getItemLpConfigurations(itemSpecIds),
            pickTaskService(ctx).getPickTaskMapByOrderId(orderIds),
            loadOrderLineCollection(ctx).find({orderId:{$in:orderIds}}).toArray()
        ]);
        let itemMap = _.keyBy(items, "_id");
        let uomMap = _.keyBy(uoms, "_id");

        let loadIds = _.uniq(_.map(loadLines, "loadId"));
        let loads = await loadCollection(ctx).find({_id:{$in:loadIds}},{projection:{masterBolNo:1,"shipToAddress.name":1}}).toArray();
        let loadLineMap = _.keyBy(loadLines, "orderId");
        let loadMap = _.keyBy(loads, "_id");
        let orderLoadMap = {};
        _.forEach(orderIds, orderId => {
            let loadLine = loadLineMap[orderId];
            if (!loadLine) return;
            orderLoadMap[orderId] = loadMap[loadLine.loadId];
        })

        let customer = orgMap[param.customerId];
        let orderLineIndex = {};
        _.forEach(orderData.results, order => {
            let supplier = orgMap[order.supplierId];
            let carrier = orgMap[order.carrierId];
            let item = itemMap[order.itemSpecId];
            let uom = uomMap[order.unitId];
            let template = _.find(itemLpConfigurations, conf => conf.confId === order.lpConfigurationId);
            orderLineIndex[order._id] = orderLineIndex[order._id] || 0;
            orderLineIndex[order._id]++;
            let pTasks = pickTaskOrderMap[order._id];
            let pickType = pTasks && pTasks.length > 0 && pTasks[0].pickType ? pTasks[0].pickType : "";
            let load = orderLoadMap[order._id];

            resData.results.data.push({
                "Customer ID": customer.name,
                "Supplier ID": supplier ? supplier.name : "",
                "Order No.": order._id,
                "Account ID": customer.name,
                "Picking Type": pickType,
                "Date Created": order.createdWhen ? momentZone(order.createdWhen).format('YYYY-MM-DD HH:mm:ss') : "",
                "Order Date": order.orderedDate ? momentZone(order.orderedDate).format('YYYY-MM-DD HH:mm:ss') : "",
                "PS (Print Status)": "YES",
                "Item ID": item ? item.name : "",
                "Item Description": item ? item.desc : "",
                "Lot Number": order.lotNo ? order.lotNo : "",
                "Line No": orderLineIndex[order._id],
                "Item CFT": itemUnitService(ctx).getCftByUOM(uom),
                "Item WGT": itemUnitService(ctx).getWeightByUOM(uom),
                "Scan required": "YES",
                "Reference Number": order.referenceNo ? order.referenceNo : "",
                "PO No": order.poNo ? order.poNo : "",
                "Load No.": order.loadNo ? order.loadNo : "",
                "Request Date": order.mabd ? momentZone(order.mabd).format('YYYY-MM-DD HH:mm:ss') : "",
                "Schedule Date": order.scheduleDate ? momentZone(order.scheduleDate).format('YYYY-MM-DD HH:mm:ss') : "",
                "Appointment Date": order.appointmentTime ? momentZone(order.appointmentTime).format('YYYY-MM-DD HH:mm:ss') : "",
                "Shipped Date": order.shippedTime ? momentZone(order.shippedTime).format('YYYY-MM-DD HH:mm:ss') : "",
                "Ship to": order.shipTo ? order.shipTo : "",
                "Carrier": carrier ? carrier.name : "",
                "Pro No.": order.proNo ? order.proNo : "",
                "Master BOL": load && load.masterBolNo ? load.masterBolNo : "",
                "Master Ship to": load && load.shipToAddress ? load.shipToAddress.name : "",
                "Pallet Type": template ? template.templateName : "",
                "Order QTY": order.qty,
                "Shipped QTY": order.shippedQty ? order.shippedQty : 0,
                "Units Pallet": template ? template.totalQty : 0,
                "Pallet QTY": order.adjustedPalletQty ? order.adjustedPalletQty : (order.palletQty ? order.palletQty : 0)
            })
        });

        return resData;
    }

    function _getAggregatePipelines(param) {
        let orderSearch = new OrderSearch(param);
        let criteriaClause = orderSearch.buildClause();

        let aggregatePipelines = [
            {$match:criteriaClause},
            {$lookup: {
                from: "order_itemline",
                localField: "_id",
                foreignField: "orderId",
                as: "itemLine"
            }},
            {$unwind: "$itemLine"},
            {$project: {
                customerId: 1,
                carrierId:1,
                proNo: 1,
                referenceNo:1,
                bolNo:1,
                loadNo:1,
                poNo:1,
                orderedDate:1,
                shippedTime:1,
                appointmentTime:1,
                createdWhen:1,
                mabd:1,
                scheduleDate:1,
                shipTo:"$shipToAddress.name",
                lineId:"$itemLine._id",
                itemSpecId:"$itemLine.itemSpecId",
                unitId:"$itemLine.unitId",
                qty:"$itemLine.qty",
                shippedQty:"$itemLine.shippedQty",
                palletQty:"$itemLine.palletQty",
                adjustedPalletQty:"$itemLine.adjustedPalletQty",
                lpConfigurationId:"$itemLine.lpConfigurationId",
                lotNo:"$itemLine.lotNo",
                supplierId:"$itemLine.supplierId"
            }}
        ];

        return aggregatePipelines;
    }

    class OrderSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'customerId'),
                statuses: new MongoOperator('$in', 'status'),
                shippedTimeFrom: new MongoOperator('$gte', 'shippedTime', 'Date'),
                shippedTimeTo: new MongoOperator('$lte', 'shippedTime', 'Date'),
                createdTimeFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                createdTimeTo: new MongoOperator('$lte', 'createdWhen', 'Date')
            };
        }
    }

    return {
        searchByPaging
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};