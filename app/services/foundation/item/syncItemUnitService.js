const _ = require('lodash');
const ObjectID = require('mongodb-core').BSON.ObjectID;

let service = (app, ctx) => {
    async function  syncItemUnitFromMongoToMysql() {
        return await wmsApp(ctx).put("/outbound/sync/item-unit", {syncAll:true});
    }

    return {
        syncItemUnitFromMongoToMysql
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
