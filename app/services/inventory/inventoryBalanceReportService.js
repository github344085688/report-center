
let service = (app, ctx) => {

    function _getEmptyPage(param) {
        let head = [
            "Item ID",
            "Description",
            "Short Description",
            "UOM",
            "Current Balance",
            "Beginning Balance",
            "Received",
            "Shipped",
            "Adjust In",
            "Adjust Out",
            "Transfer In",
            "Transfer Out"
        ];
        if (param.isLotNoLevel) {
            head = [
                "Item ID",
                "Description",
                "Short Description",
                "LotNo",
                "UOM",
                "Current Balance",
                "Beginning Balance",
                "Received",
                "Shipped",
                "Adjust In",
                "Adjust Out",
                "Transfer In",
                "Transfer Out"
            ];
        }

        return {
            results: {
                data: [],
                head: head
            }
        };
    }

    async function _getItemSpecs(param, resData) {
        let where = " qty>0 ";
        if (param.customerId) where += ` and customerId='${param.customerId}'`;
        if (param.itemSpecIds && param.itemSpecIds.length > 0) {
            where += ` and itemSpecId in('${param.itemSpecIds.join("','")}')`;
        }
        if (param.timeFrom) {
            where += ` and shippedWhen>'${param.timeFrom}'`;
        }
        if (param.timeTo) {
            where += ` and createdWhen<'${param.timeTo}'`;
        }

        let itemSpecs = await wmsMysql(ctx).queryByPaging(`select distinct itemSpecId from inventory where ${where} order by itemSpecId`);
        resData.paging = itemSpecs.paging;
        let itemSpecIds = _.map(itemSpecs.results, "itemSpecId");

        let items = await itemSpecCollection(ctx).find({_id:{$in:itemSpecIds}}, {
            projection: {name: 1, shortDescription: 1, desc: 1}
        }).toArray();

        return items;
    }

    async function _getStartInventories(param, itemSpecIds, uomMap) {
        let startInventories = [];
        let timeFrom = param.timeFrom ? momentZone(param.timeFrom) : null;
        let timeNow = momentZone();

        if (timeFrom && timeFrom < timeNow) {
            ctx.cached = ctx.cached || {};
            startInventories = ctx.cached.startInventories || [];
            if (startInventories.length === 0) {
                startInventories = await inventoryService(ctx).getHistoryInventory(param.customerId, null, param.timeFrom);
            }
            startInventories = _.filter(startInventories, inv => _.includes(itemSpecIds, inv.itemSpecId) && inv.onHandQty>0 && inv.status !== "SHIPPED" && inv.status !== "DAMAGE");
        }
        _.forEach(startInventories, inv => {
            inv.eaQty = uomMap[inv.unitId] ? inv.qty * uomMap[inv.unitId].baseQty : inv.qty;
        })
        return startInventories;
    }

    async function _getEndInventories(param, itemSpecIds, uomMap) {
        let endInventories = [];
        let timeTo = param.timeTo ? momentZone(param.timeTo) : null;
        let timeNow = momentZone();

        if (timeTo && timeTo < timeNow) {
            ctx.cached = ctx.cached || {};
            endInventories = ctx.cached.endInventories || [];
            if (endInventories.length === 0) {
                endInventories = await inventoryService(ctx).getHistoryInventory(param.customerId, null, param.timeTo);
            }
            endInventories = _.filter(endInventories, inv => _.includes(itemSpecIds, inv.itemSpecId) && inv.onHandQty>0 && inv.status !== "SHIPPED" && inv.status !== "DAMAGE");
        } else {
            endInventories = await wmsMysql(ctx).query(`select ${tabelFieldMap.inventoryFields} from inventory where qty>0 
                                                            and status not in('SHIPPED','DAMAGE') 
                                                            and itemSpecId in ('${itemSpecIds.join("','")}')`);
        }
        _.forEach(endInventories, inv => {
            inv.eaQty = uomMap[inv.unitId] ? inv.qty * uomMap[inv.unitId].baseQty : inv.qty;
        })
        return endInventories;
    }

    function _getBalanceQty(balanceUom, csUomMap, itemSpecId, eaQty) {
        if (balanceUom === "CS" && csUomMap[itemSpecId]) {
            return Math.floor(eaQty / csUomMap[itemSpecId].baseQty);
        }
        return eaQty;
    }

    function _getNormalBalance(balanceUom, csUomMap, item, adjustData, startInvs, endInvs, inbounds, outbounds, transferReceipts, transferOrders) {
        let adjustInQty = _.sum(_.map(_.filter(adjustData, data => data.adjustQty > 0), adjust => _getBalanceQty(balanceUom, csUomMap, adjust.itemSpecId, adjust.adjustQty))) || 0;
        let adjustOutQty = _.sum(_.map(_.filter(adjustData, data => data.adjustQty < 0), adjust => _getBalanceQty(balanceUom, csUomMap, adjust.itemSpecId, adjust.adjustQty))) || 0;
        let beginQty = _.sum(_.map(startInvs, inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
        let currentQty = _.sum(_.map(endInvs, inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
        let inboundQty = _.sum(_.map(inbounds, inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
        let outboundQty = _.sum(_.map(outbounds, inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
        let transferInQty = _.sum(_.map(transferReceipts, inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
        let transferOutQty = _.sum(_.map(transferOrders, inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;

        beginQty = currentQty - (inboundQty - outboundQty + adjustInQty + adjustOutQty + transferInQty - transferOutQty);
        if (beginQty < 0) {
            currentQty = currentQty - beginQty;
            beginQty = 0;
        }
        let line = {
            "Item ID": item.name,
            "Description": item.desc || "",
            "Short Description": item.shortDescription || "",
            "UOM": balanceUom || "EA",
            "Current Balance": currentQty,
            "Beginning Balance": beginQty,
            "Received": inboundQty,
            "Shipped": outboundQty,
            "Adjust In": adjustInQty,
            "Adjust Out": Math.abs(adjustOutQty),
            "Transfer In": transferInQty,
            "Transfer Out": transferOutQty
        };
        return line;
    }

    function _colLotNos(adjustData, startInvs, endInvs, inbounds, outbounds, transferReceipts, transferOrders) {
        let lotNos = _.map(adjustData, "lotNo");
        lotNos = _.union(lotNos, _.map(startInvs, "lotNo"));
        lotNos = _.union(lotNos, _.map(endInvs, "lotNo"));
        lotNos = _.union(lotNos, _.map(inbounds, "lotNo"));
        lotNos = _.union(lotNos, _.map(outbounds, "lotNo"));
        lotNos = _.union(lotNos, _.map(transferReceipts, "lotNo"));
        lotNos = _.union(lotNos, _.map(transferOrders, "lotNo"));

        return _.uniq(lotNos);
    }

    function _getLotNoLavelBalance(balanceUom, csUomMap, item, adjustData, startInvs, endInvs, inbounds, outbounds, transferReceipts, transferOrders) {
        let lotNos = _colLotNos(adjustData, startInvs, endInvs, inbounds, outbounds, transferReceipts, transferOrders);

        let lines = [];
        _.forEach(lotNos, lotNo => {
            let adjustInQty = _.sum(_.map(_.filter(adjustData, data => data.lotNo === lotNo && data.adjustQty > 0), adjust => _getBalanceQty(balanceUom, csUomMap, adjust.itemSpecId, adjust.adjustQty))) || 0;
            let adjustOutQty = _.sum(_.map(_.filter(adjustData, data => data.lotNo === lotNo && data.adjustQty < 0), adjust => _getBalanceQty(balanceUom, csUomMap, adjust.itemSpecId, adjust.adjustQty))) || 0;
            let beginQty = _.sum(_.map(_.filter(startInvs, data => data.lotNo === lotNo), inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
            let currentQty = _.sum(_.map(_.filter(endInvs, data => data.lotNo === lotNo), inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
            let inboundQty = _.sum(_.map(_.filter(inbounds, data => data.lotNo === lotNo), inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
            let outboundQty = _.sum(_.map(_.filter(outbounds, data => data.lotNo === lotNo), inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
            let transferInQty = _.sum(_.map(_.filter(transferReceipts, data => data.lotNo === lotNo), inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
            let transferOutQty = _.sum(_.map(_.filter(transferOrders, data => data.lotNo === lotNo), inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;

            if (_.isEmpty(lotNo)) {
                adjustInQty = _.sum(_.map(_.filter(adjustData, data => _.isEmpty(data.lotNo) && data.adjustQty > 0), adjust => _getBalanceQty(balanceUom, csUomMap, adjust.itemSpecId, adjust.adjustQty))) || 0;
                adjustOutQty = _.sum(_.map(_.filter(adjustData, data => _.isEmpty(data.lotNo) && data.adjustQty < 0), adjust => _getBalanceQty(balanceUom, csUomMap, adjust.itemSpecId, adjust.adjustQty))) || 0;
                beginQty = _.sum(_.map(_.filter(startInvs, data => _.isEmpty(data.lotNo)), inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
                currentQty = _.sum(_.map(_.filter(endInvs, data => _.isEmpty(data.lotNo)), inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
                inboundQty = _.sum(_.map(_.filter(inbounds, data => _.isEmpty(data.lotNo)), inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
                outboundQty = _.sum(_.map(_.filter(outbounds, data => _.isEmpty(data.lotNo)), inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
                transferInQty = _.sum(_.map(_.filter(transferReceipts, data => _.isEmpty(data.lotNo)), inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
                transferOutQty = _.sum(_.map(_.filter(transferOrders, data => _.isEmpty(data.lotNo)), inv => _getBalanceQty(balanceUom, csUomMap, inv.itemSpecId, inv.eaQty))) || 0;
            }

            beginQty = currentQty - (inboundQty - outboundQty + adjustInQty + adjustOutQty + transferInQty - transferOutQty);
            if (beginQty < 0) {
                currentQty = currentQty - beginQty;
                beginQty = 0;
            }
            let line = {
                "Item ID": item.name,
                "Description": item.desc || "",
                "Short Description": item.shortDescription || "",
                "LotNo": lotNo || "",
                "UOM": balanceUom || "EA",
                "Current Balance": currentQty,
                "Beginning Balance": beginQty,
                "Received": inboundQty,
                "Shipped": outboundQty,
                "Adjust In": adjustInQty,
                "Adjust Out": Math.abs(adjustOutQty),
                "Transfer In": transferInQty,
                "Transfer Out": transferOutQty
            };
            lines.push(line);
        })

        return lines;
    }

    async function searchByPaging(param) {
        if (param.itemSpecId) param.itemSpecIds = [param.itemSpecId];
        if (!param.customerId && (!param.itemSpecIds || param.itemSpecIds.length === 0)) {
            throw new BadRequestError('Please select one customer or item.');
        }

        let resData = _getEmptyPage(param);
        let items = await _getItemSpecs(param, resData);
        if (!items || items.length === 0) return resData;

        let itemSpecIds = _.map(items, "_id");
        let adjustTypes = ["ADJUST_STATUS", "ADJUST_QTY", "ADD_INVENTORY", "ADJUST_ITEM", "ADJUST_UOM", "ADJUST_CUSTOMER", "ADJUST_TITLE"];
        if (param.isLotNoLevel) {
            adjustTypes.push("ADJUST_LOTNO");
        }
        let [adjustments,uoms] = await Promise.all([
            adjustmentReportService(ctx).getAdjustmentReportByItemSpecIds(itemSpecIds, adjustTypes, param.timeFrom, param.timeTo),
            itemUnitCollection(ctx).find({itemSpecId: {$in: itemSpecIds}}).toArray()
        ]);
        let uomMap = _.keyBy(uoms, "_id");
        let csUoms = _.filter(uoms, uom => uom.name === "CS");
        let csUomMap = _.keyBy(csUoms, "itemSpecId");

        let [startInventories,endInventories] = await Promise.all([
            _getStartInventories(param, itemSpecIds, uomMap),
            _getEndInventories(param, itemSpecIds, uomMap)
        ]);

        let adjustmentGroupByItem = _.groupBy(adjustments, "itemSpecId");
        let startInventoryGroupByItem = _.groupBy(startInventories, "itemSpecId");
        let endInventoryGroupByItem = _.groupBy(endInventories, "itemSpecId");

        let [transferReceiptData,transferOrderData,inboundData,outBoundData,balanceUom] = await Promise.all([
            receiptService(ctx).getInboundData(param.customerId, itemSpecIds, ["TT","MT"], param.timeFrom, param.timeTo),
            orderService(ctx).getOutBoundData(param.customerId, itemSpecIds, ["TT","MT"], param.timeFrom, param.timeTo),
            receiptService(ctx).getInboundData(param.customerId, itemSpecIds, null, param.timeFrom, param.timeTo),
            orderService(ctx).getOutBoundData(param.customerId, itemSpecIds, null, param.timeFrom, param.timeTo),
            importMappingCollection(ctx).findOne({tableName:"BalanceUom"})
        ]);
        balanceUom = balanceUom || {valueMapping:{}};
        let transferReceiptGroupByItem = _.groupBy(transferReceiptData, "itemSpecId");
        let transferOrderGroupByItem = _.groupBy(transferOrderData, "itemSpecId");
        let inboundGroupByItem = _.groupBy(inboundData, "itemSpecId");
        let outBoundGroupByItem = _.groupBy(outBoundData, "itemSpecId");

        let data = [];
        _.forEach(items, item => {
            let adjustData = adjustmentGroupByItem[item._id] || [];
            let startInvs = startInventoryGroupByItem[item._id] || [];
            let endInvs = endInventoryGroupByItem[item._id] || [];
            let inbounds = inboundGroupByItem[item._id] || [];
            let outbounds = outBoundGroupByItem[item._id] || [];
            let transferReceipts = transferReceiptGroupByItem[item._id] || [];
            let transferOrders = transferOrderGroupByItem[item._id] || [];

            if (param.isLotNoLevel) {
                let lines = _getLotNoLavelBalance(balanceUom.valueMapping[param.customerId], csUomMap, item, adjustData, startInvs, endInvs, inbounds, outbounds, transferReceipts, transferOrders);
                data = _.union(data, lines);
            } else {
                let line = _getNormalBalance(balanceUom.valueMapping[param.customerId], csUomMap, item, adjustData, startInvs, endInvs, inbounds, outbounds, transferReceipts, transferOrders);
                data.push(line);
            }
        })

        resData.results.data = data;
        return resData;
    }

    return {
        searchByPaging
    };
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};