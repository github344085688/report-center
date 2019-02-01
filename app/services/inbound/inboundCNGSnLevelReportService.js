const _ = require('lodash');
let service = (app, ctx) => {
    /*
    Search criteria example:
     {"customerId":"ORG-35162","receiptIds":["RN-15"],"receiptStatuses":["CANCELLED"],"akas":["000123"], "lotNos":["6035649"]}
     */
    async function searchByPagingForCNGSnLevel(criteria) {
        await _getItemSpecIdViaAka(criteria);
        let receipts = await inboundReportService(ctx).searchReceipts(criteria);
        let pagingResult = await inboundReportService(ctx).searchReceiptItemLineByPaging(criteria, receipts);
        if (_.isEmpty(pagingResult) || _.isEmpty(pagingResult.results)) return _buildEmptyReturn();

        await Promise.all([
            fillNecessayDataForReceiptItemLevel(pagingResult.results, receipts),
            _fillItemAKA(pagingResult.results),
            _fillLocation(pagingResult.results)
        ]);
        //expand by sn in snDetail in receiptItemLine
        let itemLineIdSnScanGroup = await _getSnScanGroup(pagingResult.results);
        let reportData = _buildReportData(pagingResult.results, receipts, itemLineIdSnScanGroup);
        return commonService(ctx).buildReportReturnBody(reportData, header, pagingResult.paging)
    }

    async function fillNecessayDataForReceiptItemLevel(receiptItemLines, receipts) {
        await Promise.all([
            _fillReceiptInfo(receiptItemLines, receipts),
            _fillOrgInfo(receiptItemLines),
            _fillCarrierInfo(receiptItemLines),
            _fillItemSpecInfo(receiptItemLines),
            _fillUOMInfo(receiptItemLines)
        ]);
    }

    async function _fillReceiptInfo(reports, receipts) {
        let receiptMap = _.keyBy(receipts, "_id");
        _.each(reports, function (o) {
            let receipt = receiptMap[o.receiptId];
            if (receipt) {
                o.createdWhen = commonService(ctx).formatTimeToMMDDYYYYHHMM(receipt.createdWhen);
                o.inYardTime = commonService(ctx).formatTimeToMMDDYYYYHHMM(receipt.inYardTime);
                o.devannedTime = commonService(ctx).formatTimeToMMDDYYYYHHMM(receipt.devannedTime);
                o.poNo = commonService(ctx).ensureNotNull(receipt.poNo);
                o.referenceNo = commonService(ctx).ensureNotNull(receipt.referenceNo);
                o.containerNo = commonService(ctx).ensureNotNull(receipt.containerNo);
                o.containerSize = commonService(ctx).ensureNotNull(receipt.containerSize);
                o.status = commonService(ctx).ensureNotNull(receipt.status);
                o.source = commonService(ctx).ensureNotNull(receipt.source);
                o.appointmentTime = commonService(ctx).formatTimeToMMDDYYYYHHMM(receipt.appointmentTime);
                o.customerId = commonService(ctx).ensureNotNull(receipt.customerId);
                o.titleId = commonService(ctx).ensureNotNull(receipt.titleId);
                o.carrierId = commonService(ctx).ensureNotNull(receipt.carrierId);
                o.note = commonService(ctx).ensureNotNull(receipt.note);
            }
        })
    }

    async function _fillOrgInfo(reports) {
        let supplierIds = _.uniq(_.filter(_.map(reports, "supplierId"), o => o !== null));
        let titleIds = _.uniq(_.filter(_.map(reports, "titleId"), o => o !== null));
        let carrierIds = _.uniq(_.filter(_.map(reports, "carrierId"), o => o !== null));
        let customerIds = _.uniq(_.filter(_.map(reports, "customerId"), o => o !== null));
        let orgIds = ensureNotNullBeforeSearch(_.union(supplierIds, customerIds, titleIds, carrierIds));
        let orgMap = await organizationService(ctx).getOrganizationBasicMap(orgIds);

        _.each(reports, function (o) {
            o.titleName = orgMap[o.titleId] ? commonService(ctx).ensureNotNull(orgMap[o.titleId].name) : "";
            o.customerName = orgMap[o.customerId] ? commonService(ctx).ensureNotNull(orgMap[o.customerId].name) : "";
            o.supplierName = orgMap[o.supplierId] ? commonService(ctx).ensureNotNull(orgMap[o.supplierId].name) : "";
        })
    }

    async function _fillCarrierInfo(reports) {
        let carrierIds = _.uniq(_.map(reports, "carrierId"));
        if (_.isEmpty(carrierIds)) return;
        let carrierMap = await carrierService(ctx).getCarrierMap(carrierIds);
        if (_.isEmpty(carrierMap)) return;

        _.each(reports, o => {
            let carrier = carrierMap[o.carrierId];
            if (!carrier) return;
            o.carrierName = carrier.name;
            o.scac = carrier.scac;
        });
    }

    async function _fillItemSpecInfo(reports) {
        let itemSpecIds = ensureNotNullBeforeSearch(_.uniq(_.map(reports, "itemSpecId")));
        let itemSpecMap = await itemSpecService(ctx).getItemSpecMap(itemSpecIds);
        _.each(reports, function (o) {
            let itemSpec = itemSpecMap[o.itemSpecId];
            if (!itemSpec) return;
            o.itemName = commonService(ctx).ensureNotNull(itemSpec.name);
            o.itemDesc = commonService(ctx).ensureNotNull(itemSpec.desc);
            o.shortDescription = commonService(ctx).ensureNotNull(itemSpec.shortDescription);
            o.grade = commonService(ctx).ensureNotNull(itemSpec.grade);
        })
    }

    async function _fillUOMInfo(reports) {
        let itemSpecIds = ensureNotNullBeforeSearch(_.uniq(_.map(reports, "itemSpecId")));
        let itemUnits = await itemUnitCollection(ctx).find({"itemSpecId": {$in: itemSpecIds}}).toArray();
        if (_.isEmpty(itemUnits)) return;
        let unitMap = _.keyBy(itemUnits, "_id");
        let csUnitMap = _.keyBy(_.filter(itemUnits, o => "CS" === o.name), "itemSpecId");

        _.each(reports, function (o) {
            o.qty = ensureQtyNotNull(o.qty);
            o.receivedQty = ensureQtyNotNull(o.receivedQty);

            let receivedUOM = unitMap[o.unitId];
            if (_.isEmpty(receivedUOM)) return;
            o.unitName = receivedUOM.name;
            // fill qty
            let csUOM = csUnitMap[o.itemSpecId];
            o.expectedQty = o.qty * receivedUOM.baseQty;
            if (!_.isEmpty(csUnitMap[o.itemSpecId])) {
                o.expectedCsQty = o.qty * receivedUOM.baseQty / csUOM.baseQty;
                o.receivedCsQty = o.receivedQty * receivedUOM.baseQty / csUOM.baseQty;
            }
            //fill cft
            let unitCft = itemUnitService(ctx).getCftByUOM(receivedUOM);
            let expectedTotalCft = o.qty * unitCft;
            let receivedTotalCft = o.receivedQty * unitCft;
            o.expectedCft = _.round(expectedTotalCft, 2);
            o.receivedCft = _.round(receivedTotalCft, 2);

            //fill weight
            let unitWeight = itemUnitService(ctx).getWeightByUOM(receivedUOM);
            o.expectedWeight = _.round(o.qty * unitWeight, 2);
            o.receivedWeight = _.round(o.receivedQty * unitWeight, 2);
        })
    }

    function ensureNotNullBeforeSearch(obj) {
        return _.isEmpty(obj) ? ["-1"] : obj;
    }

    function ensureQtyNotNull(qty) {
        return qty === null ? 0 : qty;
    }

    async function _getItemSpecIdViaAka(criteria) {
        if (criteria.akas && criteria.customerId) {
            let akas = await itemAkaCollection(ctx).find({
                "organizationId": criteria.customerId,
                "value": {$in: criteria.akas}
            }).toArray();
            if (!_.isEmpty(akas)) {
                criteria.itemSpecIds = _.uniq(_.map(akas, "itemSpecId"));
            }
        }
    }

    function _buildEmptyReturn() {
        return commonService(ctx).buildReportReturnBody([], header, {"totalPage": 2})
    }

    function _buildReportData(receiptItemLines, receipts, itemLineIdSnScanGroup) {
        let reportData = [];
        let receiptItemLineGroup = _.groupBy(receiptItemLines, "receiptId");
        _.each(receipts, receipt => {
            let itemLines = receiptItemLineGroup[receipt._id];
            let totalWeight = 0;
            if (!itemLines) return;
            _.each(itemLines, itemLine => {
                let snDetails = _getSnDetailFromSnScan(itemLine.snDetails, itemLineIdSnScanGroup, itemLine._id);
                snDetails = _.compact(snDetails);
                if (!_.isEmpty(snDetails)) {
                    _.each(snDetails, snEntity => {
                        totalWeight += snEntity.weight;
                        reportData.push({
                            "SN": snEntity.sn,
                            "Weight": snEntity.weight,
                            "TotalWeight": totalWeight,
                            "Customer #": itemLine.customerName,
                            "Receipt #": itemLine.receiptId,
                            "PO #": receipt.poNo,
                            "Ref.#": receipt.referenceNo,
                            "Receipt Status": receipt.status,
                            "Appointment Time": receipt.appointmentTime,
                            "In Yard Time": receipt.inYardTime,
                            "Devanned Time": receipt.devannedTime,
                            "Carrier": itemLine.carrierName,
                            "SCAC Code": itemLine.scac,
                            "Item ID": itemLine.itemName,
                            "Description": itemLine.itemDesc,
                            "Short Description": itemLine.shortDescription,
                            "AKA #": itemLine.akas,
                            "Grade": itemLine.grade,
                            "Title": itemLine.titleName,
                            "Supplier": itemLine.supplierName,
                            "Lot #": itemLine.lotNo,
                            "UOM": itemLine.unitName,
                            "Location": itemLine.locationName
                        })
                    })
                }
            })
        });
        return reportData;
    }

    function _getSnDetailFromSnScan(snDetails, itemLineIdSnScanGroup, itemLineId) {
        if (!_.isEmpty(snDetails)) return snDetails;
        let scanList = itemLineIdSnScanGroup[itemLineId.toString()];
        if (scanList) {
            return _.flatten(_.map(scanList, "snDetails"));
        }
        return [];
    }

    async function _getSnScanGroup(receiptItemLines) {
        if (_.isEmpty(receiptItemLines)) return;
        let itemLineIds = _.compact(_.uniq(_.map(receiptItemLines, itemLine => itemLine._id.toString())));
        let scans = await receiveSnScanCollection(ctx).find({"scanDetails.itemSNs.itemLineId": {$in: itemLineIds}}).toArray();
        if (_.isEmpty(scans)) return;
        let scanDetails = _.flatten(_.map(scans, "scanDetails"));
        if (_.isEmpty(scanDetails)) return;
        let itemSns = _.flatten(_.map(scanDetails, "itemSNs"));
        if (_.isEmpty(itemSns)) return;
        let matchedItemSns = _.filter(itemSns, i => _.includes(itemLineIds, i.itemLineId));
        if (_.isEmpty(matchedItemSns)) return;
        return _.groupBy(matchedItemSns, "itemLineId");
    }

    async function _fillItemAKA(receiptItemLines) {
        if (_.isEmpty(receiptItemLines)) return;
        let itemSpecIds = _.uniq(_.map(receiptItemLines, "itemSpecId"));
        if (_.isEmpty(itemSpecIds)) return;
        let itemAkas = await itemAkaCollection(ctx).query({"itemSpecId": {$in: itemSpecIds}});
        if (_.isEmpty(itemAkas)) return;
        let itemAkaGroup = _.groupBy(itemAkas, "itemSpecId");

        let itemAkaListMap = {};
        _.each(itemAkaGroup, (akaLists, itemSpecId) => {
            let akaValues = _.uniq(_.map(akaLists, "value"));
            itemAkaListMap[itemSpecId] = _.join(akaValues, ",");
        });

        _.each(receiptItemLines, itemLine => {
            let aka = itemAkaListMap[itemLine.itemSpecId];
            if (aka) {
                itemLine.akas = aka;
            } else {
                itemLine.akas = "";
            }
        });
    }

    async function _fillLocation(receiptItemLines) {
        let itemSpecIds = _.uniq(_.map(receiptItemLines, "itemSpecId"));
        let receiptIds = _.uniq(_.map(receiptItemLines, "receiptId"));
        let criteria = {
            "itemSpecIds": itemSpecIds,
            "receiptIds": receiptIds
        };
        let searchClause = inventoryService(ctx).buildInventorySearchClause(criteria);
        let inventories = await wmsMysql(ctx).query(`SELECT itemSpecId, receiptId, locationId FROM inventory LEFT JOIN lp on inventory.lpId = lp.id WHERE ${searchClause}`);
        let locationIds = _.compact(_.uniq(_.map(inventories, "locationId")));
        if (_.isEmpty(locationIds)) return;
        let locations = await locationCollection(ctx).query({"_id": {$in: locationIds}});
        if (_.isEmpty(locations)) return;
        let locationMap = _.keyBy(locations, "_id");

        _.each(inventories, inventory => {
            inventory.locationName = "";
            if (inventory.locationId) {
                let location = locationMap[inventory.locationId];
                if (!location) return;
                inventory.locationName = location.name;
            }
        });

        let inventoryLocationMap = _.keyBy(_.filter(inventories, i => !_.isEmpty(i.locationName)), i => i.itemSpecId + '-' + i.receiptId);

        _.each(receiptItemLines, itemLine => {
            let key = itemLine.itemSpecId + "-" + itemLine.receiptId;
            let inventory = inventoryLocationMap[key];
            if (inventory) {
                itemLine.locationName = inventory.locationName;
            } else {
                itemLine.locationName = "";
            }
        })
    }

    let header = [
        "SN",
        "Customer #",
        "Receipt #",
        "PO #",
        "Ref.#",
        "Receipt Status",
        "Appointment Time",
        "In Yard Time",
        "Devanned Time",
        "Carrier",
        "SCAC Code",
        "Item ID",
        "Description",
        "Short Description",
        "AKA #",
        "Grade",
        "Title",
        "Supplier",
        "Lot #",
        "UOM",
        "Weight",
        "TotalWeight",
        "Location"
    ];

    return {
        searchByPagingForCNGSnLevel
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
