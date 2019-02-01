const _ = require('lodash');

let service = (app, ctx) => {

    async function getReceiptMap(receiptIds) {
        return await app.util.getMapFromCache(ctx.cached.receiptMap, receiptIds, _getReceiptMap);
    }

    async function _getReceiptMap(receiptIds) {
        if (_.isEmpty(receiptIds)) return {};
        let receipts = await receiptCollection(ctx).find({_id: {$in: receiptIds}}).toArray();
        for (let receipt of receipts) {
            receipt.status = await commonService(ctx).enumToWebFormat("ReceiptStatus", receipt.status);
        }
        return _.keyBy(receipts, "_id");
    }

    async function getReceipts(customerId, receiptTypes, timeFrom, timeTo) {
        let receiptSearch = new ReceiptSearch({
            customerId: customerId,
            receiptTypes: receiptTypes,
            timeFrom: timeFrom,
            timeTo: timeTo
        });
        let option = receiptSearch.buildClause();
        let receipts = await receiptCollection(ctx).query(option, {projection: tabelFieldMap.receiptFields});
        return receipts;
    }

    async function getReceiptItemLines(receiptIds, itemSpecIds) {
        if ((!receiptIds || receiptIds.length === 0) && (!itemSpecIds || itemSpecIds.length === 0)) return;

        let receiptItemLines = [];
        let receiptIdGroups = _.chunk(receiptIds, 500);
        for (let idGroup of receiptIdGroups) {
            let param = {receiptId: {$in: idGroup}};
            if (itemSpecIds && itemSpecIds.length > 0) {
                param.itemSpecId = {$in: itemSpecIds};
            }
            let itemLines = await receiptItemLineCollection(ctx).find(param).toArray();
            receiptItemLines = _.union(receiptItemLines, itemLines);
        }
        return receiptItemLines;
    }

    async function getInboundData(customerId, itemSpecIds, receiptTypes, timeFrom, timeTo) {
        let receipts = await getReceipts(customerId, receiptTypes, timeFrom, timeTo);
        let receiptIds = _.map(receipts, "_id");
        let [receiptItemLines, unitMap] = await Promise.all([
            getReceiptItemLines(receiptIds, itemSpecIds),
            itemUnitService(ctx).getUnitMap(null, customerId, itemSpecIds)
        ]);

        let data = [];
        _.forEach(receiptItemLines, line => {
            let uom = unitMap[line.receivedUnitId];
            data.push({
                receiptId: line.receiptId,
                eaQty: line.receivedQty ? (uom ? line.receivedQty * uom.baseQty : line.receivedQty) : 0,
                lotNo: line.lotNo,
                itemSpecId: line.itemSpecId
            });
        });
        return data;
    }

    async function aggregateSearchReceiptByPaging(criteria) {
        criteria.statuses = await commonService(ctx).multiEnumToDbFormat("ReceiptStatus", criteria.statuses);
        let receiptSearchCriteria = new ReceiptSearch(criteria);
        let receiptItemLineSearchCriteria = new ReceiptItemLineAggregateSearch(criteria);

        let searchPipeline = [
            {$match: receiptSearchCriteria.buildClause()},
            {
                $lookup: {
                    from: "receipt_itemline",
                    localField: "_id",
                    foreignField: "receiptId",
                    as: "receiptItemLines"
                }
            },
            {$match: receiptItemLineSearchCriteria.buildClause()},
            {$project: {"receiptItemLines": 0}}
        ];
        return await receiptCollection(ctx).aggregateByPaging(searchPipeline);
    }

    async function aggregateSearchScheduleSummaryByPaging(criteria) {
        criteria.appointmentTimeNotNull = true;
        let receiptSearchCriteria = new ReceiptSearch(criteria);

        let searchPipeline = [
            {$match: receiptSearchCriteria.buildClause()},
            {
                $lookup: {
                    from: "receipt_itemline",
                    localField: "_id",
                    foreignField: "receiptId",
                    as: "receiptItemLine"
                }
            },
            {$unwind: "$receiptItemLine"},
            {
                $group: {
                    _id: {
                        customerId: "$customerId",
                        titleId: "$titleId",
                        itemSpecId: "$receiptItemLine.itemSpecId",
                        unitId: "$receiptItemLine.unitId",
                        appointmentDate: {$dateToString: {format: "%Y-%m-%d", date: "$appointmentTime"}}
                    },
                    receiptIds: {$push: "$_id"}
                }
            }
        ];
        return await receiptCollection(ctx).aggregateByPaging(searchPipeline);
    }

    async function aggregateSearchReceivingSummaryByPaging(criteria) {
        criteria.devannedTimeNotNull = true;
        let receiptSearchCriteria = new ReceiptSearch(criteria);

        let searchPipeline = [
            {$match: receiptSearchCriteria.buildClause()},
            {
                $lookup: {
                    from: "receipt_itemline",
                    localField: "_id",
                    foreignField: "receiptId",
                    as: "receiptItemLine"
                }
            },
            {$unwind: "$receiptItemLine"},
            {
                $group: {
                    _id: {
                        customerId: "$customerId",
                        titleId: "$titleId",
                        itemSpecId: "$receiptItemLine.itemSpecId",
                        unitId: "$receiptItemLine.unitId",
                        receivedDate: {$dateToString: {format: "%Y-%m-%d", date: "$devannedTime"}}
                    },
                    receiptIds: {$push: "$_id"}
                }
            }
        ];
        return await receiptCollection(ctx).aggregateByPaging(searchPipeline);
    }

    class ReceiptItemLineAggregateSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                itemSpecIds: new MongoOperator('$in', 'receiptItemLines.itemSpecId')
            }
        }
    }

    class ReceiptSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                receiptIds: new MongoOperator('$in', '_id'),
                customerId: new MongoOperator('$eq', 'customerId'),
                receiptTypes: new MongoOperator('$in', 'receiptType'),
                timeFrom: new MongoOperator('$gte', 'devannedTime', 'Date'),
                timeTo: new MongoOperator('$lte', 'devannedTime', 'Date'),
                createdWhenFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                createdWhenTo: new MongoOperator('$lte', 'createdWhen', 'Date'),
                updatedWhenFrom: new MongoOperator('$gte', 'updatedWhen', 'Date'),
                updatedWhenTo: new MongoOperator('$lte', 'updatedWhen', 'Date'),
                appointmentTimeFrom: new MongoOperator('$gte', 'appointmentTime', 'Date'),
                appointmentTimeTo: new MongoOperator('$lte', 'appointmentTime', 'Date'),
                appointmentTimeNotNull: new MongoOperator('$notnull', 'appointmentTime'),
                devannedTimeNotNull: new MongoOperator('$notnull', 'devannedTime'),
                inYardTimeFrom: new MongoOperator('$gte', 'inYardTime', 'Date'),
                inYardTimeTo: new MongoOperator('$lte', 'inYardTime', 'Date'),
                closeTimeFrom: new MongoOperator('$gte', 'closeTime', 'Date'),
                closeTimeTo: new MongoOperator('$lte', 'closeTime', 'Date'),
                statuses: new MongoOperator('$in', 'status'),
                keyword: new MongoOperator('$regex(multiFields)', '_id,containerNo,poNo,referenceNo')
            };
        }
    }

    return {
        getReceiptItemLines,
        getReceipts,
        getInboundData,
        getReceiptMap,
        aggregateSearchReceiptByPaging,
        aggregateSearchScheduleSummaryByPaging,
        aggregateSearchReceivingSummaryByPaging
    };
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};