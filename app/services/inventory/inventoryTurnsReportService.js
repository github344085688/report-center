let service = (app, ctx) => {

    async function search(param) {
        let createdWhenFrom = param.timeFrom;
        let createdWhenTo = param.timeTo;
        let customerId = param.customerId;
        let itemSpecIds = param.itemSpecIds;

        if (!customerId) {
            throw new BadRequestError('Please select one customer.');
        }

        if (!createdWhenFrom) {
            throw new BadRequestError('Please fill in the start date.');
        }

        if (!createdWhenTo) {
            throw new BadRequestError('Please fill in the end date.');
        }

        let [beginningInventories, closingInventories] = await Promise.all([
            wmsApp(ctx).post("/inventories/generate-report", {
                customerId: customerId,
                endTime: createdWhenFrom,
                itemSpecIds: itemSpecIds
            }),
            wmsApp(ctx).post("/inventories/generate-report", {
                customerId: customerId,
                endTime: createdWhenTo,
                itemSpecIds: itemSpecIds
            })
        ]);

        itemSpecIds = _.uniq(_.map(beginningInventories, "itemSpecId"));
        let [itemSpecs, units] = await Promise.all([
            itemSpecCollection(ctx).query({_id: {$in: itemSpecIds}}, {
                projection: {
                    name: 1,
                    desc: 1,
                    shortDescription: 1,
                    customerId: 1
                }
            }),
            itemUnitCollection(ctx).query({itemSpecId: {$in: itemSpecIds}})
        ]);


        let customerIds = _.uniq(_.map(itemSpecs, "customerId"));
        let organization = await organizationCollection(ctx).find({"_id": {$in: customerIds}}).toArray();
        let itemMap = _.keyBy(itemSpecs, "_id");
        let uomMap = _.keyBy(units, "_id");
        let organizationMap = _.keyBy(organization, "_id");

        let beginningInventoriesMap = _groupInventories(beginningInventories, uomMap);
        let closingInventoriesMap = _groupInventories(closingInventories, uomMap);

        let receiptItemLines = await _getReceivedItemLines(customerIds, createdWhenFrom, createdWhenTo);
        // let pickItemLines = await _getPickedItemLines(createdWhenFrom, createdWhenTo, itemSpecIds);

        let data = [];

        _.forEach(beginningInventoriesMap, function (inventoriesByItemSpec, itemSpecId) {
            let item = itemMap[itemSpecId] || {};
            let organization = organizationMap[_.get(item, "customerId")] || {};
            let beginningBalance = _.sumBy(inventoriesByItemSpec, "baseQty");
            let receivedBaseQty = _getReceivedQty(receiptItemLines, itemSpecId, uomMap);
            // let pickedQty = _getPickedQty(pickItemLines, itemSpecId, uomMap);
            let closingBalance = _.sumBy(closingInventoriesMap[itemSpecId], "baseQty");
            // let closingBalance = beginningBalance + receivedBaseQty - pickedQty;
            let turnoverRate = _.round((beginningBalance + receivedBaseQty - closingBalance) / ((beginningBalance + closingBalance) / 2), 2);

            data.push({
                "Customer": _.get(organization, "name"),
                "Item ID": _.get(item, "name"),
                "Description": _.get(item, "desc"),
                "UOM": "EA",
                "Beginning Balance": beginningBalance,
                "Received": receivedBaseQty,
                "Closing Balance": closingBalance,
                "Turnover Rate": turnoverRate
            });
        });

        return {
            results: {
                data: data,
                head: [
                    "Customer",
                    "Item ID",
                    "Description",
                    "UOM",
                    "Beginning Balance",
                    "Received",
                    "Closing Balance",
                    "Turnover Rate"
                ]
            }
        }
    }

    function _groupInventories(inventoies, uomMap) {
        let inventoryMap = [];
        let availableInventories = _.filter(inventoies, function (o) {
            if (_.get(o, "status") == "AVAILABLE") {
                return true;
            }
        });
        _.forEach(availableInventories, function (o) {
            let uom = uomMap[o.unitId];
            if (uom) {
                o.baseQty = uom.baseQty * o.onHandQty;
            } else {
                o.baseQty = o.onHandQty;
            }
        });

        return _.groupBy(availableInventories, "itemSpecId");
    }

    function _getReceivedQty(receiptItemLines, itemSpecId, uomMap) {
        let receivedQty = 0;
        _.forEach(receiptItemLines, function (item) {
            if (item.itemSpecId == itemSpecId) {
                let uom = uomMap[item.receivedUnitId];
                if (uom) {
                    receivedQty += (uomMap[item.receivedUnitId].baseQty * item.receivedQty);
                } else {
                    receivedQty += item.receivedQty;
                }
            }
        });
        return receivedQty;
    }

    function _getPickedQty(pickItemLines, itemSpecId, uomMap) {
        let pickedQty = 0;
        _.forEach(pickItemLines, function (item) {
            if (item.itemSpecId == itemSpecId) {
                pickedQty += (uomMap[item.unitId].baseQty * item.pickedQty);
            }
        });
        return pickedQty;
    }

    async function _getReceivedItemLines(customerIds, createdWhenFrom, createdWhenTo) {
        let receiptCriteria = {
            customerIds: customerIds,
            status: ["CLOSED", "FORCE_CLOSED"],
            devannedTimeFrom: createdWhenFrom,
            devannedTimeTo: createdWhenTo
        };
        let receiptSearch = new ReceiptSearch(receiptCriteria);
        let receipts = await receiptCollection(ctx).find(receiptSearch.buildClause()).toArray();
        let receiptIds = _.map(receipts, "_id");
        let receiptItemLines;
        if (!_.isEmpty(receiptIds)) {
            receiptItemLines = await receiptItemLineCollection(ctx).query({"receiptId": {$in: receiptIds}}, {
                projection: {
                    itemSpecId: 1,
                    unitId: 1,
                    receivedQty: 1,
                    receivedUnitId: 1,
                    receiptId: 1
                }
            });
        }

        let receiptMap = _.keyBy(receipts, "_id");

        _.forEach(receiptItemLines, function (receiptItemLine) {
            let receipt = receiptMap[receiptItemLine.receiptId];
            receiptItemLine.receivedWhen = _.get(receipt, "devannedTime");
        });

        return receiptItemLines;
    }

    async function _getPickedItemLines(createdWhenFrom, createdWhenTo, itemSpecIds) {
        let pickTaskCriteria = {
            pickedWhenFrom: createdWhenFrom,
            pickedWhenTo: createdWhenTo,
            itemSpecIds: itemSpecIds
        };
        let pickTaskSearch = new PickTaskSearch(pickTaskCriteria);
        let pickTasks = await pickTaskCollection(ctx).find(pickTaskSearch.buildClause()).toArray();

        let pickItemLines = _.flatMap(pickTasks, "pickHistories");
        return pickItemLines;
    }

    class ReceiptSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerIds: new MongoOperator('$in', 'customerId'),
                devannedTimeFrom: new MongoOperator('$gte', 'devannedTime', 'Date'),
                devannedTimeTo: new MongoOperator('$lte', 'devannedTime', 'Date'),
                status: new MongoOperator('$in', 'status')
            };
        }
    }

    class PickTaskSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                pickedWhenFrom: new MongoOperator('$gte', 'pickHistories.pickedWhen', 'Date'),
                pickedWhenTo: new MongoOperator('$lte', 'pickHistories.pickedWhen', 'Date'),
                itemSpecIds: new MongoOperator('$in', 'pickHistories.itemSpecId')
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