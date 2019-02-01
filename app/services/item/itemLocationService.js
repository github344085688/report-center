const _ = require('lodash');
const ObjectID = require('mongodb-core').BSON.ObjectID;
let service = (app, ctx) => {
    async function searchByPaging(criteria) {

        let itemLocationSearch = new ItemLocationSearch(criteria);
        let pageData = await itemLocationCollection(ctx).findByPaging(itemLocationSearch.buildClause());
        let itemLocations = pageData.results;
        let locationIds = _.uniq(_.flattenDeep(_.map(itemLocations, "locationIds")));

        let [, locations] = await Promise.all([
            itemSpecService(ctx).fillItemName(itemLocations),
            _.isEmpty(locationIds) ? [] : locationCollection(ctx).find({_id: {$in: locationIds}}, {projection: {_id:1, name:1}}).toArray()
        ]);
        let locationMap = _.keyBy(locations, "_id");

        let data = [];
        _.forEach(itemLocations, itemLocation => data.push(_buildRow(itemLocation, locationMap)));

        return {
            results: {
                data: data,
                head: [
                    "name",
                    "desc",
                    "LOC"
                ]
            },
            paging: pageData.paging
        }
    }

    function _buildRow(itemLocation, locationMap) {
        let locations = [];
        _.forEach(itemLocation.locationIds, locationId => {
            let location = locationMap[locationId] || {};
            if (!_.isEmpty(location)) {
                locations.push(location.name);
            }
        });

        let row = {
            "name": itemLocation.itemSpecName || "",
            "desc": itemLocation.itemSpecDesc || itemLocation.shortDescription || "",
            "LOC": _.join(locations, " ")
        };

        return row;
    }

    class ItemLocationSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                itemSpecId: new MongoOperator('$eq', 'itemSpecId'),
                itemSpecIds: new MongoOperator('$in', 'itemSpecId'),
                itemLocationType: new MongoOperator('$eq', 'itemLocationType'),
                locationIds: new MongoOperator('$in', 'locationId')
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