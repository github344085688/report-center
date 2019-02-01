
let service = (app, ctx) => {

    function _batchAdjustStatus(adjustment, uomMap, itemCustomerMap, adjustRecords) {
        let updates = [];
        _.forEach(adjustment.updateInventoriesSnapshot, snapshot => {
            updates.push(JSON.parse(snapshot));
        })
        _.forEach(adjustment.newInventoriesSnapshot, snapshot => {
            updates.push(JSON.parse(snapshot));
        })

        _.forEach(updates, data => {
            adjustment.unitId = data.unitId;
            adjustment.itemSpecId = data.itemSpecId;
            adjustment.customerId = data.customerId;
            adjustment.titleId = data.titleId;
            adjustment.qty = data.qty;
            adjustment.lotNo = data.lotNo;
            let adjust = _adjustment(adjustment, itemCustomerMap);
            let uom = uomMap[adjust.unitId];
            if (!uom) return;

            if (adjust.adjustFrom === "DAMAGE") {
                adjust.adjustFromQty = 0;
                adjust.adjustToQty = adjust.qty ? adjust.qty * uom.baseQty : 0;
            } else if (adjust.adjustTo === "DAMAGE") {
                adjust.adjustFromQty = adjust.qty ? adjust.qty * uom.baseQty : 0;
                adjust.adjustToQty = 0;
            }
            adjust.adjustQty = adjust.adjustToQty - adjust.adjustFromQty;
            adjustRecords.push(adjust);
        })
    }

    function _adjustStatus(adjustment, uomMap, itemCustomerMap, adjustRecords) {
        if (adjustment.lpIds && adjustment.lpIds.length > 1) {
            _batchAdjustStatus(adjustment, uomMap, itemCustomerMap, adjustRecords);
            return;
        }
        let adjust = _adjustment(adjustment, itemCustomerMap);
        let uom = uomMap[adjust.unitId];
        if (!uom) return;

        if (adjust.adjustFrom === "DAMAGE") {
            adjust.adjustFromQty = 0;
            adjust.adjustToQty = adjust.qty ? adjust.qty * uom.baseQty : 0;
        } else if (adjust.adjustTo === "DAMAGE") {
            adjust.adjustFromQty = adjust.qty ? adjust.qty * uom.baseQty : 0;
            adjust.adjustToQty = 0;
        }
        adjust.adjustQty = adjust.adjustToQty - adjust.adjustFromQty;
        adjustRecords.push(adjust);
    }
    function _adjustQty(adjustment, uomMap, itemCustomerMap, adjustRecords) {
        let adjust = _adjustment(adjustment, itemCustomerMap);
        if (adjust.itemStatus === "DAMAGE") return;

        let uom = uomMap[adjust.unitId];
        if (!uom) return;

        adjust.adjustFromQty = adjust.adjustFrom ? parseInt(adjust.adjustFrom) * uom.baseQty : 0;
        adjust.adjustToQty = adjust.adjustTo ? parseInt(adjust.adjustTo) * uom.baseQty : 0;
        adjust.adjustQty = adjust.adjustToQty - adjust.adjustFromQty;
        adjustRecords.push(adjust);
    }
    function _addInventory(adjustment, uomMap, itemCustomerMap, adjustRecords) {
        let adjust = _adjustment(adjustment, itemCustomerMap);
        let uom = uomMap[adjust.unitId];
        if (!uom) return;

        adjust.adjustFromQty = 0;
        adjust.adjustToQty = adjust.qty ? adjust.qty * uom.baseQty : 0;
        adjust.adjustQty = adjust.adjustToQty - adjust.adjustFromQty;
        adjustRecords.push(adjust);
    }
    function _adjustItem(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords) {
        if (_.includes(itemSpecIds, adjustment.adjustFrom)) {
            adjustment.itemSpecId = adjustment.itemSpecId || adjustment.adjustFrom;
            let adjust = _adjustment(adjustment, itemCustomerMap);
            let uom = uomMap[adjust.unitId];
            if (!uom) return;

            adjust.adjustFromQty = adjust.qty ? adjust.qty * uom.baseQty : 0;
            adjust.adjustToQty = 0;
            adjust.adjustQty = adjust.adjustToQty - adjust.adjustFromQty;
            adjustRecords.push(adjust);
        }
        if (_.includes(itemSpecIds, adjustment.adjustTo)) {
            adjustment.itemSpecId = adjustment.adjustTo;
            adjustment.unitId = adjustment.adjustToUnit;
            let adjust = _adjustment(adjustment, itemCustomerMap);
            let uom = uomMap[adjust.unitId];
            if (!uom) return;

            adjust.adjustFromQty = 0;
            adjust.adjustToQty = adjust.qty ? adjust.qty * uom.baseQty : 0;
            adjust.adjustQty = adjust.adjustToQty - adjust.adjustFromQty;
            adjustRecords.push(adjust);
        }
    }
    function _adjustUom(adjustment, uomMap, itemCustomerMap, adjustRecords) {
        adjustment.unitId = adjustment.unitId || adjustment.adjustFrom;
        let adjust = _adjustment(adjustment, itemCustomerMap);
        let fromUom = uomMap[adjust.unitId];
        let toUom = uomMap[adjust.adjustTo];
        if (!fromUom || !toUom) return;

        adjust.adjustFromQty = adjust.qty ? adjust.qty * fromUom.baseQty : 0;
        adjust.adjustToQty = adjust.qty ? adjust.qty * toUom.baseQty : 0;
        adjust.adjustQty = adjust.adjustToQty - adjust.adjustFromQty;

        adjustRecords.push(adjust);
    }
    function _adjustCustomer(adjustment, uomMap, itemCustomerMap, adjustRecords) {
        let updates = [];
        _.forEach(adjustment.updateInventoriesSnapshot, snapshot => {
            updates.push(JSON.parse(snapshot));
        })
        _.forEach(adjustment.newInventoriesSnapshot, snapshot => {
            updates.push(JSON.parse(snapshot));
        })

        _.forEach(updates, data => {
            let uom = uomMap[data.unitId];
            if (!uom) return;

            adjustment.unitId = data.unitId;
            adjustment.itemSpecId = data.itemSpecId;
            adjustment.customerId = data.customerId;
            adjustment.titleId = data.titleId;
            adjustment.qty = data.qty;
            adjustment.lotNo = data.lotNo;

            let adjustFrom = _adjustment(adjustment, itemCustomerMap);
            adjustFrom.adjustFromQty = adjustFrom.qty ? adjustFrom.qty * uom.baseQty : 0;
            adjustFrom.adjustToQty = 0;
            adjustFrom.adjustQty = adjustFrom.adjustToQty - adjustFrom.adjustFromQty;
            adjustRecords.push(adjustFrom);

            adjustment.customerId = adjustment.adjustTo;
            let adjustTo = _adjustment(adjustment, itemCustomerMap);
            adjustTo.adjustFromQty = 0;
            adjustTo.adjustToQty = adjustTo.qty ? adjustTo.qty * uom.baseQty : 0;
            adjustTo.adjustQty = adjustTo.adjustToQty - adjustTo.adjustFromQty;
            adjustRecords.push(adjustTo);
        })
    }
    function _adjustTitle(adjustment, uomMap, itemCustomerMap, adjustRecords) {
        let updates = [];
        _.forEach(adjustment.updateInventoriesSnapshot, snapshot => {
            updates.push(JSON.parse(snapshot));
        })
        _.forEach(adjustment.newInventoriesSnapshot, snapshot => {
            updates.push(JSON.parse(snapshot));
        })

        _.forEach(updates, data => {
            let uom = uomMap[data.unitId];
            if (!uom) return;

            adjustment.unitId = data.unitId;
            adjustment.itemSpecId = data.itemSpecId;
            adjustment.customerId = data.customerId;
            adjustment.titleId = data.titleId;
            adjustment.qty = data.qty;
            adjustment.lotNo = data.lotNo;

            let adjustFrom = _adjustment(adjustment, itemCustomerMap);
            adjustFrom.adjustFromQty = adjustFrom.qty ? adjustFrom.qty * uom.baseQty : 0;
            adjustFrom.adjustToQty = 0;
            adjustFrom.adjustQty = adjustFrom.adjustToQty - adjustFrom.adjustFromQty;
            adjustRecords.push(adjustFrom);

            adjustment.titleId = adjustment.adjustTo;
            let adjustTo = _adjustment(adjustment, itemCustomerMap);
            adjustTo.adjustFromQty = 0;
            adjustTo.adjustToQty = adjustTo.qty ? adjustTo.qty * uom.baseQty : 0;
            adjustTo.adjustQty = adjustTo.adjustToQty - adjustTo.adjustFromQty;
            adjustRecords.push(adjustTo);
        })
    }

    function _adjustLocation(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords) {
        
    }
    function _adjustLP(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords) {
        
    }
    function _adjustLotNo(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords) {
        let updates = [];
        _.forEach(adjustment.updateInventoriesSnapshot, snapshot => {
            updates.push(JSON.parse(snapshot));
        })
        _.forEach(adjustment.newInventoriesSnapshot, snapshot => {
            updates.push(JSON.parse(snapshot));
        })

        _.forEach(updates, data => {
            let uom = uomMap[data.unitId];
            if (!uom) return;

            adjustment.unitId = data.unitId;
            adjustment.itemSpecId = data.itemSpecId;
            adjustment.customerId = data.customerId;
            adjustment.titleId = data.titleId;
            adjustment.qty = data.qty;
            adjustment.lotNo = data.lotNo;

            let adjustFrom = _adjustment(adjustment, itemCustomerMap);
            adjustFrom.adjustFromQty = adjustFrom.qty ? adjustFrom.qty * uom.baseQty : 0;
            adjustFrom.adjustToQty = 0;
            adjustFrom.adjustQty = adjustFrom.adjustToQty - adjustFrom.adjustFromQty;
            adjustRecords.push(adjustFrom);

            adjustment.lotNo = adjustment.adjustTo;
            let adjustTo = _adjustment(adjustment, itemCustomerMap);
            adjustTo.adjustFromQty = 0;
            adjustTo.adjustToQty = adjustTo.qty ? adjustTo.qty * uom.baseQty : 0;
            adjustTo.adjustQty = adjustTo.adjustToQty - adjustTo.adjustFromQty;
            adjustRecords.push(adjustTo);
        })
    }
    function _adjustExpirationDate(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords) {
        
    }
    function _adjustMfgDate(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords) {

    }
    function _adjustShelfLifeDays(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords) {

    }
    function _adjustSN(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords) {

    }
    
    function _getAdjustItemSpecId(adjustment) {
        if (adjustment.itemSpecId) return adjustment.itemSpecId;
        if (adjustment.updateInventoriesSnapshot) {
            let updates = [];
            _.forEach(adjustment.updateInventoriesSnapshot, snapshot => {
                updates.push(JSON.parse(snapshot));
            })
            let itemSpecIds = _.compact(_.uniq(_.map(updates, "itemSpecId")));

            if (itemSpecIds && itemSpecIds.length === 1) return itemSpecIds[0];
        }
        return null;
    }
    function _getAdjustUnitId(adjustment) {
        if (adjustment.unitId) return adjustment.unitId;
        if (adjustment.updateInventoriesSnapshot) {
            let updates = [];
            _.forEach(adjustment.updateInventoriesSnapshot, snapshot => {
                updates.push(JSON.parse(snapshot));
            })
            let unitIds = _.compact(_.uniq(_.map(updates, "unitId")));

            if (unitIds && unitIds.length === 1) return unitIds[0];
        }
        return null;
    }
    function _getAdjustTitleId(adjustment) {
        if (adjustment.titleId) return adjustment.titleId;
        if (adjustment.updateInventoriesSnapshot) {
            let updates = [];
            _.forEach(adjustment.updateInventoriesSnapshot, snapshot => {
                updates.push(JSON.parse(snapshot));
            })
            let titleIds = _.compact(_.uniq(_.map(updates, "titleId")));

            if (titleIds && titleIds.length === 1) return titleIds[0];
        }
        return null;
    }
    function _getAdjustLotNo(adjustment) {
        if (adjustment.lotNo) return adjustment.lotNo;

        if (adjustment.updateInventoriesSnapshot) {
            let lotNos = [];
            _.forEach(adjustment.updateInventoriesSnapshot, snapshot => {
                let data = JSON.parse(snapshot);
                if (data.lotNo) {
                    lotNos.push(data.lotNo);
                }
            });
            lotNos = _.compact(_.uniq(lotNos));
            if (lotNos && lotNos.length > 0) return lotNos[0];
        }
        return null;
    }
    function _adjustment(adjustment, itemCustomerMap) {
        let itemSpecId = _getAdjustItemSpecId(adjustment);
        let customer = itemCustomerMap[itemSpecId];
        let unitId = _getAdjustUnitId(adjustment);
        let lotNo = _getAdjustLotNo(adjustment);
        let titleId = _getAdjustTitleId(adjustment);
        return {
            id: adjustment._id,
            itemSpecId: itemSpecId,
            unitId: unitId,
            qty: adjustment.qty,
            titleId: titleId,
            customerId: adjustment.customerId ? adjustment.customerId : (customer ? customer.customerId : ""),
            adjustFrom: adjustment.adjustFrom,
            adjustTo: adjustment.adjustTo,
            type: adjustment.type,
            lotNo: lotNo,
            createdBy: adjustment.createdBy,
            createdWhen: momentZone(adjustment.createdWhen).format('YYYY-MM-DD HH:mm:ss'),
            approveBy: adjustment.approveBy,
            approveWhen: momentZone(adjustment.approveWhen).format('YYYY-MM-DD HH:mm:ss')
        }
    }

    async function _getAdjustments(types, timeFrom, timeTo, adjustReasons) {
        let adjustmentSearch = new AdjustmentSearch({
            progress: "COMPLETE",
            types: types,
            approveFrom: timeFrom,
            approveTo: timeTo,
            reasons: adjustReasons
        });
        let option = adjustmentSearch.buildClause();
        return await adjustmentCollection(ctx).query(option);
    }

    async function getAdjustmentReportByItemSpecIds(itemSpecIds, types, timeFrom, timeTo, adjustReasons) {
        if (!itemSpecIds || itemSpecIds.length === 0) return [];

        ctx.cached = ctx.cached || {};
        let adjustments = ctx.cached.adjustments || [];
        if (!adjustments || adjustments.length === 0) {
            adjustments = await _getAdjustments(types, timeFrom, timeTo, adjustReasons);
            ctx.cached.adjustments = adjustments;
        }

        let items = await itemSpecCollection(ctx).query({_id:{$in:itemSpecIds}},{projection:{customerId:1}});
        let itemCustomerMap = _.keyBy(items, "_id");
        let units = await itemUnitCollection(ctx).query({itemSpecId:{$in:itemSpecIds}},{projection:{itemSpecId:1,baseQty:1}});
        let uomMap = _.keyBy(units, "_id");

        let adjustRecords = [];
        _.forEach(adjustments, adjustment => {
            if (adjustment.type === "ADJUST_STATUS") {
                _adjustStatus(adjustment, uomMap, itemCustomerMap, adjustRecords);

            } else if (adjustment.type === "ADJUST_QTY") {
                _adjustQty(adjustment, uomMap, itemCustomerMap, adjustRecords);

            } else if (adjustment.type === "ADD_INVENTORY") {
                _addInventory(adjustment, uomMap, itemCustomerMap, adjustRecords);

            } else if (adjustment.type === "ADJUST_ITEM") {
                _adjustItem(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords);

            } else if (adjustment.type === "ADJUST_UOM") {
                _adjustUom(adjustment, uomMap, itemCustomerMap, adjustRecords);

            } else if (adjustment.type === "ADJUST_CUSTOMER") {
                _adjustCustomer(adjustment, uomMap, itemCustomerMap, adjustRecords);

            } else if (adjustment.type === "ADJUST_TITLE") {
                _adjustTitle(adjustment, uomMap, itemCustomerMap, adjustRecords);

            } else if (adjustment.type === "ADJUST_LOCATION") {
                _adjustLocation(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords);

            } else if (adjustment.type === "ADJUST_LP") {
                _adjustLP(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords)

            } else if (adjustment.type === "ADJUST_LOTNO") {
                _adjustLotNo(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords)

            } else if (adjustment.type === "ADJUST_EXPIRATIONDATE") {
                _adjustExpirationDate(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords)

            } else if (adjustment.type === "ADJUST_MFGDATE") {
                _adjustMfgDate(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords)

            } else if (adjustment.type === "ADJUST_SHELFLIFEDAYS") {
                _adjustShelfLifeDays(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords)

            } else if (adjustment.type === "ADJUST_SN") {
                _adjustSN(adjustment, uomMap, itemCustomerMap, itemSpecIds, adjustRecords)

            }
        })
        return adjustRecords;
    }

    async function getAdjustmentReportByCustomerId(customerId, types, timeFrom, timeTo) {
        if (!customerId) return [];

        let items = await itemSpecCollection(ctx).query({customerId:customerId},{projection:{_id:1}});
        let itemSpecIds = _.keyBy(items, "_id");

        return await getAdjustmentReportByItemSpecIds(itemSpecIds, types, timeFrom, timeTo);
    }

    async function getReport(param) {
        if (!param.customerId && !param.itemSpecIds) return [];

        let itemSpecIds = param.itemSpecIds || [];
        if (param.customerId) {
            let items = await itemSpecCollection(ctx).query({customerId:param.customerId},{projection:{_id:1}});
            let customerItemSpecIds = _.map(items, "_id");
            itemSpecIds = itemSpecIds.length === 0 ? customerItemSpecIds : _.intersection(itemSpecIds, customerItemSpecIds);
        }

        return await getAdjustmentReportByItemSpecIds(itemSpecIds, param.types, param.timeFrom, param.timeTo);
    }

    class AdjustmentSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                progress: new MongoOperator('$eq', 'progress'),
                types: new MongoOperator('$in', 'type'),
                approveFrom: new MongoOperator('$gte', 'approveWhen', 'Date'),
                approveTo: new MongoOperator('$lte', 'approveWhen', 'Date'),
                reasons: new MongoOperator('$in', 'reason')
            };
        }
    }

    return {
        getAdjustmentReportByItemSpecIds,
        getAdjustmentReportByCustomerId,
        getReport
    };
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};