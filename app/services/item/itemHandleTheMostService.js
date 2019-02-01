let service = (app, ctx) => {

    async function search(param) {
        let createdWhenFrom = momentZone(param.timeFrom).format(); //new Date(momentZone(param.timeFrom).format());
        let createdWhenTo = momentZone(param.timeTo).format();// new Date(momentZone(param.timeTo).format());
        let customerId = param.customerId;

        if (!createdWhenFrom) {
            throw new BadRequestError('Please fill in the start date.');
        }

        if (!createdWhenTo) {
            throw new BadRequestError('Please fill in the end date.');
        }

        let [replenishmentItemLines, pickingItemLines, packingItemLines, putBackItemLines] = await Promise.all([
            itemHandleTheMostService(ctx).getReplenishmentItemLines(createdWhenFrom, createdWhenTo),
            itemHandleTheMostService(ctx).getPickingItemLines(createdWhenFrom, createdWhenTo),
            itemHandleTheMostService(ctx).getPackingItemLines(createdWhenFrom, createdWhenTo),
            itemHandleTheMostService(ctx).getPutBackItemLines(createdWhenFrom, createdWhenTo)
        ]);

        let replenishmentItemSpecIds = _.uniq(_.map(replenishmentItemLines, "itemSpecId"));
        let pickingItemSpecId = _.uniq(_.map(pickingItemLines, "itemSpecId"));
        let packingItemSpecId = _.uniq(_.map(packingItemLines, "itemSpecId"));
        let putBackItemSpecId = _.uniq(_.map(putBackItemLines, "itemSpecId"));

        let itemSpecIds = _.uniq(_.union(_.union(_.union(replenishmentItemSpecIds, pickingItemSpecId), packingItemSpecId), putBackItemSpecId));
        let itemSpecs;
        if (!_.isEmpty(itemSpecIds)) {
            let itemSpecCriteria = {
                ids: itemSpecIds,
                customerId: customerId
            };
            let itemSpecSearch = new ItemSpecSearch(itemSpecCriteria);
            itemSpecs = await itemSpecCollection(ctx).query(itemSpecSearch.buildClause(), {
                projection: {
                    _id: 1,
                    name: 1,
                    desc: 1,
                    shortDescription: 1,
                    customerId: 1
                }
            });
        }

        let data = [];

        _.forEach(itemSpecs, function (itemSpec) {
            let replenishmentItemSpecQty = _.size(_.filter(replenishmentItemLines, {itemSpecId: itemSpec._id}));
            let pickingItemSpecQty = _.size(_.filter(pickingItemLines, {itemSpecId: itemSpec._id}));
            let packingItemSpecQty = _.size(_.filter(packingItemLines, {itemSpecId: itemSpec._id}));
            let putBackItemSpecQty = _.size(_.filter(putBackItemLines, {itemSpecId: itemSpec._id}));

            data.push({
                "Facility": app.conf.get('system.facility'),
                "Item Number": _.get(itemSpec, "name"),
                "Description": _.get(itemSpec, "desc"),
                "Transactions": replenishmentItemSpecQty + pickingItemSpecQty + packingItemSpecQty + putBackItemSpecQty
            });
        });

        data = _.sortBy(data, [function (o) {
            return -o.Transactions;
        }]);

        return {
            results: {
                data: data,
                head: [
                    "Facility",
                    "Item Number",
                    "Description",
                    "Transactions"
                ]
            }
        }
    }

    class ItemSpecSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                ids: new MongoOperator('$in', '_id'),
                customerId: new MongoOperator('$eq', 'customerId'),
            };
        }
    }

    async function getReplenishmentItemLines(createdWhenFrom, createdWhenTo) {
        let replenishmentCriteria = {
            createdWhenFrom: createdWhenFrom,
            createdWhenTo: createdWhenTo
        };
        let replenishmentSearch = new ReplenishmentSearch(replenishmentCriteria);
        let itemLines = await replenishmentStepProcess(ctx).find(replenishmentSearch.buildClause(), {
            projection: {
                _id: 1,
                itemSpecId: 1
            }
        }).toArray();
        return itemLines;
    }

    class ReplenishmentSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                createdWhenFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                createdWhenTo: new MongoOperator('$lte', 'createdWhen', 'Date')
            };
        }
    }

    async function getPickingItemLines(createdWhenFrom, createdWhenTo) {
        let pickingCriteria = {
            pickedWhenFrom: createdWhenFrom,
            pickedWhenTo: createdWhenTo
        };
        let pickingSearch = new PickingSearch(pickingCriteria);
        let pickTasks = await pickTaskCollection(ctx).find(pickingSearch.buildClause(), {
            projection: {
                _id: 1,
                pickHistories: 1
            }
        }).toArray();

        itemLines = _.flattenDeep(_.map(pickTasks, "pickHistories"));
        itemLines = _.filter(itemLines, function (item) {
            if (_.gte(new Date(momentZone(item.pickedWhen).format()), new Date(createdWhenFrom)) && _.lte(new Date(momentZone(item.pickedWhen).format()), new Date(createdWhenTo))) {
                return true;
            }
        });
        return itemLines;
    }

    class PickingSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                pickedWhenFrom: new MongoOperator('$gte', 'pickHistories.pickedWhen', 'Date'),
                pickedWhenTo: new MongoOperator('$lte', 'pickHistories.pickedWhen', 'Date')
            };
        }
    }

    async function getPackingItemLines(createdWhenFrom, createdWhenTo) {
        let packingCriteria = {
            packedWhenFrom: createdWhenFrom,
            packedWhenTo: createdWhenTo
        };
        let packingSearch = new PackingSearch(packingCriteria);
        let itemLines = await packHistoryCollection(ctx).find(packingSearch.buildClause(), {
            projection: {
                _id: 1,
                itemSpecId: 1
            }
        }).toArray();
        return itemLines;
    }

    class PackingSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                packedWhenFrom: new MongoOperator('$gte', 'packedWhen', 'Date'),
                packedWhenTo: new MongoOperator('$lte', 'packedWhen', 'Date')
            };
        }
    }

    async function getPutBackItemLines(createdWhenFrom, createdWhenTo) {
        let putBackCriteria = {
            putWhenFrom: createdWhenFrom,
            putWhenTo: createdWhenTo
        };
        let putBackSearch = new PutBackSearch(putBackCriteria);
        let itemLines = await putBackHistoryCollection(ctx).find(putBackSearch.buildClause(), {
            projection: {
                _id: 1,
                itemSpecId: 1
            }
        }).toArray();
        return itemLines;
    }

    class PutBackSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                putWhenFrom: new MongoOperator('$gte', 'putWhen', 'Date'),
                putWhenTo: new MongoOperator('$lte', 'putWhen', 'Date')
            };
        }
    }

    return {
        search, getReplenishmentItemLines, getPickingItemLines, getPackingItemLines, getPutBackItemLines
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};