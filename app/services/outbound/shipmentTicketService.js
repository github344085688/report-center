const ObjectID = require('mongodb-core').BSON.ObjectID;
let service = (app, ctx) => {

    async function searchShipmentTickets(criteria, projection = {}) {
        let search = new ShipmentTicketSearch(criteria);
        return await shipmentTicketCollection(ctx).find(search.buildClause(), {
            projection,
            sort: {createdWhen: 1}
        }).toArray();
    }

    class ShipmentTicketSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                orderIds: new MongoOperator('$in', 'orderId'),
                status: new MongoOperator('$eq', 'status'),
                shippedTimeFrom: new MongoOperator('$gte', 'updatedWhen', 'Date'),
                shippedTimeTo: new MongoOperator('$lte', 'updatedWhen', 'Date'),
            };
        }
    }


    return {
        searchShipmentTickets
    };
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};