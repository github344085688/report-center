const _ = require('lodash');

let service = (app, ctx) => {
    /*
     necessary param:  {customerId: 'customerId', statuses: 'statuses'}
     */
    async function searchByPaging(criteria) {
        let searchClause = inventoryService(ctx).buildInventorySearchClause(criteria);
        if (_.isEmpty(searchClause)) {
            throw new Error("Please specific an inventory status and customer to search.")
        }
        let pagingResult = await wmsMysql(ctx).queryByPaging(`SELECT * FROM inventory WHERE ${searchClause}`);
        let inventories = pagingResult.results;
        if (_.isEmpty(inventories)) return {};

        let itemSpecIds = _.mapUniq(inventories, "itemSpecId");
        let unitIds = _.mapUniq(inventories, "unitId");
        let orgIds = _.union(_.mapUniq(inventories, "customerId"), _.mapUniq(inventories, "supplierId"), _.mapUniq(inventories, "titleId"));
        let [orgMap, itemSpecMap, itemUnitMap] = await Promise.all([organizationService(ctx).getOrganizationMap(orgIds), itemSpecService(ctx).getItemSpecMap(itemSpecIds), itemUnitService(ctx).getUnitMapByIds(unitIds)]);

        let data = [];
        _.each(inventories, i => {
            if (i.qty > 0) {
                i["Customer"] = orgMap[i.customerId] ? orgMap[i.customerId].name : "";
                i["Item ID"] = itemSpecMap[i.itemSpecId] ? itemSpecMap[i.itemSpecId].name : "";
                i["Description"] = itemSpecMap[i.itemSpecId] ? itemSpecMap[i.itemSpecId].desc : "";
                i["Supplier"] = i.supplierId ? (orgMap[i.supplierId] ? orgMap[i.supplierId].name : "") : "";
                i["Title"] = i.titleId ? (orgMap[i.titleId] ? orgMap[i.titleId].name : "") : "";
                i["OnHold Qty"] = i.qty;
                i["UOM"] = itemUnitMap[i.unitId] ? itemUnitMap[i.unitId].name : "";
                i = commonService(ctx).convertObjectKeyByFunction(i, _.upperFirst);
                data.push(i);
            }
        });

        return {
            results: {
                data: data,
                head: head
            },
            paging: pagingResult.paging
        }
    }

    let head = [
        "Customer",
        "Item ID",
        "Description",
        "Supplier",
        "Title",
        "Status",
        "OnHold Qty",
        "UOM",
        "LotNo",
        "ExpirationDate",
        "ReceiptId",
        "UpdatedBy"
    ];

    return {
        searchByPaging
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};