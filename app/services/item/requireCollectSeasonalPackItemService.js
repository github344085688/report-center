
const _ = require('lodash');
let service = (app, ctx) => {
    async function sendRequireCollectSeasonalPackItemsToOperation(criteria) {
        let items = await itemSpecCollection(ctx).find({
            requireCollectSeasonalPack: true,
            customerId: criteria.customerId
        }).toArray();
        if (_.isEmpty(items)) {
            throw new Error('No Seasonal Pack Items!');
        }
        let itemNames = _.map(items, "name");
        let emailBody = "Items:" + "<br \>";
        emailBody += itemNames.join(",");
        return {reportBody: emailBody};
    }

    return {
        sendRequireCollectSeasonalPackItemsToOperation
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};