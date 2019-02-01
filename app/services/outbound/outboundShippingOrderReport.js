
let service = (app, ctx) => {

    class InventoryAgeSearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new DBOperator('=', 'customerId'),
                status: new DBOperator('=', 'status'),
                itemSpecIds: new DBOperator('IN', 'itemSpecId'),
                orderIds: new DBOperator('IN', 'orderId'),
                shippedTimeFrom: new DBOperator('>=', 'shippedWhen', 'Date'),
                shippedTimeTo: new DBOperator('<', 'shippedWhen', 'Date')
            };
        }
    }

    async function searchByPaging(param) {
        if (!param.customerId) {
            throw new BadRequestError("CustomerId must not be empty.");
        }

        param.status = "SHIPPED";
        let search = new InventoryAgeSearch(param);

        let sql = `select distinct itemSpecId,orderId from inventory where ${search.buildClause()} order by orderId`;
        let pageData = await wmsMysql(ctx).queryByPaging(sql);

        let itemSpecIds = _.uniq(_.map(pageData.results, "itemSpecId"));
        param.itemSpecIds = itemSpecIds;
        param.orderIds =  _.uniq(_.map(pageData.results, "orderId"));
        search = new InventoryAgeSearch(param);

        sql = `select customerId,itemSpecId,orderId,shippedWhen,qty,unitId from inventory where ${search.buildClause()}`;

        let [inventories, orgMap, itemSpecMap] = await Promise.all([
            wmsMysql(ctx).query(sql),
            organizationService(ctx).getOrganizationMap([param.customerId]),
            itemSpecService(ctx).getItemSpecMap(itemSpecIds)
        ]);

        let units = await itemUnitCollection(ctx).query({itemSpecId:{$in:itemSpecIds}},{projection:{itemSpecId:1,name:1,baseQty:1}});
        let unitMap = _.keyBy(units, "_id");
        let csUomMap = _.keyBy(_.filter(units, unit => unit.name === "CS"), "itemSpecId");

        let customer = orgMap[param.customerId];
        let data = [];
        let invGroup = _.groupBy(inventories, "orderId");
        _.forEach(invGroup, (invs, orderId) => {
            let itemGroup = _.groupBy(invs, "itemSpecId");
            _.forEach(itemGroup, (itemInvs, itemSpecId) => {
                let eaQty = _.sum(_.map(itemInvs, inv => unitMap[inv.unitId] ? inv.qty * unitMap[inv.unitId].baseQty : inv.qty));
                let csUomQty = csUomMap[itemSpecId] ? csUomMap[itemSpecId].baseQty : 1;
                let csQty = Math.floor(eaQty / csUomQty);
                eaQty = eaQty % csUomQty;
                let item = itemSpecMap[itemSpecId];

                data.push({
                    "Customer": customer ? customer.name : "",
                    "Order": orderId,
                    "Item": item ? item.name : "",
                    "Item Desc": item ? item.desc : "",
                    "CaseQty": csQty,
                    "PieceQty": eaQty,
                    "ShippedTime": momentZone(itemInvs[0].shippedWhen).format('YYYY-MM-DD HH:mm:ss')
                })
            })
        })

        return {
            results: {
                data: data,
                head: [
                    "Customer",
                    "Order",
                    "Item",
                    "Item Desc",
                    "CaseQty",
                    "PieceQty",
                    "ShippedTime"
                ]
            },
            paging: pageData.paging
        }
    }

    return {
        searchByPaging
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
