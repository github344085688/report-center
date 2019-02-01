
let service = (app, ctx) => {

    async function searchByPaging(param) {
        if (!param.customerId) {
            throw new BadRequestError('Please select one customer.');
        }
        let where = `customerId='${param.customerId}' and qty>0 and status in('AVAILABLE','ON_HOLD','PICKED','PACKED','LOADED')`;
        let sql = `select distinct itemSpecId,titleId from inventory where ${where}`;
        let invItems = await wmsMysql(ctx).queryByPaging(sql);

        let itemSpecIds = _.uniq(_.map(invItems.results, "itemSpecId"));
        let titleIds = _.uniq(_.map(invItems.results, "titleId"));

        where += ` and itemSpecId in('${itemSpecIds.join("','")}') and titleId in('${titleIds.join("','")}')`;
        sql = `select itemSpecId,unitId,qty,titleId,customerId from inventory where ${where}`;
        titleIds.push(param.customerId);

        let [items, units, orgMap, invs] = await Promise.all([
            itemSpecCollection(ctx).query({_id:{$in:itemSpecIds}},{projection:{name:1,desc:1,shortDescription:1}}),
            itemUnitCollection(ctx).query({itemSpecId:{$in:itemSpecIds}}),
            organizationService(ctx).getOrganizationMap(titleIds),
            wmsMysql(ctx).selectAll(sql)
        ]);
        let itemMap = _.keyBy(items, "_id");
        let uomMap = _.keyBy(units, "_id");

        let customer = orgMap[param.customerId];
        let invGroup = _.groupBy(invs, inv => inv.itemSpecId + inv.titleId);
        let data = [];
        _.forEach(invGroup, (groupInvs, key) => {
            let item = itemMap[groupInvs[0].itemSpecId] || {};
            let baseQty = _.sum(_.map(groupInvs, inv => uomMap[inv.unitId] ? inv.qty * uomMap[inv.unitId].baseQty : inv.qty));
            let title = orgMap[groupInvs[0].titleId] || {};

            data.push({
                "Customer": customer.name,
                "Title": title.name || "",
                "Item ID": item.name || "",
                "Short Description": item.shortDescription || "",
                "Description": item.desc || "",
                "UOM": "EA",
                "Total QTY": baseQty
            });
        })

        return {
            results: {
                data: data,
                head: [
                    "Customer",
                    "Title",
                    "Item ID",
                    "Short Description",
                    "Description",
                    "UOM",
                    "Total QTY"
                ]
            },
            paging: invItems.paging
        }
    }

    return {
        searchByPaging
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};