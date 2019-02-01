const _ = require('lodash');

let service = (app, ctx) => {
    async function getLocationMap(locationIds) {
        if (_.isEmpty(locationIds)) return {};

        let locations = await locationCollection(ctx).find({_id: {$in: _.uniq(locationIds)}}).toArray();
        return _.keyBy(locations, "_id");
    }

    async function getEmptyLocations  (searchParam) {
        let inventoryLocations = await wmsMysql.query(`select distinct i.itemSpecId, i.lpId, l.locationId from inventory i, lp l where i.lpId=l.id and i.status<>'SHIPPED' and i.customerId='${searchParam.customerId}'`);
        let inventoryLocationMap = _.groupBy(inventoryLocations, "locationId");

        let rackLocations = await locationCollection(ctx).find({
            name: {$regex: "^[A-Z]*[0-9]*[A-Z]$"},
            subType: "THREE_D_GRID"
        }, {projection:{_id: 1, name: 1, subType: 1}}).toArray();
        let emptyRackLocations = [];
        for (let location of rackLocations) {
            if (!inventoryLocationMap[location._id]) {
                emptyRackLocations.push(location);
            }
        }

        return emptyRackLocations;
    }

    async function getMultipleItemLocations (searchParam)  {
        let inventoryLocations = await wmsMysql.query(`select distinct i.itemSpecId, i.lpId, l.locationId from inventory i, lp l where i.lpId=l.id and i.status<>'SHIPPED' and i.customerId='${searchParam.customerId}'`);
        let inventoryLocationMap = _.groupBy(inventoryLocations, "locationId");
        let itemSpecIds = _.uniq(_.map(inventoryLocations, "itemSpecId"));

        let multipleItemLocationIds = [];
        _.forIn(inventoryLocationMap, (value, key) => {
            if (value.length > 1) {
                multipleItemLocationIds.push(key);
            }
        });

        let results = [];
        if (multipleItemLocationIds.length > 0) {
            let items = await itemCollection(ctx).find({_id: {$in: itemSpecIds}}, {projection:{_id: 1, name: 1}}).toArray();
            let itemMap = _.keyBy(items, "_id");

            let locationParam = {
                _id: {$in: _.uniq(multipleItemLocationIds)},
            };
            if (searchParam.tenantId) {
                locationParam.tenantId = searchParam.tenantId;
            }
            let multipleItemLocations = await locationCollection(ctx).find(locationParam, {
                _id: 1,
                name: 1,
                subType: 1
            }).toArray();

            for (let location of multipleItemLocations) {
                let inventories = inventoryLocationMap[location._id];
                for (let inventory of inventories) {
                    let row = {};
                    row.locationName = location.name;
                    row.lpId = inventory.lpId;
                    row.itemName = itemMap[inventory.itemSpecId].name;
                    row.locationType = location.type;
                    results.push(row);
                }
            }
        }

        return results;
    }

    function getLocationArea(location) {
        if (!location) return 0;

        let square = 0;
        if (location.width !== null) {
            square = location.width;
        }
        if (location.length !== null) {
            square = square * location.length;
        }

        let M_CONVERT_TO_CFT = 10.76391;
        return square * M_CONVERT_TO_CFT;
    }

    return {
        getLocationMap,
        getEmptyLocations,
        getMultipleItemLocations,
        getLocationArea
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};