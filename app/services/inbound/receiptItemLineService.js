let service = (app, ctx) => {
    /*
     aggregate search receipt itemline and receipt
     */
    async function aggregateSearchReceiptItemLineByPaging(criteria) {
        criteria.statuses = await commonService(ctx).multiEnumToDbFormat("ReceiptStatus", criteria.statuses);
        let receiptSearchCriteria = new ReceiptAggregateSearch(criteria);
        let itemlineSearchCriteria = new ReceiptItemLineAggregateSearch(criteria);
        let searchPipeline = [
            {$match: itemlineSearchCriteria.buildClause()},
            {
                $lookup: {
                    from: "receipt",
                    localField: "receiptId",
                    foreignField: "_id",
                    as: "receipt"
                }
            },
            {$unwind: "$receipt"},
            {$match: receiptSearchCriteria.buildClause()}
        ];
        let pagingResult = await receiptItemLineCollection(ctx).aggregateByPaging(searchPipeline);
        _.each(pagingResult.results, o => {
            o.customerId = o.receipt.customerId;
            o.titleId = o.receipt.titleId;
            o.referenceNo = o.receipt.referenceNo;
            o.status = o.receipt.status;
            o.carrierId = o.receipt.carrierId;

        });
        return pagingResult;
    }

    async function aggregateSearchReceiptItemLine(criteria) {
        let receiptItemLineSearch = new ReceiptItemLineSearch(criteria);
        let clause = receiptItemLineSearch.buildClause();
        if (_.isEmpty(clause)) return;

        let searchPipeline = [
            {$match: clause},
            {
                $lookup: {
                    from: "receipt",
                    localField: "receiptId",
                    foreignField: "_id",
                    as: "receipt"
                }
            },
            {$unwind: "$receipt"}
        ];
        let raw = await receiptItemLineCollection(ctx).aggregate(searchPipeline);
        let results = await app.promisify(raw.toArray, raw)();
        _.each(results, o => {
            o.customerId = o.receipt.customerId;
        });
        return results;
    }

    async function receiptItemLineSearch(criteria) {
        let search = new ReceiptItemLineSearch(criteria);
        let clause = search.buildClause();
        if (_.isEmpty(clause)) {
            throw new Error("Not support empty search for receipt itemline!");
        } else {
            return await receiptItemLineCollection(ctx).find(clause).toArray();
        }
    }

    class ReceiptItemLineAggregateSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                itemSpecIds: new MongoOperator("$in", 'itemSpecId'),
                receiptIds: new MongoOperator("$in", 'receiptId')
            }
        }
    }

    class ReceiptAggregateSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'receipt.customerId'),
                createdWhenFrom: new MongoOperator('$gte', 'receipt.createdWhen', 'Date'),
                createdWhenTo: new MongoOperator('$lte', 'receipt.createdWhen', 'Date'),
                appointmentTimeFrom: new MongoOperator('$gte', 'receipt.appointmentTime', 'Date'),
                appointmentTimeTo: new MongoOperator('$lte', 'receipt.appointmentTime', 'Date'),
                inYardTimeFrom: new MongoOperator('$gte', 'receipt.inYardTime', 'Date'),
                inYardTimeTo: new MongoOperator('$lte', 'receipt.inYardTime', 'Date'),
                closeTimeFrom: new MongoOperator('$gte', 'receipt.closeTime', 'Date'),
                closeTimeTo: new MongoOperator('$lte', 'receipt.closeTime', 'Date'),
                statuses: new MongoOperator('$in', 'receipt.status'),
                keyword: new MongoOperator('$regex(multiFields)', 'receipt._id,receipt.containerNo,receipt.poNo,receipt.referenceNo'),
            };
        }
    }

    class ReceiptItemLineSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                itemSpecId: new MongoOperator('$eq', 'itemSpecId'),
                itemSpecIds: new MongoOperator('$in', 'itemSpecId'),
                unitId: new MongoOperator('$eq', 'unitId'),
                unitIds: new MongoOperator('$in', 'unitId'),
                supplierId: new MongoOperator('$eq', 'supplierId'),
                receiptId: new MongoOperator('$eq', 'receiptId'),
                receiptIds: new MongoOperator('$in', 'receiptId'),
                lotNos: new MongoOperator('$in', 'lotNo'),
                snDetailsNotNull: new MongoOperator("$notnull", "snDetails")
            };
        }
    }

    return {
        aggregateSearchReceiptItemLineByPaging,
        ReceiptItemLineSearch: ReceiptItemLineSearch,
        aggregateSearchReceiptItemLine,
        receiptItemLineSearch
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};