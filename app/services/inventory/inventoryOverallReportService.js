const _ = require('lodash');

let service = (app, ctx) => {
    let itemLevelReportHeader = ["Item ID", "Description", "Facility", "Title", "UOM", "Allocated", "Available", "Damaged", "Total", "LP Qty", "UPC", "CS UPC"];
    let lpLevelReportHeader = ["LP", "Item ID", "Description", "Location", "UOM", "Quantity", "LP Config", "Pallet TiHi", "Lot #", "Manufacture Date", "Expiration Date", "Shelf Life Days", "Inventory Status", "Document #", "PO #", "Ref #", "Date Received", "UPC"];
    let snLevelReportHeader = ["SN #", "Item ID", "Description", "Location", "UOM", "Title", "Lot #", "Manufacture Date", "Expiration Date", "Shelf Life Days", "Inventory Status", "Document #", "PO #", "Ref #", "Date Received", "UPC"];

    async function searchRawReportDataByPaging(criteria) {
        let inventoryStatusQtyViewPagingResult = await inventoryStatusReportService(ctx).searchInventoryViewByStatus(criteria, true); //criteria should be itemSpecIds, customerId
        let inventoryStatusQtyView = inventoryStatusQtyViewPagingResult.results;
        if (_.isEmpty(inventoryStatusQtyViewPagingResult) || _.isEmpty(inventoryStatusQtyView)) return {};

        let itemSpecIds = _.mapUniq(inventoryStatusQtyView, "itemSpecId");
        let unitIds = _.mapUniq(inventoryStatusQtyView, "unitId");
        let titleIds = _.mapUniq(inventoryStatusQtyView, "titleId");

        let inventories = await _getInventories({
                itemSpecIds: itemSpecIds,
                unitIds: unitIds,
                titleIds: titleIds
            }
        );
        if (_.isEmpty(inventories)) return {};

        let itemSpecMap = await itemSpecService(ctx).getItemSpecMap(itemSpecIds);
        let unitMap = await itemUnitService(ctx).getUnitMap(unitIds);
        let titleMap = await organizationService(ctx).getOrganizationMap(titleIds);
        let [itemLevelReportData, lpLevelReportData] = await Promise.all([
            _buildItemLevelReportData(inventoryStatusQtyView, inventories, itemSpecMap, unitMap, titleMap),
            _buildLPLevelReportData(inventories, itemSpecMap, unitMap, titleMap)]);

        return {
            itemLevelReportData: itemLevelReportData,
            lpLevelReportData: lpLevelReportData,
            paging: inventoryStatusQtyViewPagingResult.paging
        }
    }

    async function getPagingReportDataForView(criteria) {
        let rawReportPagingData = await searchRawReportDataByPaging(criteria);
        if (_.isEmpty(rawReportPagingData)) return {};
        let lpLevelReportData = rawReportPagingData.lpLevelReportData;
        let lpLevelReportGroup = _.groupBy(lpLevelReportData, i => i.itemSpecId + '|' + i.unitId + '|' + i.titleId);
        let snLevelReportGroup = _.groupBy(lpLevelReportData, i => i.itemSpecId + '|' + i.unitId + '|' + i.titleId + '|' + i.lpId);
        return {
            results: {
                data: rawReportPagingData.itemLevelReportData,
                head: itemLevelReportHeader
            },
            paging: rawReportPagingData.paging,
            lpLevelData: {
                dataGroup: lpLevelReportGroup,
                head: lpLevelReportHeader
            },
            snLevelData: {
                dataGroup: snLevelReportGroup,
                head: snLevelReportHeader
            }
        };
    }

    async function getAllPagesForDownload(criteria) {
        criteria.paging = {"limit": 1000, "pageNo": 1};
        let firstPage = await searchRawReportDataByPaging(criteria);
        let totalItemLevelData = firstPage.itemLevelReportData;
        let totalLpLevelData = firstPage.lpLevelReportData;
        let i = 2;
        while (i <= firstPage.paging.totalPage) {
            criteria.paging.pageNo = i;
            let nextResult = await searchRawReportDataByPaging(criteria);
            totalItemLevelData = _.union(totalItemLevelData, nextResult.itemLevelReportData);
            totalLpLevelData = _.union(totalLpLevelData, nextResult.lpLevelReportData);
            i++;
        }

        let reportDataList = [_buildItemLevelReportForDownload(totalItemLevelData), _buildLpLevelReport(totalLpLevelData), _buildSnLevelReport(totalLpLevelData)];
        return reportDataList;
    }

    async function _getInventories(searchCriteria) {
        if (_.isEmpty(searchCriteria)) return {};
        let inventories = await inventoryService(ctx).searchInventory(searchCriteria);
        return inventories;
    }

    function _buildItemLevelReportData(inventoryStatusQtyView, inventories, itemSpecMap, unitMap, titleMap) {
        let inventoryGroup = _.groupBy(inventories, i => i.itemSpecId + '|' + i.unitId + '|' + i.titleId);
        let reportData = [];
        _.each(inventoryStatusQtyView, inv => {
            let data = {};
            data.itemSpecId = inv.itemSpecId;
            data.unitId = inv.unitId;
            data.titleId = inv.titleId;
            data["Allocated"] = inv.allocatedQty;
            data["Available"] = inv.availableQty;
            data["Damaged"] = inv.damagedQty;
            data["Total"] = inv.totalQty;

            let allInventoryRecords = inventoryGroup[inv.itemSpecId + '|' + inv.unitId + '|' + inv.titleId];
            if (!_.isEmpty(allInventoryRecords)) {
                data["LP Qty"] = _.size(_.mapUniq(allInventoryRecords, "lpId"));
            }

            let itemSpec = itemSpecMap[inv.itemSpecId];
            if (!_.isEmpty(itemSpec)) {
                data["Item ID"] = itemSpec.name;
                data["Description"] = commonService(ctx).ensureNotNull(itemSpec.desc);
                data["Facility"] = _.upperFirst(_.split(app.conf.get('mySqlURI.wms.database'), '_')[0]);
                data["UPC"] = commonService(ctx).ensureNotNull(itemSpec.upcCode);
                data["CS UPC"] = commonService(ctx).ensureNotNull(itemSpec.upcCodeCase);
            }

            let unit = unitMap[inv.unitId];
            if (!_.isEmpty(unit)) {
                data["UOM"] = commonService(ctx).ensureNotNull(unit.name);
            }

            let title = titleMap[inv.titleId];
            if (!_.isEmpty(title)) {
                data["Title"] = commonService(ctx).ensureNotNull(title.name);
            }

            reportData.push(data);
        });
        return _.orderBy(reportData, "Item ID");
    }

    async function _buildLPLevelReportData(inventories, itemSpecMap, unitMap, titleMap) {
        //get lp,location,lp template config info
        let lpMap = await _getLpDetailMap(_.mapUniq(inventories, "lpId"));
        //get receipt and order info
        let documentMap = await _getReceiptOrderMap(_.union(_.mapUniq(inventories, "receiptId"), _.mapUniq(inventories, "orderId")));
        let reportData = [];
        for (let inv of inventories) {
            let data = {};
            data.itemSpecId = inv.itemSpecId;
            data.unitId = inv.unitId;
            data.titleId = commonService(ctx).ensureNotNull(inv.titleId);
            data.sn = inv.sn;
            data.lpId = inv.lpId;
            data["SN #"] = inv.sn;
            data["LP"] = commonService(ctx).ensureNotNull(inv.lpId);
            data["Location"] = lpMap[inv.lpId] ? lpMap[inv.lpId].locationName : "";
            data["Quantity"] = inv.qty ? inv.qty : 0;
            data["LP Config"] = lpMap[inv.lpId] ? lpMap[inv.lpId].configName : "";
            data["Pallet TiHi"] = lpMap[inv.lpId] ? lpMap[inv.lpId].tihi : "";
            data["Lot #"] = commonService(ctx).ensureNotNull(inv.lotNo);
            data["Manufacture Date"] = commonService(ctx).ensureNotNull(inv.mfgDate);
            data["Expiration Date"] = commonService(ctx).ensureNotNull(inv.expirationDate);
            data["Shelf Life Days"] = commonService(ctx).ensureNotNull(inv.shelfLifeDays);
            data["Inventory Status"] = await commonService(ctx).enumToWebFormat("InventoryStatus", inv.status);
            data["Document #"] = commonService(ctx).ensureNotNull(inv.receiptId ? inv.receiptId : inv.orderId);
            data["PO #"] = documentMap[data["Document #"]] ? documentMap[data["Document #"]].poNo : "";
            data["Ref #"] = documentMap[data["Document #"]] ? documentMap[data["Document #"]].referenceNo : "";
            data["Date Received"] = commonService(ctx).ensureNotNull(inv.receivedWhen);

            let itemSpec = itemSpecMap[inv.itemSpecId];
            if (!_.isEmpty(itemSpec)) {
                data["Item ID"] = itemSpec.name;
                data["Description"] = commonService(ctx).ensureNotNull(itemSpec.desc);
                data["UPC"] = commonService(ctx).ensureNotNull(itemSpec.upcCode);
            }

            let unit = unitMap[inv.unitId];
            if (!_.isEmpty(unit)) {
                data["UOM"] = commonService(ctx).ensureNotNull(unit.name);
            }

            let title = titleMap[inv.titleId];
            if (!_.isEmpty(title)) {
                data["Title"] = commonService(ctx).ensureNotNull(title.name);
            }
            reportData.push(data);
        }
        return _.orderBy(reportData, ["Item ID", "LP"]);
    }

    async function _getLpDetailMap(lpIds) {
        let lps = await getLpByIdWithLocationName(lpIds);
        await fillSingleLpTemplateInfoToLp(lps);
        return _.keyBy(lps, "id");
    }

    async function getLpByIdWithLocationName(lpIds) {
        if (_.isEmpty(lpIds)) return [];
        let lps = await inventoryService(ctx).searchLp({"lpIds": lpIds});
        if (_.isEmpty(lps)) return [];
        let locationIds = _.mapUniq(lps, "locationId");
        let locationMap = await locationService(ctx).getLocationMapById(locationIds);
        _.each(lps, lp => {
            lp.locationName = locationMap[lp.locationId] ? locationMap[lp.locationId].name : "";
        });
        return lps;
    }

    async function fillSingleLpTemplateInfoToLp(lps) {
        if (_.isEmpty(lps)) return;
        let confIds = _.mapUniq(lps, "confId");
        if (_.isEmpty(confIds)) return;
        let singleLpTemplates = await singleLpTemplateCollection(ctx).find({"_id": {$in: confIds}}).toArray();
        if (_.isEmpty(singleLpTemplates)) return;
        let singleLpTemplateMap = _.keyBy(singleLpTemplates, "_id");
        _.each(lps, lp => {
            if (_.isEmpty(lp.confId)) return;
            let template = singleLpTemplateMap[lp.confId];
            if (_.isEmpty(template)) return;
            lp.configName = template.name;
            lp.tihi = template.layer + 'X' + (template.totalQty / template.layer);
        })
    }

    async function _getReceiptOrderMap(ids) {
        if (_.isEmpty(ids)) return [];
        let receipts = await receiptCollection(ctx).query({_id: {$in: ids}}, {
            projection: {
                "poNo": 1,
                "referenceNo": 1
            }
        });
        let orders = await orderCollection(ctx).query({_id: {$in: ids}}, {projection: {"poNo": 1, "referenceNo": 1}});
        let documents = _.union(receipts, orders);
        return _.keyBy(documents, "_id");
    }

    function _buildItemLevelReportForDownload(totalItemLevelData) {
        return {
            results: {
                data: totalItemLevelData,
                head: itemLevelReportHeader,
                sheetName: "Item Level"
            }
        };
    }

    function _buildLpLevelReport(totalLpLevelData) {
        return {
            results: {
                data: totalLpLevelData,
                head: lpLevelReportHeader,
                sheetName: "LP Level"
            }
        };
    }

    function _buildSnLevelReport(totalLpLevelData) {
        return {
            results: {
                data: _.orderBy(totalLpLevelData, ["Item ID", "SN #"]),
                head: snLevelReportHeader,
                sheetName: "SN Level"
            }
        };
    }

    return {
        getPagingReportDataForView,
        getAllPagesForDownload
    }
};
module.exports = function (app) {
    return (ctx) => service(app, ctx);
};