let service = (app, ctx) => {

    async function search(param) {
        let createdWhenFrom = param.timeFrom;
        let createdWhenTo = param.timeTo;
        let customerId = param.customerId;

        let orderCriteria = {
            customerId: customerId,
            createdWhenFrom: createdWhenFrom,
            createdWhenTo: createdWhenTo,
            statuses: ["PARTIAL_COMMITTED", "COMMIT_BLOCKED", "COMMIT_FAILED", "PLANNING", "PLANNED", "PICKING", "PICKED", "PACKING", "PACKED", "STAGED", "LOADING", "LOADED"]
        };
        let orderSearch = new OrderSearch(orderCriteria);
        let orders = await orderCollection(ctx).find(orderSearch.buildClause(), {
            projection: {
                _id: 1,
                referenceNo: 1,
                orderNote: 1,
                createdWhen: 1,
                customerId: 1,
                status: 1
            }
        }).toArray();
        let data = [];
        let orderItemLines;
        if (!_.isEmpty(orders)) {
            let customerIds = _.map(orders, "customerId");
            let orderIds = _.map(orders, "_id");

            orderItemLines = await orderItemLineCollection(ctx).findByPaging({"orderId": {$in: orderIds}});

            let inventoryLockSql = `select itemSpecId,qty,baseQty,orderId,createdWhen from inventory_lock where orderId in ('${orderIds.join(`','`)}')`;
            let lockInventories = await wmsMysql(ctx).query(inventoryLockSql);

            let itemSpecIds = _.map(orderItemLines.results, "itemSpecId");

            let [itemSpecs, units, organizations] = await Promise.all([
                itemSpecCollection(ctx).query({_id: {$in: itemSpecIds}}, {
                    projection: {
                        name: 1,
                        desc: 1,
                        shortDescription: 1,
                        customerId: 1
                    }
                }),
                itemUnitCollection(ctx).query({itemSpecId: {$in: itemSpecIds}}),
                organizationCollection(ctx).query({"_id": {$in: customerIds}})
            ]);

            let ordersMap = _.keyBy(orders, "_id");
            let organizationMap = _.keyBy(organizations, "_id");
            let itemMap = _.keyBy(itemSpecs, "_id");
            let uomMap = _.keyBy(units, "_id");


            _.forEach(orderItemLines.results, function (item) {
                let order = ordersMap[item.orderId];
                let itemSpec = itemMap[item.itemSpecId];
                let itemUnit = uomMap[item.unitId];
                let customer = organizationMap[_.get(order, "customerId")];

                let orderItemLineLock = _getOrderItemLineLock(lockInventories, item.orderId, item, uomMap);
                if (_.get(item, "qty") > orderItemLineLock) {
                    data.push({
                        "OrderID": item.orderId,
                        "Reference": _.get(order, "referenceNo"),
                        "Order Date": _.get(order, "createdWhen"),
                        "Item Number": _.get(itemSpec, "name"),
                        "Description": _.get(itemSpec, "desc"),
                        "Facility": app.conf.get('system.facility'),
                        "Customer": _.get(customer, "name"),
                        "Ordered Qty": _.get(item, "qty"),
                        "Committed Qty": orderItemLineLock,
                        "UOM": _.get(itemUnit, "name"),
                        "Detail": "INVENTORY NOT ENOUGH"
                    });
                }
            });
        }


        return {
            results: {
                data: data,
                head: [
                    "OrderID",
                    "Reference",
                    "Order Date",
                    "Item Number",
                    "Description",
                    "Facility",
                    "Customer",
                    "Ordered Qty",
                    "Committed Qty",
                    "UOM",
                    "Detail"
                ]
            }
        }
    }

    function _getOrderItemLineLock(lockInventories, orderId, orderItemLine, itemUOMMap) {
        let orderItemLineLockBaseQty = _.sumBy(lockInventories, function (o) {
            if (_.get(o, "itemSpecId") == _.get(orderItemLine, "itemSpecId") && _.get(o, "orderId") == _.get(orderItemLine, "orderId")) {
                return o.baseQty;
            }
        });

        return orderItemLineLockBaseQty ? orderItemLineLockBaseQty / itemUOMMap[orderItemLine.unitId].baseQty : 0;
    }

    class OrderSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'customerId'),
                createdWhenFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                createdWhenTo: new MongoOperator('$lte', 'createdWhen', 'Date'),
                statuses: new MongoOperator('$in', 'status')
            };
        }
    }

    class OrderItemLineSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                orderId: new MongoOperator('$in', 'orderId')
            };
        }
    }

    return {
        search
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};