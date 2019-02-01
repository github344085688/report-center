const _ = require('lodash');

let service = (app, ctx) => {

    async function getLpMap(lpIds) {
        return await app.util.getMapFromCache(ctx.cached.lpMap, lpIds, _getLpMap);
    }

    async function _getLpMap(lpIds) {
        if (_.isEmpty(lpIds)) return {};

        let lps = await wmsMysql(ctx).query(`select id, palletNo from lp where id in('${lpIds.join("','")}')`);
        return _.keyBy(lps, "id");
    }

    async function getLpWithTemplateMap(lpIds) {
        if (!lpIds || lpIds.length === 0) return {};

        let lps = [];
        let lpIdGroups = _.chunk(lpIds, 500);
        for (let ids of lpIdGroups) {
            let groupLps = await wmsMysql(ctx).selectAll(`select * from lp where id in('${ids.join("','")}')`);
            lps = _.union(lps, groupLps);
        }
        let confIds = _.compact(_.uniq(_.map(lps, "confId")));

        let singleLpTemplateMap = {};
        if (confIds && confIds.length > 0) {
            let singleLpTemplates = await singleLpTemplateCollection(ctx).find({_id: {$in: confIds}}).toArray();
            singleLpTemplateMap = _.keyBy(singleLpTemplates, "_id");
        }
        let locationIds = _.compact(_.uniq(_.map(lps, "locationId")));
        let locations = await locationCollection(ctx).find({_id: {$in: locationIds}}, {
            projection: {
                name: 1,
                length: 1,
                width: 1
            }
        }).toArray();
        let locationMap = _.keyBy(locations, "_id");

        let data = [];
        _.forEach(lps, lp => {
            let location = locationMap[lp.locationId];
            data.push({
                id: lp.id,
                confId: lp.confId,
                locationId: lp.locationId ? lp.locationId : "",
                location: location ? location : null,
                template: singleLpTemplateMap[lp.confId] ? singleLpTemplateMap[lp.confId].name : ""
            });
        });

        return _.keyBy(data, "id");
    }

    async function getInnerLps(outerLpIds) {
        if (!outerLpIds || outerLpIds.length === 0) return [];

        let sql = `select id,parentId from lp where parentId in('${outerLpIds.join("','")}')`;
        let allLps = [];
        let lps = await wmsMysql(ctx).query(sql);
        while (lps && lps.length > 0) {
            allLps = _.union(allLps, lps);
            let lpIds = _.map(lps, "id");
            sql = `select id,parentId from lp where parentId in('${lpIds.join("','")}')`;
            lps = await wmsMysql(ctx).query(sql);
        }

        let parentLpGroup = _.groupBy(allLps, "parentId");

        let res = [];
        _.forEach(outerLpIds, id => {
            let parentLps = parentLpGroup[id];
            _.forEach(parentLps, pLp => {
                let innerLps = _getInnerLps(pLp, parentLpGroup);
                _.forEach(innerLps, iId => {
                    res.push({outerLp: id, innerLp: iId});
                })
            })
        })

        return res;
    }

    function _getInnerLps(lp, parentLpGroup) {
        if (parentLpGroup[lp.id]) {
            let parentLps = parentLpGroup[lp.id];
            let innerLps = [lp.id];
            _.forEach(parentLps, pLp => {
                let lps = _getInnerLps(pLp, parentLpGroup);
                innerLps = _.union(innerLps, lps);
            })
            return innerLps;
        } else {
            return [lp.id];
        }
    }

    async function getOuterLps(innerLpIds) {
        if (!innerLpIds || innerLpIds.length === 0) return [];

        let sql = `select id,parentId from lp where id in('${innerLpIds.join("','")}')`;
        let allLps = [];
        let lps = await wmsMysql(ctx).query(sql);
        while (1) {
            allLps = _.union(allLps, lps);
            let lpIds = _.concat(_.uniq(_.map(lps, "parentId")));
            if (!lpIds || lpIds.length === 0) break;

            sql = `select id,parentId from lp where id in('${lpIds.join("','")}')`;
            lps = await wmsMysql(ctx).query(sql);
        }

        let lpMap = _.keyBy(allLps, "id");

        let res = [];
        _.forEach(innerLpIds, id => {
            let lp = lpMap[id];
            while (lp.parentId && lpMap[lp.parentId]) {
                lp = lpMap[lp.parentId];
            }
            if (lp.id !== id) {
                res.push({outerLp: lp.id, innerLp: id})
            }
        })

        return res;
    }

    async function getInnerLpIdsIncludeOuterLp(outerLpIds) {
        if (_.isEmpty(outerLpIds)) return [];

        return _.union(outerLpIds, await _getInnerLpIds(outerLpIds, outerLpIds));
    }

    // this is safe version of get inner LPIds which avoid endless LP loop
    // e.g. ILP-1 -> ILP-2 -> ILP-1
    async function _getInnerLpIds(outerLpIds, excludeLpIds) {
        if (_.isEmpty(outerLpIds)) return [];

        let sql = `SELECT id FROM lp WHERE parentId IN('${outerLpIds.join("','")}')`;
        let innnerLPs = await wmsMysql(ctx).query(sql);
        if (_.isEmpty(innnerLPs)) {
            return [];
        }

        let innerLpIds = _.map(innnerLPs, "id");
        innerLpIds = _.difference(innerLpIds, excludeLpIds);
        if (_.isEmpty(innerLpIds)) {
            return [];
        }

        excludeLpIds = _.union(excludeLpIds, innerLpIds);
        return _.union(innerLpIds, await _getInnerLpIds(innerLpIds, excludeLpIds));
    }

    async function getLpParentChildPairs(lpIds) {
        if (_.isEmpty(lpIds)) {
            return {}
        }

        let sql = `SELECT id, parentId FROM lp WHERE id IN('${lpIds.join("','")}')`;
        let lps = await wmsMysql(ctx).query(sql);
        if (_.isEmpty(lps)) {
            return {};
        }

        let pairs = {};
        for (let lp of lps) {
            if (!lp.parentId) continue;

            pairs[lp.parentId] = pairs[lp.parentId] || [];
            pairs[lp.parentId].push(lp.id);
        }

        return pairs;
    }

    function getInnerLpIdsByParentChildrenPairs(lpIds, parentChildrenPairs) {
        if (_.isEmpty(lpIds)) return [];

        return _getInnerLpIdsByParentChildrenPairs(lpIds, parentChildrenPairs, lpIds);
    }

    function _getInnerLpIdsByParentChildrenPairs(lpIds, parentChildrenPairs, excludeLpIds) {
        if (_.isEmpty(lpIds)) return [];

        let innerLpIds = [];
        for (let lpId of lpIds) {
            let childrenLpIds = parentChildrenPairs[lpId];
            childrenLpIds = _.difference(childrenLpIds, excludeLpIds);
            if (_.isEmpty(childrenLpIds)) continue;

            excludeLpIds = _.union(excludeLpIds, childrenLpIds);
            innerLpIds = _.union(innerLpIds, childrenLpIds, _getInnerLpIdsByParentChildrenPairs(childrenLpIds, parentChildrenPairs, excludeLpIds));
        }

        return innerLpIds;
    }


    return {
        getLpWithTemplateMap,
        getLpMap,
        getInnerLps,
        getInnerLpIdsIncludeOuterLp,
        getLpParentChildPairs,
        getInnerLpIdsByParentChildrenPairs
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};

