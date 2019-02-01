const _ = require('lodash');
let service = (app, ctx) => {
    async function queryLocationWithMultipleItems(customerId) {
        let locationItemsData = await wmsMysql(ctx).queryByPaging(`SELECT b.*, SUM(b.qty) AS totalQty
                                FROM (
                                    SELECT t2.locationId, t1.*
                                    FROM inventory t1, lp t2
                                    WHERE t1.lpId = t2.id
                                        AND t1.status = 'AVAILABLE'
                                        AND t1.qty > 0
                                        AND t1.customerId = '${customerId}'
                                        AND t2.locationId IN (
                                            SELECT a.locationId
                                            FROM (
                                                SELECT COUNT(DISTINCT t1.itemSpecId) AS count, t2.locationId
                                                FROM inventory t1, lp t2
                                                WHERE t1.lpId = t2.id
                                                    AND t1.status = 'AVAILABLE'
                                                    AND t1.qty > 0
                                                    AND t1.customerId = '${customerId}'
                                                GROUP BY t2.locationId
                                                HAVING count > 1
                                            ) a
                                        )
                                ) b
                                GROUP BY b.locationId, b.itemSpecId, b.unitId, b.lpId
                        `);

        let itemSpecIds = _.uniq(_.map(locationItemsData.results, "itemSpecId"));
        return {locationItemsData, itemSpecIds};
    }

    async function getLocationMap(locationItems) {
        let locationIds = _.uniq(_.map(locationItems, "locationId"));
        let locations = await locationCollection(ctx).find({_id: {$in: locationIds}}).toArray();
        let locationMap = _.keyBy(locations, "_id");
        return locationMap;
    }

    async function searchByPaging(criteria) {
        let head = [
            "Location",
            "Item",
            "QTY",
            "Unit",
            "LP"
        ];
        let shortHead = head;
        let defaultCustomerId = "ORG-3"; //BEVMOR0001
        let customerId = criteria.customerId ? criteria.customerId : defaultCustomerId;
        let {locationItemsData, itemSpecIds} = await queryLocationWithMultipleItems(customerId);


        let items = await itemSpecCollection(ctx).find({_id: {$in: itemSpecIds}, customerId: customerId}).toArray();
        let itemMap = _.keyBy(items, "_id");

        let itemUnits = await itemUnitCollection(ctx).find({"itemSpecId": {$in: itemSpecIds}}).toArray();
        let unitMap = _.keyBy(itemUnits, "_id");
        let locationMap = await getLocationMap(locationItemsData.results);


        let data = [];
        let locationGroup = [];
        _.forEach(locationItemsData.results, function (location) {
            let itemSpecId = location.itemSpecId;
            let locationId = checkLocationExist(location.locationId, locationGroup) ? "" : location.locationId;
            data.push({
                "Location": locationMap[locationId] ? locationMap[locationId].name : "",
                "Item": itemMap[itemSpecId] ? itemMap[itemSpecId].name : "",
                "QTY": location.totalQty,
                "Unit": unitMap[location.unitId] ? unitMap[location.unitId].name : "",
                "LP": location.lpId

            })
            locationGroup.push(location);

        })
        locationItemsData.results = {
            data: data,
            head: head,
            shortHead: shortHead
        }
        return locationItemsData;

    };


    function checkLocationExist(locationId, locationGroup) {
        if (!_.isEmpty(locationGroup)) {
            for (let location of locationGroup) {
                if (location.locationId == locationId) {
                    return true;
                }
            }
        }
        return false;
    }

    return {
        searchByPaging
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};