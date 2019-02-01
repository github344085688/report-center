let service = (app, ctx) => {

    async function getNoInventoryItems(criteria, data, resInvs, facility) {
        if (!criteria.includeZero) return;

        let inventoryStatusSearch = new InventoryStatusSearch(criteria);
        let criteriaClause = inventoryStatusSearch.buildClause();

        let clause = {customerId: criteria.customerId, status: "ACTIVE", tags: "PRODUCT"};
        if (!_.isEmpty(criteria.itemSpecIds)) {
            clause._id = {$in: criteria.itemSpecIds};
        }
        let items = await itemSpecCollection(ctx).query(clause, {projection: {name: 1, desc: 1, shortDescription: 1}});
        let sql = `select distinct itemSpecId from inventory where ${criteriaClause}`;
        let invs = await wmsMysql(ctx).query(sql);
        let invItems = _.map(invs, "itemSpecId");

        let noInventoryItems = [];
        _.forEach(items, item => {
            if (_.includes(invItems, item._id)) return;

            noInventoryItems.push({
                "Item ID": item.name,
                "Short Description": item.shortDescription || "",
                "Description": item.desc || "",
                "UOM": "",
                "Units/pkg": 0,
                "Title": "",
                "Facility": facility,
                "Available": 0,
                "Allocated": 0,
                "Damaged": 0,
                "Hold": 0,
                "On Hand": 0,
                "Incoming": 0,
                "Open Order": 0,
                "Total": 0
            })
        })
        if (_.isEmpty(noInventoryItems)) return;

        let totalCount = resInvs.paging.totalCount + noInventoryItems.length;
        let limit = resInvs.paging.limit;
        let totalPage = totalCount / limit;
        if (totalCount % limit > 0) {
            totalPage = totalPage + 1;
        }
        let pageNo = resInvs.paging.pageNo;
        let startIndex = (pageNo - 1) * limit;

        if (data.length < limit) {
            let index = startIndex > resInvs.paging.totalCount ? startIndex - resInvs.paging.totalCount : 0;
            let end = startIndex > resInvs.paging.totalCount ? index + limit : limit - data.length;
            end = end > noInventoryItems.length ? noInventoryItems.length : end;

            for (; index < end; index++) {
                data.push(noInventoryItems[index]);
            }
        }

        resInvs.paging.totalCount = totalCount;
        resInvs.paging.totalPage = Math.floor(totalPage);
        resInvs.paging.endIndex = _.min([startIndex + limit, totalCount]);
        return data;
    }

    async function searchByPaging(criteria) {
        let facility = _.upperFirst(_.split(app.conf.get('mySqlURI.wms.database'), '_')[0]);
        let extraColumns = criteria.extraColumns || [];
        _.unset(criteria, "extraColumns");

        let customerId = criteria.customerId || '';
        if (_.isEmpty(customerId)) {
            throw new BadRequestError('CustomerId can\'t be empty.');
        }

        if (criteria.itemSpecId && !_.isEmpty(criteria.itemSpecId)) {
            criteria.itemSpecIds = [criteria.itemSpecId];
        }
        let [invs, openOrders, incomingReceipts, itemPkgUnitRelations] = await Promise.all([
            searchInventoryViewByStatus(criteria, true),
            orderCollection(ctx).find({status: {$in: ['IMPORTED', 'OPEN']}, customerId: customerId}).toArray(),
            receiptCollection(ctx).find({
                status: {$in: ['IMPORTED', 'OPEN', 'APPOINTMENT_MADE', 'IN_YARD']},
                customerId: customerId
            }).toArray(),
            await itemUnitPickTypeCollection(ctx).find({}).toArray()
        ]);

        let openOrderIds = _.map(openOrders, "_id");
        let incomingReceiptIds = _.map(incomingReceipts, "_id");
        let [openOrderItemLines, incomingReceiptItemLines] = await Promise.all([
            _.isEmpty(openOrderIds) ? [] : await orderItemLineCollection(ctx).find({orderId: {$in: openOrderIds}}).toArray(),
            _.isEmpty(incomingReceiptIds) ? [] : await receiptItemLineCollection(ctx).find({receiptId: {$in: incomingReceiptIds}}).toArray()
        ]);

        let openOrderItemLineKeyQtyMap = _sumQty(_.groupBy(openOrderItemLines, _buildKey));
        let incomingReceiptMap = _.keyBy(incomingReceipts, "_id");
        _.forEach(incomingReceiptItemLines, itemLine => {
            itemLine["titleId"] = incomingReceiptMap[itemLine.receiptId].titleId;
        });
        let incomingReceiptItemLineKeyQtyMap = _sumQty(_.groupBy(incomingReceiptItemLines, _buildKey));

        let orgIds = _.compact(_.union(_.map(invs.results, "titleId"), _.map(openOrderItemLines, "titleId")), _.map(incomingReceipts, "titleId"));
        let itemSpecIds = _.compact(_.union(_.map(invs.results, "itemSpecId"), _.map(openOrderItemLines, "itemSpecId"), _.map(incomingReceiptItemLines, "itemSpecId")));
        let unitIds = _.compact(_.union(_.map(invs.results, "unitId"), _.map(openOrderItemLines, "unitId"), _.map(incomingReceiptItemLines, "unitId")));

        let itemPkgUnitNames = _.map(itemPkgUnitRelations, "referenceUnit");
        let [orgMap, itemSpecMap, unitMap, itemPkgUnits] = await Promise.all([
            organizationService(ctx).getOrganizationMap(orgIds),
            itemSpecService(ctx).getItemSpecMap(itemSpecIds),
            itemUnitService(ctx).getUnitMap(unitIds),
            await itemUnitCollection(ctx).find({
                itemSpecId: {$in: itemSpecIds},
                name: {$in: itemPkgUnitNames}
            }).toArray()
        ]);

        let itemPkgUnitRelationMap = _.keyBy(itemPkgUnitRelations, "name");
        let itemPkgUnitKeyMap = _.keyBy(itemPkgUnits, _buildItemUnitKey);

        await allocatedOverEAToLargeUom(invs.results, criteria);
        let makePalletAdjustments = await _getMakePalletAdjustmentMapByItem(customerId, itemSpecIds);

        let data = [];
        for (let inv of invs.results) {
            let unit = unitMap[inv.unitId];

            if (makePalletAdjustments[inv.itemSpecId] && makePalletAdjustments[inv.itemSpecId][inv.titleId]) {
                let makePalletQty = makePalletAdjustments[inv.itemSpecId][inv.titleId];
                inv.totalQty = inv.totalQty - makePalletQty;
                inv.availableQty = inv.availableQty - makePalletQty;
            }
            if (!criteria.includeLtZero) {
                inv.totalQty = inv.totalQty > 0 ? inv.totalQty : 0;
                inv.availableQty = inv.availableQty > 0 ? inv.availableQty : 0;
            }
            if (inv.totalQty === 0 && !criteria.includeZero) continue;
            if (inv.totalQty < 0 && !criteria.includeLtZero) continue;

            data.push(_buildRow(inv, facility, unit, itemSpecMap, orgMap, openOrderItemLineKeyQtyMap, incomingReceiptItemLineKeyQtyMap, itemPkgUnitRelationMap, itemPkgUnitKeyMap, extraColumns));
        }

        await getNoInventoryItems(criteria, data, invs, facility);
        return {
            results: {
                data: data,
                head: _buildHead(extraColumns)
            },
            paging: invs.paging
        };
    }

    async function _getMakePalletAdjustmentMapByItem(customerId, itemSpecIds) {
        let orgMap = await organizationService(ctx).getOrganizationMap([customerId]);
        let customer = orgMap[customerId];
        if (!customer.inventoryReportExcludeMakePalletAdjustRecord) return {};

        let adjustTypes = ["ADJUST_QTY", "ADD_INVENTORY", "ADJUST_SN", "ADJUST_STATUS"];
        let adjustReasons = ["MP"];
        let adjustments = await adjustmentReportService(ctx).getAdjustmentReportByItemSpecIds(itemSpecIds, adjustTypes, null, null, adjustReasons);
        let adjustMap = _.groupBy(adjustments, "itemSpecId");

        let adjustRes = {};
        _.forEach(adjustMap, (adjusts, itemSpecId) => {
            let adjustTitleMap = _.groupBy(adjusts, "titleId");
            adjustRes[itemSpecId] = adjustRes[itemSpecId] || {};
            _.forEach(adjustTitleMap, (titleAdjusts, titleId) => {
                adjustRes[itemSpecId][titleId] = _.sumBy(titleAdjusts, "adjustQty");
            })
        })

        return adjustRes;
    }

    function _buildItemUnitKey(unit) {
        return `${unit.itemSpecId}|${unit.name}`;
    }

    async function allocatedOverEAToLargeUom(invs, criteria) {
        if (_.isEmpty(invs)) return;

        let itemSpecIds = _.uniq(_.map(invs, "itemSpecId"));

        let criteriaCopy = _.cloneDeep(criteria);
        _.unset(criteriaCopy, "paging");
        criteriaCopy.itemSpecIds = itemSpecIds;
        let itemInventories = await searchInventoryViewByStatus(criteriaCopy);
        let availableQtyLessThanZeroInvs = _.filter(itemInventories, o => o.availableQty && o.availableQty < 0);
        if (_.isEmpty(availableQtyLessThanZeroInvs)) return;

        let unitIds = _.uniq(_.map(itemInventories, "unitId"));
        let unitMap = await itemUnitService(ctx).getUnitMap(unitIds);

        let negativeQtyKeys = [];
        _.forEach(availableQtyLessThanZeroInvs, o => negativeQtyKeys.push(_buildItemTitleKey(o)));
        let itemInventoryGroup = _.groupBy(_.filter(itemInventories, o => _.includes(negativeQtyKeys, _buildItemTitleKey(o))), _buildItemTitleKey);
        _.forEach(availableQtyLessThanZeroInvs, o => {
            let overEAQty = Math.abs(o.availableQty);
            let allocatedQty = o.allocatedQty;
            let itemTitleKey = _buildItemTitleKey(o);
            let sameItems = itemInventoryGroup[itemTitleKey];
            sameItems = _.orderBy(sameItems, i => unitMap[i.unitId].baseQty, ['desc']);

            for (let item of sameItems) {
                if (overEAQty <= 0) break;
                if (item.availableQty <= 0) continue;

                let unit = unitMap[item.unitId];
                let remainQty = overEAQty % unit.baseQty;
                let itemQty = Math.floor(overEAQty / unit.baseQty);
                if (itemQty >= item.availableQty) {
                    item.availableQty = 0;
                    item.allocatedQty += item.availableQty;
                    overEAQty -= item.availableQty * unit.baseQty;
                    o.allocatedQty -= item.availableQty * unit.baseQty;

                    continue;
                } else {
                    item.availableQty -= itemQty;
                    item.allocatedQty += itemQty;
                    overEAQty -= itemQty * unit.baseQty;
                    o.allocatedQty -= itemQty * unit.baseQty;

                    if (remainQty > 0) {
                        item.availableQty -= 1;
                        item.totalQty -= 1;
                        o.totalQty += unit.baseQty;
                        o.availableQty = o.totalQty - o.allocatedQty;
                        overEAQty -= remainQty;
                    }
                }
            }

            let negativeQtyItemKey = _buildKey(o);
            let items = _.filter(sameItems, i => _buildKey(i) === negativeQtyItemKey);
            let item = _.first(items);
            item.totalQty = o.totalQty;
            item.availableQty = o.availableQty;
            item.allocatedQty = o.allocatedQty;
        });

        let invsGroup = _.groupBy(invs, _buildItemTitleKey);
        _.forEach(itemInventoryGroup, (itemInvs, itemTitleKey) => {
            _.forEach(itemInvs, item => {
                let invs = invsGroup[itemTitleKey];
                let inv = _.first(_.filter(invs, i => i.unitId === item.unitId));
                if (inv) {
                    inv.totalQty = item.totalQty;
                    inv.availableQty = item.availableQty;
                    inv.allocatedQty = item.allocatedQty;

                    if (inv.availableQty < 0) {
                        inv.allocatedQty += inv.availableQty;
                        inv.availableQty = 0;
                    }
                }
            });
        });
    }

    function _buildItemTitleKey(inv) {
        return `${inv.itemSpecId}|${inv.titleId}`;
    }

    async function searchInventoryViewByStatus(criteria, searchByPaging) {
        let inventoryStatusSearch = new InventoryStatusSearch(criteria);
        let criteriaClause = inventoryStatusSearch.buildClause();
        criteriaClause = _.isEmpty(criteriaClause) ? "" : " And " + criteriaClause;

        let sql = `SELECT itemSpecId, unitId, titleId, allocatedQty, availableQty, damagedQty, holdQty, totalQty
                           FROM view_inventory_item_customer_unit_title_status
                          WHERE 1=1 ${criteriaClause}
                       ORDER BY itemSpecId, unitId, titleId`;


        let invs = searchByPaging ? await wmsMysql(ctx).queryByPaging(sql) : await wmsMysql(ctx).query(sql);

        return invs;
    }

    function _buildRow(inv, facility, unit, itemSpecMap, orgMap, openOrderItemLineKeyQtyMap, incomingReceiptItemLineKeyQtyMap, itemPkgUnitRelationMap, itemPkgUnitKeyMap, extraColumns) {
        let key = _buildKey(inv);
        let itemSpec = itemSpecMap[inv.itemSpecId] || {};

        let row = {
            "Item ID": itemSpec.name,
            "Short Description": itemSpec.shortDescription,
            "Description": itemSpec.desc,
            "UOM": unit.name,
            "Units/pkg": _unitPerPkg(unit, itemPkgUnitRelationMap, itemPkgUnitKeyMap),
            "Title": orgMap[inv.titleId] ? orgMap[inv.titleId].name : '',
            "Facility": facility,
            "Available": inv.availableQty,
            "Allocated": inv.allocatedQty,
            "Damaged": inv.damagedQty,
            "Hold": inv.holdQty,
            "On Hand": inv.totalQty - inv.holdQty - inv.damagedQty,
            "Incoming": incomingReceiptItemLineKeyQtyMap[key] || 0,
            "Open Order": openOrderItemLineKeyQtyMap[key] || 0,
            "Total": inv.totalQty
        };

        return _addDynamicColumn(row, inv, itemSpec, unit, extraColumns);
    }

    function _buildKey(inv) {
        return `${inv.itemSpecId}|${inv.unitId}|${inv.titleId}`;
    }

    function _unitPerPkg(unit, itemPkgUnitRelationMap, itemPkgUnitKeyMap) {
        let unitPkgUnitName = itemPkgUnitRelationMap[unit.name] ? itemPkgUnitRelationMap[unit.name].referenceUnit : null;
        let pkgUnitKey = `${unit.itemSpecId}|${unitPkgUnitName}`;
        let pkgUnit = itemPkgUnitKeyMap[pkgUnitKey] || {};

        return (pkgUnit.baseQty || unit.baseQty) / unit.baseQty;
    }

    function _sumQty(itemLineGroup) {
        _.forEach(itemLineGroup, (v, k) => {
            itemLineGroup[k] = _.sumBy(v, "qty");
        });

        return itemLineGroup;
    }

    function _addDynamicColumn(row, inv, itemSpec, unit, extraColumns) {
        _.forEach(extraColumns, column => {
            switch (column) {
                case "Unit Price":
                    _.set(row, "Unit Price", _getUnitPrice(unit));
                    break;
                case "Total Value":
                    _.set(row, "Total Value", _getTotalValue(inv.totalQty, unit));
                    break;
                case "Customer Item ID":
                    _.set(row, "Customer Item ID", itemSpec.desc || itemSpec.shortDescription);
                    break;
            }
        });

        return row;
    }

    function _getUnitPrice(unit) {
        if (_.isEmpty(unit)) return "";

        return _.isEmpty(unit.price) ? "" : unit.price + "(" + unit.priceUnit + ")";
    }

    function _getTotalValue(totalQty, unit) {
        if (_.isEmpty(unit) || _.isEmpty(unit.price)) return "";

        return totalQty * unit.price + "(" + unit.priceUnit + ")";
    }

    function _buildHead(extraColumns) {
        let head = [
            "Item ID",
            "Short Description",
            "Description",
            "UOM",
            "Units/pkg",
            "Title",
            "Facility",
            "Available",
            "Allocated",
            "Damaged",
            "Hold",
            "On Hand",
            "Incoming",
            "Open Order",
            "Total"
        ];

        return _addDynamicHead(head, extraColumns);
    }

    function _addDynamicHead(head, extraColumns) {
        _.forEach(extraColumns, column => {
            switch (column) {
                case "Unit Price":
                    head.push("Unit Price");
                    break;
                case "Total Value":
                    head.push("Total Value");
                    break;
                case "Customer Item ID":
                    head.push("Customer Item ID");
                    break;
            }
        });

        return head;
    }

    function _buildKey(inv) {
        return `${inv.itemSpecId}|${inv.unitId}|${inv.titleId}`;
    }

    class InventoryStatusSearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                itemSpecIds: new DBOperator('IN', 'itemSpecId'),
                customerId: new DBOperator('=', 'customerId')
            };
        }
    }

    return {
        searchByPaging,
        allocatedOverEAToLargeUom,
        searchInventoryViewByStatus
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
