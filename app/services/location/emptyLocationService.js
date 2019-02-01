const _ = require('lodash');
let service = (app, ctx) => {
    async function searchByPaging(criteria) {
        let head = [
            "LocationId",
            "LocationName",
            "Type",
            "Status",
            "Customer"
        ];

        let alwaysEmptyLocationIds = await findAlwaysEmptyLocationIds();
        let currentNotEmptyLocationIds = await findCurrentNotEmptyLocationIds();
        let notEmptyLocationIds = _.union(alwaysEmptyLocationIds, currentNotEmptyLocationIds);
        criteria.excludeLocationIds = notEmptyLocationIds;
        let locationSearch = new LocationSearch(criteria);
        let criteriaClause = locationSearch.buildClause();
        let emptyLocations = await locationCollection(ctx).findByPaging(criteriaClause);
        let tenantIds = _.uniq(_.map(emptyLocations.results, "tenantId"));
        let organizationMap = await  organizationService(ctx).getOrganizationMap(tenantIds);

        let data = [];
        _.forEach(emptyLocations.results, function (location) {
            data.push({
                "LocationId": location._id,
                "LocationName": location.name,
                "Type": location.type,
                "Status": location.status,
                "Customer": organizationMap[location.tenantId] ? organizationMap[location.tenantId].name : ""
            })
        })
        emptyLocations.results = {
            data: data,
            head: head
        }

        return emptyLocations;

    };

    async function findCurrentNotEmptyLocationIds() {
        let locations = await wmsMysql(ctx).query(`SELECT DISTINCT a1.locationId
                            FROM (
                                (SELECT DISTINCT t2.locationId
                                FROM inventory t1, lp t2
                                WHERE t2.locationId IS NOT NULL
                                    AND t2.locationId != ''
                                    AND t1.qty > 0
                                    AND t1.lpId = t2.id
                                    AND t1.status = 'AVAILABLE')
                            ) a1`);

        let locationIds = _.map(locations, "locationId");
        return locationIds;


    }

    async function findAlwaysEmptyLocationIds() {
        let locations = await wmsMysql(ctx).query(`SELECT DISTINCT a1.locationId
                            FROM (
                                (SELECT DISTINCT t2.locationId
                                FROM inventory t1, lp t2
                                WHERE t2.locationId IS NOT NULL
                                    AND t2.locationId != ''
                                    AND t1.qty > 0
                                    AND t1.lpId = t2.id
                                    AND t1.status = 'AVAILABLE')
                                UNION
                                (SELECT DISTINCT locationId
                                FROM pick_strategy
                                WHERE qty > 0
                                )
                            ) a1`);
        let locationIds = _.map(locations, "locationId");
        if (_.isEmpty(locationIds)) {
            locationIds = ["-1"];
        }
        let alwaysEmptyLocations = await locationCollection(ctx).find({
            _id: {$nin: locationIds},
            status: {$eq: "USEABLE"}
        }).toArray();
        let alwaysEmptyLocationIds = _.map(alwaysEmptyLocations, "_id");
        return alwaysEmptyLocationIds;


    }


    class LocationSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                excludeLocationIds: new MongoOperator('$nin', '_id'),
                status: new MongoOperator('$eq', 'status')
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