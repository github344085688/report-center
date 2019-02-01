let service = (app, ctx) => {

    async function getReport(param) {
        let carrierSearch = new CarrierSearch(param);
        let option = carrierSearch.buildClause();
        let carriers = await carrierCollection(ctx).query(option);

        if (!carriers || carriers.length === 0) return [];

        let userMap = await userService(ctx).getUserMapByCreatedByAndUpdatedBy(carriers);

        let report = [];
        _.forEach(carriers, carrier => {
            report.push({
                name: carrier.name,
                scac: carrier.scac ? carrier.scac : "",
                mcDot: carrier.mcDot ? carrier.mcDot : "",
                note: carrier.note ? carrier.note : "",
                createdBy: userMap[carrier.createdBy] ? userMap[carrier.createdBy].name : "",
                createdWhen: carrier.createdWhen ? momentZone(carrier.createdWhen).format('YYYY-MM-DD HH:mm:ss') : "",
                updatedBy: userMap[carrier.updatedBy] ? userMap[carrier.updatedBy].name : "",
                updatedWhen: carrier.updatedWhen ? momentZone(carrier.updatedWhen).format('YYYY-MM-DD HH:mm:ss') : ""
            });
        });
        return {
            head: header,
            data: report
        }
    }

    let header = [
        "name",
        "scac",
        "mcDot",
        "note",
        "createdBy",
        "createdWhen",
        "updatedBy",
        "updatedWhen"
    ];

    class CarrierSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                scac: new MongoOperator('$regex', 'scac'),
                scacEq: new MongoOperator('$eq', 'scac'),
                mcDot: new MongoOperator('$regex', 'mcDot'),
                id: new MongoOperator('$eq', '_id'),
                ids: new MongoOperator('$in', '_id'),
                nameRegex: new MongoOperator('$regex', 'name'),
                name: new MongoOperator('$eq', 'name'),
                names: new MongoOperator('$in', 'name')
            };
        }
    }

    async function getCarrierMap(carrierIds) {
        return await app.util.getMapFromCache(ctx.cached.carrierMap, carrierIds, _getCarrierMap);
    }

    async function _getCarrierMap(carrierIds) {
        if (_.isEmpty(carrierIds)) return {};
        let carriers = await carrierCollection(ctx).find({"_id": {$in: carrierIds}}).toArray();
        if (_.isEmpty(carriers)) return;
        return _.keyBy(carriers, "_id");
    }

    async function fillCarrierDetail(objects) {
        if (_.isEmpty(objects)) return;

        let carrierIds = _.compact(_.uniq(_.map(objects, "carrierId")));
        if (_.isEmpty(carrierIds)) return;

        let carrierMap = await getCarrierMap(carrierIds);
        for (let obj of objects) {
            let carrier = carrierMap[obj.carrierId];
            if (carrier) {
                obj.carrierName = carrier.name;
                obj.carrierScac = carrier.scac;
            }
        }
    }

    return {
        getReport,
        getCarrierMap,
        fillCarrierDetail
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};