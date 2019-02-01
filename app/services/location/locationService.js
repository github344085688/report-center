const _ = require('lodash');

let service = (app, ctx) => {
    async function getLocationMapById(locationIds) {
        if (!locationIds || locationIds.length === 0) return {};
        let locations = await locationCollection(ctx).find({"_id": {$in: locationIds}}).toArray();
        return _.keyBy(locations, "_id");
    }

    async function searchLocationByPaging(criteria) {
        let locationSearch = new LocationSearch(criteria);
        let criteriaClause = locationSearch.buildClause();
        return await locationCollection(ctx).findByPaging(criteriaClause);
    }

    async function getLocationStackLpIdMap(lpIds) {
        if (_.isEmpty(lpIds)) return {};

        let sql = `select id,locationId from lp where id in('${lpIds.join("','")}')`;
        let lps = await wmsMysql(ctx).query(sql);
        let lpMap = _.keyBy(lps, "id");
        let locationIds = _.compact(_.uniq(_.map(lps, "locationId")));

        sql = `select distinct lpId,locationId from pick_strategy where lpId in('${lpIds.join("','")}') order by createdWhen`;
        let pickStrategies = await wmsMysql(ctx).query(sql);
        let pickStrategyMap = _.keyBy(pickStrategies, "lpId");
        let pickStrategyLocationIds = _.compact(_.uniq(_.map(pickStrategies, "locationId")));
        locationIds = _.uniq(_.union(locationIds, pickStrategyLocationIds));

        if (_.isEmpty(locationIds)) return {};

        let locations = await locationCollection(ctx).query({_id:{$in:locationIds}},{projection:{stack:1}});
        let locationMap = _.keyBy(locations, "_id");

        let res = {};
        _.forEach(lpIds, lp => {
            if (!lpMap[lp] && !pickStrategyMap[lp]) return;
            let locationId = lpMap[lp] ? lpMap[lp].locationId : (pickStrategyMap[lp] ? pickStrategyMap[lp].locationId : "");
            if (!locationMap[locationId] || !locationMap[locationId].stack) return;

            res[lp] = locationMap[locationId].stack;
        })
        return res;
    }

    class LocationSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                locationIds: new MongoOperator('$in', '_id'),
                excludeLocationIds: new MongoOperator('$nin', '_id'),
                status: new MongoOperator('$eq', 'status'),
                excludeStatuses: new MongoOperator('$nin', 'status'),
            };
        }
    }

    return {
        getLocationMapById,
        searchLocationByPaging,
        getLocationStackLpIdMap
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};