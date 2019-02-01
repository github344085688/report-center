
let service = (app, ctx) => {

    async function searchByPaging(param) {
        if (!param.customerId) {
            throw new BadRequestError('Please customer must not be empty.');
        }

        let items = await itemSpecCollection(ctx).query({customerId:param.customerId},{projection:{name:1,desc:1}});
        param.itemSpecIds = _.map(items, "_id");
        let itemMap = _.keyBy(items, "_id");

        // let search = new InventoryCountSearch(param);
        // let criteriaClause = search.buildClause();
        let criteriaClause = _buildClause(param);

        let sql = `select locationName,lpId,itemSpecId,uom,qty,diffEaQty,diffCsQty,createdBy,createdWhen,isEffective,isEmptyLocation
         from basic_cycle_count where ${criteriaClause}`;

        let countData = await wmsMysql(ctx).queryByPaging(sql);
        let userMap = await userService(ctx).getUserMapByCreatedByAndUpdatedBy(countData.results);

        let data = [];
        _.forEach(countData.results, count => {
            let item = itemMap[count.itemSpecId] || {};
            let user = userMap[count.createdBy] || {};
            data.push({
                lpId: count.lpId || "",
                locationName: count.locationName || "",
                itemSpecName: item.name || "",
                itemSpecDesc: item.desc || "",
                uom: count.uom || "",
                qty: count.qty || "",
                diffCsQty: count.diffCsQty || "",
                diffEaQty: count.diffEaQty || "",
                createdBy: user.name || "",
                createdWhen: momentZone(count.createdWhen).format('YYYY-MM-DD HH:mm:ss'),
                isEffective: count.isEffective,
                isEmptyLocation: count.isEmptyLocation
            })
        })

        return {
            results: {
                data: data,
                head: [
                    "lpId",
                    "locationName",
                    "itemSpecName",
                    "itemSpecDesc",
                    "uom",
                    "qty",
                    "diffCsQty",
                    "diffEaQty",
                    "createdBy",
                    "createdWhen",
                    "isEffective",
                    "isEmptyLocation"
                ]
            },
            paging: countData.paging
        }
    }

    function _buildClause(param) {
        let where = "1=1";
        if (param.itemSpecIds) {
            where += ` and (itemSpecId in('${param.itemSpecIds.join("','")}') or itemSpecId is null)`;
        }
        if (param.timeFrom) {
            where += ` and createdWhen>='${momentZone(param.timeFrom).format()}'`;
        }
        if (param.timeTo) {
            where += ` and createdWhen<'${momentZone(param.timeTo).format()}'`;
        }
        return where;
    }

    class InventoryCountSearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                itemSpecIds: new DBOperator('IN', 'itemSpecId'),
                timeFrom: new DBOperator('>=', 'createdWhen', 'Date'),
                timeTo: new DBOperator('<', 'createdWhen', 'Date')
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