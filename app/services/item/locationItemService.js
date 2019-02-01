const _ = require('lodash');
const ObjectID = require('mongodb-core').BSON.ObjectID;
let service = (app, ctx) => {
    async function searchByPaging(criteria) {
        let fixedLocationItems = await getFxiedLocationItems();
        criteria = await _buildCriteria(criteria, fixedLocationItems);

        let locationPagingResult = await _searchLocationByPaging(criteria);
        let locations = locationPagingResult.locations;
        if (_.isEmpty(locations)) {
            return _buildReportReturnBody([], locations, header);
        }

        let itemLocationInventories = await _getItemLocationInventory(locations, criteria.itemSpecIds);
        _fillInventoryInfoToLocation(locations, itemLocationInventories, fixedLocationItems, criteria);
        let data = await _buildResultData(locations);
        return _buildReportReturnBody(data, locationPagingResult.paging, header);
    }

    function _generateMissedLocationItemInventory(inventories, fixedLocationItems, locationId, criteria) {
        let invs = [];
        let existsItemSpecIds = _.mapUniq(inventories, "itemSpecId");
        let fixedItemSpecIds = _.mapUniq(_.filter(fixedLocationItems, f => f.locationId === locationId), "itemSpecId");
        let missedItemSpecIds = [];
        if (!_.isEmpty(criteria.itemSpecIds)) {
            missedItemSpecIds = _.difference(_.intersection(fixedItemSpecIds, criteria.itemSpecIds), existsItemSpecIds);
        } else {
            missedItemSpecIds = _.difference(fixedItemSpecIds, existsItemSpecIds);
        }
        if (!_.isEmpty(missedItemSpecIds)) {
            let fixedRecords = _.filter(fixedLocationItems, f => _.includes(missedItemSpecIds, f.itemSpecId) && f.locationId === locationId);
            _.each(fixedRecords, f => {
                invs.push({
                    "itemSpecId": f.itemSpecId,
                    "locationId": locationId,
                    "unitId": null,
                    "qty": 0,
                    "isFixed": f.isFixed,
                    "locationItemId": f._id.toString()
                })
            })
        }
        return invs;
    }

    function _fillFixedFlag(fixedLocationItems, locationId, inventories) {
        _.each(inventories, i => {
            let fixedRecords = _.filter(fixedLocationItems, f => f.itemSpecId === i.itemSpecId && f.locationId === locationId);
            if (_.isEmpty(fixedRecords)) {
                i.isFixed = false;
            } else {
                i.isFixed = true;
                i.locationItemId = fixedRecords[0]._id.toString();
            }
        });
        return inventories;
    }

    function _processLocationInventoryInfo(locationInventoryGroup, locationId, fixedLocationItems, criteria) {
        let inventories = [];
        let invs = locationInventoryGroup[locationId];
        let missedLocationItems = _generateMissedLocationItemInventory(invs, fixedLocationItems, locationId, criteria);
        if (_.isEmpty(invs)) {
            inventories = missedLocationItems;

        } else {
            invs = _.union(invs, missedLocationItems);
            inventories = _fillFixedFlag(fixedLocationItems, locationId, invs);
        }
        if (criteria.searchScenario === "FIXED_LOCATION_ONLY" || criteria.onlyShowFixed === true) {
            inventories = _.filter(inventories, i => i.isFixed === true)
        }
        return inventories;
    }

    function _fillInventoryInfoToLocation(locations, itemLocationInventories, fixedLocationItems, criteria) {
        let locationInventoryGroup = _.groupBy(itemLocationInventories, "locationId");
        _.each(locations, o => {
            o.inventories = _processLocationInventoryInfo(locationInventoryGroup, o.id, fixedLocationItems, criteria);
        });
    }

    async function _buildCriteria(criteria, fixedLocationItems) {
        // build criteria for keyword search
        if (!_.isEmpty(criteria.keyword)) {
            await _buildCriteriaForKeywordSearch(criteria, fixedLocationItems);
            return criteria;
        }

        if (_.isEmpty(criteria.keyword) && criteria.onlyShowFixed === true) {
            criteria.searchScenario = "FIXED_LOCATION_ONLY";
        }

        if (_.isEmpty(criteria.keyword) && criteria.onlyShowFixed === false) {
            criteria.searchScenario = "SHOW_ALL_LOCATIONS";
        }

        //build criteria for location search
        let fixedLocationIds = _.mapUniq(fixedLocationItems, "locationId");
        let fixedItemSpecIds = _.mapUniq(fixedLocationItems, "itemSpecId");

        if (_.isEmpty(criteria.tenantId) && _.isEmpty(criteria.locationGroupId) && _.isEmpty(criteria.searchScenario) && _.isEmpty(criteria.onlyShowFixed)) {
            criteria.searchScenario = "FIXED_LOCATION_ONLY";
        }
        if (criteria.searchScenario) {
            switch (criteria.searchScenario) {
                case "SHOW_ALL_LOCATIONS":
                    break;
                case "AVAILABLE_LOCATION_ONLY":
                    criteria.excludeLocationIds = fixedLocationIds;
                    break;
                case "FIXED_LOCATION_ONLY":
                    criteria.locationIds = fixedLocationIds ? fixedLocationIds : ["-1"];
                    criteria.itemSpecIds = fixedItemSpecIds ? fixedItemSpecIds : ["-1"];
                    break;
                default:
                    throw new Error("search scenario not supported!");
            }
        }
        return criteria;
    }

    async function _buildCriteriaForKeywordSearch(criteria, fixedLocationItems) {
        let itemSpecIds = await _getItemSpecId(criteria.keyword);
        if (_.isEmpty(itemSpecIds)) {
            criteria.locationIds = ["-1"];
            return criteria;
        }

        criteria.itemSpecIds = itemSpecIds;
        let fixedIds = _getMatchedItemLocationIds(fixedLocationItems, itemSpecIds);
        if (criteria.onlyShowFixed === true) {
            criteria.locationIds = fixedIds;
            return criteria;
        }
        let locationIds = await _searchInventoryLocationByItem(itemSpecIds);
        criteria.locationIds = _.compact(_.union(fixedIds, locationIds));

        return criteria;
    }

    function _getMatchedItemLocationIds(fixedLocationItems, itemSpecIds) {
        return _.mapUniq(fixedLocationItems, function (o) {
            if (_.includes(itemSpecIds, o.itemSpecId)) {
                return o.locationId;
            }
        });
    }

    async function getFxiedLocationItems() {
        return await locationItemCollection(ctx).find({isFixed: true}).toArray();
    }

    async function _getItemSpecId(keyword) {
        if (_.isEmpty(keyword)) return [];
        let itemSpecs = await itemSpecService(ctx).itemSearch({keyword: keyword});
        let itemAkas = await itemAkaCollection(ctx).find({"value": keyword}).toArray();
        return _.union(_.mapUniq(itemSpecs, "_id"), _.mapUniq(itemAkas, "itemSpecId"));
    }

    async function _searchInventoryLocationByItem(itemSpecIds) {
        let result = await wmsMysql(ctx).query(`SELECT DISTINCT lp.locationId FROM inventory LEFT JOIN lp ON inventory.lpId=lp.id WHERE inventory.status NOT IN ("SHIPPED") AND inventory.itemSpecId IN ('${_.join(itemSpecIds, '\',\'')}') `);
        if (result) {
            return _.mapUniq(result, "locationId");
        }
        return [];
    }

    async function _getItemLocationInventory(locations, itemSpecIds) {
        if (_.isEmpty(locations)) return [];
        let locationMap = _.keyBy(locations, "id");

        //get lpIds
        let locationIds = _.mapUniq(locations, "id");
        let lpIdLocations = await wmsMysql(ctx).query(`SELECT id, locationId FROM lp WHERE locationId IN ('${_.join(locationIds, "','")}') `);
        if (_.isEmpty(lpIdLocations)) return [];
        let lpLocationMap = _.keyBy(lpIdLocations, "id");
        let lpIds = _.mapUniq(lpIdLocations, "id");

        //get inventory by lpIds
        let inventories = await inventoryService(ctx).searchInventory({
            itemSpecIds: itemSpecIds,
            lpIds: lpIds,
            excludeStatuses: ['SHIPPED']
        });
        if (_.isEmpty(inventories)) return [];

        //fill location name
        _.each(inventories, i => {
            if (lpLocationMap[i.lpId] && locationMap[lpLocationMap[i.lpId].locationId]) {
                i.locationId = lpLocationMap[i.lpId].locationId;
            }
        });
        return inventories;
    }

    async function _buildResultData(locationInventories) {
        let data = [];
        await Promise.all([
            _fillItemInfo(locationInventories),
            _fillUnitInfo(locationInventories)
        ]);
        _.each(locationInventories, o => {
            if (_.isEmpty(o.inventories)) {
                data.push({
                    "locationId": o.id,
                    "itemSpecId": null,
                    "Location": o.name,
                    "Type": commonService(ctx).ensureNotNull(o.supportPickType),
                    "Item#": "",
                    "Item Description": "",
                    "Location Qty": 0,
                    "UOM": "",
                    "isFixed": commonService(ctx).convertToYN(false),
                    "id": null
                })
            } else {
                let invGroup = _.groupBy(o.inventories, i => i.itemName + "|" + i.unitName);
                _.each(invGroup, (inventories, key) => {
                    data.push({
                        "locationId": o.id,
                        "itemSpecId": inventories[0].itemSpecId,
                        "Location": o.name,
                        "Type": commonService(ctx).ensureNotNull(o.supportPickType),
                        "Item#": commonService(ctx).ensureNotNull(inventories[0].itemName),
                        "Item Description": commonService(ctx).ensureNotNull(inventories[0].itemDesc),
                        "Location Qty": _.sumBy(inventories, "qty"),
                        "UOM": commonService(ctx).ensureNotNull(inventories[0].unitName),
                        "isFixed": commonService(ctx).convertToYN(inventories[0].isFixed),
                        "id": inventories[0].locationItemId
                    })
                })
            }

        });
        return data;
    }

    async function _fillItemInfo(locationInventories) {
        let inventories = _.flatten(_.map(locationInventories, "inventories"));
        let itemSpecIds = _.mapUniq(inventories, "itemSpecId");
        if (_.isEmpty(itemSpecIds)) {
            return;
        }
        let itemSpecs = await itemSpecCollection(ctx).find({_id: {$in: itemSpecIds}}).toArray();
        if (_.isEmpty(itemSpecs)) {
            return;
        }
        let itemMap = _.keyBy(itemSpecs, "_id");
        _.each(inventories, o => {
            if (itemMap[o.itemSpecId]) {
                o.itemName = itemMap[o.itemSpecId].name;
                o.itemDesc = itemMap[o.itemSpecId].desc;
            }
        })
    }

    async function _fillUnitInfo(locationInventories) {
        let inventories = _.flatten(_.map(locationInventories, "inventories"));
        let unitIds = _.map(_.mapUniq(inventories, "unitId"), o => new ObjectID(o));
        if (_.isEmpty(unitIds)) {
            return;
        }

        let itemUnits = await itemUnitCollection(ctx).find({_id: {$in: unitIds}}).toArray();
        if (_.isEmpty(itemUnits)) {
            return;
        }
        let unitMap = _.keyBy(itemUnits, "_id");
        _.each(inventories, o => {
            if (unitMap[o.unitId]) {
                o.unitName = unitMap[o.unitId].name;
            }
        })
    }

    async function _searchLocationByPaging(criteria) {
        criteria.excludeStatuses = ["DISABLED", "DELETE"];
        return await baseApp(ctx).post('/location/search-by-paging', criteria);
    }

    function _buildReportReturnBody(data, paging, header) {
        return {
            results: {
                data: _.groupBy(data, "Location"),
                head: header
            },
            paging: paging
        }
    }

    async function searchByPagingForReport(criteria) {
        let pagingResult = await searchByPaging(criteria);
        let data = _.flatten(_.values(pagingResult.results.data));
        _.each(data, o => {
            let keys = Object.keys(o);
            _.each(keys, k => {
                if (!_.includes(header, k)) {
                    delete o[k]
                }
            })
        });
        pagingResult.results.data = data;
        return pagingResult;
    }

    let header = [
        "Location",
        "Type",
        "Item#",
        "Item Description",
        "Location Qty",
        "UOM",
        "isFixed"
    ];

    return {
        searchByPaging,
        searchByPagingForReport
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};