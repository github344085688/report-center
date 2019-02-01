
let service = (app, ctx) => {

    async function _getInventory(param) {
        if (!param.customerId) {
            throw new BadRequestError('Please select one customer.');
        }
        if (!param.startTime) {
            throw new BadRequestError('Please type start time.');
        }

        let timeFrom = momentZone(param.startTime).format();
        let timeTo;
        if (param.endTime) {
            timeTo = momentZone(param.endTime).format();
        }

        let sql = `select itemSpecId,lotNo,status,unitId,lpId,orderId,customerId,qty,shippedWhen from inventory where status='SHIPPED' and customerId='${param.customerId}' and qty>0 and shippedWhen>='${timeFrom}' `;
        if (timeTo) {
            sql += `and shippedWhen<'${timeTo}'`;
        }
        if (param.orderId) {
            sql += ` and orderId='${param.orderId}'`;
        }
        return await wmsMysql(ctx).queryByPaging(sql);
    }

    async function searchByPaging(param) {
        let invRes = await _getInventory(param);
        let shippedInvs = invRes.results;
        _.forEach(shippedInvs, inv => {
            inv.lotNo = inv.lotNo ? inv.lotNo : "";
        })

        let itemSpecIds = _.uniq(_.map(shippedInvs, "itemSpecId"));
        let orderIds = _.uniq(_.map(shippedInvs, "orderId"));
        let [organizationMap, items, units, itemLpConfigurations, pickTaskOrderMap, orderItemLines] = await Promise.all([
            organizationService(ctx).getOrganizationMap([param.customerId]),
            itemSpecCollection(ctx).query({_id:{$in:itemSpecIds}},{projection:{name:1}}),
            itemUnitCollection(ctx).query({itemSpecId:{$in:itemSpecIds}},{projection:{name:1,itemSpecId:1,baseQty:1}}),
            itemLpConfigurationService(ctx).getItemLpConfigurations(itemSpecIds),
            pickTaskService(ctx).getPickTaskMapByOrderId(orderIds, ["CLOSED", "FORCE_CLOSED"]),
            orderService(ctx).getOrderItemLines(orderIds)
        ]);
        let customer = organizationMap[param.customerId];
        let orderItemLineGroup = _.groupBy(orderItemLines, "orderId");

        let itemMap = _.keyBy(items, "_id");
        let uomMap = _.keyBy(units, "_id");
        let csUoms = _.filter(units, uom => uom.name === "CS");
        let csUomMap = _.keyBy(csUoms, "itemSpecId");
        let inUoms = _.filter(units, uom => uom.name === "IN");
        let inUomMap = _.keyBy(inUoms, "itemSpecId");

        let invGroupByOrder = _.groupBy(shippedInvs, "orderId");
        let data = [];
        for (let orderId of orderIds) {
            let orderInvs = invGroupByOrder[orderId];
            let packQty = await billingShippingReportService(ctx).calPackQty(orderInvs, uomMap, csUomMap);
            let pTasks = pickTaskOrderMap[orderId];
            if (packQty > 0) {
                data.push({
                    "PackQty": packQty,
                    "Customer": customer.name,
                    "OrderId": orderId
                });
            }

            for (let line of orderItemLineGroup[orderId]) {
                let itemSpecId = line.itemSpecId;
                let itemInvs = _.filter(orderInvs, inv => {
                    if (line.lotNo) {
                        return inv.itemSpecId === line.itemSpecId && inv.lotNo === line.lotNo;
                    }
                    return inv.itemSpecId === line.itemSpecId;
                });
                if (!itemInvs || itemInvs.length === 0) continue;

                let item = itemMap[itemSpecId];
                let csUom = csUomMap[itemSpecId];
                let inUom = inUomMap[itemSpecId];

                let pickQty = await billingShippingReportService(ctx).calPickQty(customer, itemLpConfigurations, itemInvs, pTasks, uomMap, csUom, inUom);
                let lpConfiguration = _.find(itemLpConfigurations, conf => conf.itemSpecId === itemSpecId && conf.isDefault);
                let lpIds = _.uniq(_.map(itemInvs, "lpId"));
                let shippedQty = _.sum(_.map(itemInvs, inv => uomMap[inv.unitId] ? uomMap[inv.unitId].baseQty * inv.qty : inv.qty));
                let palletUom = lpConfiguration ? lpConfiguration.uomName : "";

                data.push({
                    "Item": item.name,
                    "LotNo": line.lotNo || "",
                    "PalletPickQty": pickQty.palletPickQty,
                    "CasePickQty": pickQty.casePickQty,
                    "InnerPickQty": pickQty.innerPickQty,
                    "PiecePickQty": pickQty.piecePickQty,
                    "Customer": customer.name,
                    "OrderId": orderId,
                    "LP Count": lpIds.length,
                    "PalletTemplate": lpConfiguration ? lpConfiguration.templateName : "",
                    "UOM": palletUom,
                    "UnitsPallet": lpConfiguration ? lpConfiguration.totalQty : "",
                    "ShippedQty": palletUom === "CS" ? shippedQty / csUom.baseQty : shippedQty
                })
            }
        }

        return {
            results: {
                data: data,
                head: [
                    "Item",
                    "LotNo",
                    "PackQty",
                    "PalletPickQty",
                    "CasePickQty",
                    "InnerPickQty",
                    "PiecePickQty",
                    "Customer",
                    "OrderId",
                    "LP Count",
                    "PalletTemplate",
                    "UOM",
                    "UnitsPallet",
                    "ShippedQty"
                ]
            },
            paging: invRes.paging
        }
    }

    return {
        searchByPaging
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};