let service = (app, ctx) => {
    async function aggregateSearchOrderItemLineByPaging(criteria) {
        criteria.statuses = await commonService(ctx).multiEnumToDbFormat("OrderStatus", criteria.statuses);
        let orderSearchCriteria = new OrderAggregateSearch(criteria);
        let itemlineSearchCriteria = new OrderItemLineAggregateSearch(criteria);
        let searchPipeline = [
            {$match: itemlineSearchCriteria.buildClause()},
            {
                $lookup: {
                    from: "order",
                    localField: "orderId",
                    foreignField: "_id",
                    as: "order"
                }
            },
            {$unwind: "$order"},
            {$match: orderSearchCriteria.buildClause()}
        ];
        let pagingResult = await orderItemLineCollection(ctx).aggregateByPaging(searchPipeline);
        _.each(pagingResult.results, o => {
            o.customerId = o.order.customerId;
            o.titleId = o.order.titleId;
            o.referenceNo = o.order.referenceNo;
            o.status = o.order.status;
            o.carrierId = o.order.carrierId;

        });
        return pagingResult;
    }

    async function aggregateSearchOrderItemLine(criteria) {
        criteria.statuses = await commonService(ctx).multiEnumToDbFormat("OrderStatus", criteria.statuses);
        let orderSearchCriteria = new OrderAggregateSearch(criteria);
        let itemlineSearchCriteria = new OrderItemLineAggregateSearch(criteria);
        let searchPipeline = [
            {$match: itemlineSearchCriteria.buildClause()},
            {
                $lookup: {
                    from: "order",
                    localField: "orderId",
                    foreignField: "_id",
                    as: "order"
                }
            },
            {$unwind: "$order"},
            {$match: orderSearchCriteria.buildClause()},
            {$project:{"order":0}}
        ];
        let result = await orderItemLineCollection(ctx).aggregate(searchPipeline);
        return await app.promisify(result.toArray, result)();
    }

    class OrderItemLineAggregateSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                itemSpecIds: new MongoOperator("$in", 'itemSpecId'),
                orderIds: new MongoOperator("$in", 'orderId'),
                snListNotNull: new MongoOperator("$notnull", "snList")
            }
        }
    }

    class OrderAggregateSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'order.customerId'),
                createdWhenFrom: new MongoOperator('$gte', 'order.createdWhen', 'Date'),
                createdWhenTo: new MongoOperator('$lte', 'order.createdWhen', 'Date'),
                appointmentTimeFrom: new MongoOperator('$gte', 'order.appointmentTime', 'Date'),
                appointmentTimeTo: new MongoOperator('$lte', 'order.appointmentTime', 'Date'),
                inYardTimeFrom: new MongoOperator('$gte', 'order.inYardTime', 'Date'),
                inYardTimeTo: new MongoOperator('$lte', 'order.inYardTime', 'Date'),
                statuses: new MongoOperator('$in', 'order.status'),
                keyword: new MongoOperator('$regex(multiFields)', 'order._id,order.containerNo,order.poNo,order.referenceNo'),
            };
        }
    }
    return {
        aggregateSearchOrderItemLineByPaging,
        aggregateSearchOrderItemLine
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
