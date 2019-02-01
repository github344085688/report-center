const _ = require('lodash');
let service = (app, ctx) => {

    async function searchByPaging(criteria) {
        let head = [
            "Item",
            "Short Description",
            "LP",
            "Status",
            "Customer",
            "Error Type"
        ];

        let defaultCustomerId = "ORG-3";//BEVMOR0001
        let customerId = criteria.customerId ? criteria.customerId : defaultCustomerId;
        criteria.customerId = customerId;


        let coldInventoryIds = await findColdItemInDryInventoryIds(criteria);
        let casePickInPiecePickInventoryIds = await findCasePickItemInPiecePickInventoryIds(criteria);
        let inventoryIds = _.union(coldInventoryIds, casePickInPiecePickInventoryIds);

        if (_.isEmpty(inventoryIds)) {
            inventoryIds = [-1];
        }

        let inventoryData = await getInventoryByIds(inventoryIds);
        let itemSpecIds = _.uniq(_.map(inventoryData.results, "itemSpecId"));
        let itemMap = await itemSpecService(ctx).getItemSpecMap(itemSpecIds);
        let customerIds = _.uniq(_.map(inventoryData.results, "customerId"));
        let customerMap = await organizationService(ctx).getOrganizationMap(customerIds);

        let data = [];
        _.forEach(inventoryData.results, function (inventory) {
            data.push({
                "Item": itemMap[inventory.itemSpecId].name,
                "Short Description": itemMap[inventory.itemSpecId].shortDescription,
                "LP": inventory.lpId,
                "Status": inventory.status,
                "Customer": organizationService(ctx).getOrganizationNameById(inventory.customerId, customerMap),
                "Error Type": getErrorType(inventory.id, coldInventoryIds, casePickInPiecePickInventoryIds)
            })
        })

        inventoryData.results = {
            data: data,
            head: head
        }

        return inventoryData;

    };

    async function getInventoryByIds(inventoryIds) {
        let inventoryData = await wmsMysql(ctx).queryByPaging(`SELECT DISTINCT t2.locationId,t1.*
                                FROM inventory t1, lp t2
                                WHERE t1.lpId = t2.id
                                    AND t1.id in(${inventoryIds.join(',')})
                                `);
        return inventoryData;
    }

    function getErrorType(inventoryId, coldInventoryIds, casePickInPiecePickInventoryIds) {
        if (_.includes(coldInventoryIds, inventoryId)) {
            return "COLD_ITEM_IN_DRY";
        }
        if (_.includes(casePickInPiecePickInventoryIds, inventoryId)) {
            return "CASE_PICK_IN_PIECE_PICK";
        }
        return "";

    }

    async function getColdLocationGroupIds() {
        let coldLocationGroups = await locationGroupCollection(ctx).find({locationGroupType: "COLD"}).toArray();
        let coldLocationGroupIds = _.uniq(_.map(coldLocationGroups, "_id")).map(s => _.toString(s));
        return coldLocationGroupIds;
    }

    async function getDryLocationGroupIds() {
        let dryLocationGroups = await locationGroupCollection(ctx).find({locationGroupType: "DRY"}).toArray();
        let dryLocationGroupIds = _.uniq(_.map(dryLocationGroups, "_id")).map(s => _.toString(s));
        return dryLocationGroupIds;
    }

    async function getColdItemGroupIds(criteria, coldLocationGroupIds) {
        criteria.locationGroupIds = coldLocationGroupIds
        let itemGroupSearch = new ItemGroupSearch(criteria);
        let criteriaClause = itemGroupSearch.buildClause();

        let itemGroups = await itemGroupCollection(ctx).find(criteriaClause).toArray();
        let itemGroupIds = _.uniq(_.map(itemGroups, "_id"));
        return itemGroupIds;
    }

    async function getColdItemSpecIds(coldItemGroupIds) {
        let items = await itemSpecCollection(ctx).find({groupId: {$in: coldItemGroupIds}}).toArray();
        let itemSpecIds = _.map(items, "_id");

        if (_.isEmpty(itemSpecIds)) {
            itemSpecIds = ["-1"];
        }
        return itemSpecIds;
    }

    async function getDryLocationIds(dryLocationGroupIds) {
        let dryLocations = await locationCollection(ctx).find({
            locationGroupId: {$in: dryLocationGroupIds},
            status: "USEABLE"
        }).toArray();
        return _.map(dryLocations, "_id");
    }

    async function getColdInDryInventoryLocations(coldItemSpecIds, dryLocationIds, customerId) {
        let inventoryLocations = await wmsMysql(ctx).query(`SELECT DISTINCT t2.locationId,t1.*
                                FROM inventory t1, lp t2
                                WHERE t2.locationId IS NOT NULL
                                    AND t2.locationId != ''
                                    AND t1.lpId = t2.id
                                    AND t1.itemSpecId in('${_.join(coldItemSpecIds, '\',\'')}')
                                    AND t2.locationId in('${_.join(dryLocationIds, '\',\'')}')
                                    AND t1.customerId = '${customerId}'
                                    AND t1.qty >0
                                    AND t1.status = 'AVAILABLE'`);
        return inventoryLocations;
    }

    async function findColdItemInDryInventoryIds(criteria) {
        let coldLocationGroupIds = await getColdLocationGroupIds();
        let dryLocationGroupIds = await getDryLocationGroupIds();

        let coldItemGroupIds = await getColdItemGroupIds(criteria, coldLocationGroupIds);
        let coldItemSpecIds = await getColdItemSpecIds(coldItemGroupIds);
        let dryLocationIds = await getDryLocationIds(dryLocationGroupIds);
        let coldItemInventoryInDrys = await getColdInDryInventoryLocations(coldItemSpecIds, dryLocationIds, criteria.customerId);
        let inventoryIds = _.map(coldItemInventoryInDrys, "id");

        return inventoryIds;


    }

    async function getCasePickItemIds() {
        let casePickItems = await itemLocationCollection(ctx).find({itemLocationType: "CASE_PICK"}).toArray();
        let itemSpecIds = _.map(casePickItems, "itemSpecId");
        if (_.isEmpty(itemSpecIds)) {
            itemSpecIds = ["-1"];
        }
        return itemSpecIds;
    }

    async function getPiecePickLocationIds() {
        let piecePickLocations = await locationCollection(ctx).find({
            supportPickType: "PIECE_PICK",
            status: "USEABLE"
        }).toArray();

        let locationIds = _.map(piecePickLocations, "_id");
        if (_.isEmpty(locationIds)) {
            locationIds = ["-1"];
        }
        return locationIds;
    }

    async function getInventoryIdsOfCasePickItemInPieceLocation(casePickItemSpecIds, locationIds, customerId) {
        let inventoryLocations = await wmsMysql(ctx).query(`SELECT DISTINCT t2.locationId,t1.*
                                FROM inventory t1, lp t2
                                WHERE t2.locationId IS NOT NULL
                                    AND t2.locationId != ''
                                    AND t1.lpId = t2.id
                                    AND t1.itemSpecId in('${_.join(casePickItemSpecIds, '\',\'')}')
                                    AND t2.locationId in('${_.join(locationIds, '\',\'')}')
                                    AND t1.customerId = '${customerId}'
                                    AND t1.qty > 0
                                    AND t1.status = 'AVAILABLE'`);

        let inventoryIds = _.map(inventoryLocations, "id");
        return inventoryIds;
    }

    async function findCasePickItemInPiecePickInventoryIds(criteria) {
        let casePickItemSpecIds = await getCasePickItemIds();
        let piecePickLocationIds = await getPiecePickLocationIds();
        let inventoryIds = await getInventoryIdsOfCasePickItemInPieceLocation(casePickItemSpecIds, piecePickLocationIds, criteria.customerId);

        return inventoryIds;

    }


    class ItemGroupSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'customerId'),
                name: new MongoOperator('$regex', 'name'),
                locationGroupIds: new MongoOperator('$in', 'locationGroupId')
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