const _ = require('lodash');

let service = (app, ctx) => {
    async function inquiryReportSearchByPaging(criteria) {
        let pagingResult = await _searchReceiptByPaging(criteria);
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["generalLevelFieldMappings"], inboundReportResolver(ctx).resolveInboundFields);
    }

    async function itemLevelInquiryReportSearchByPaging(criteria) {
        let pagingResult = await _searchReceiptItemLineByPaging(criteria);
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["detailLevelFieldMappings"], inboundReportResolver(ctx).resolveInboundFields);
    }

    /*
     only apply to those item with Serial Number, and cutomer provide SN on RN
     */
    async function idLevelInquiryReportSearchByPaging(criteria) {
        let pagingResult = await _searchSnLevelInventoryWithOriginalLpByPaging(criteria);
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["idLevelFieldMappings"], inboundReportResolver(ctx).resolveInboundFields);
    }

    async function _searchSnLevelInventoryWithOriginalLpByPaging(criteria) {
        let pagingResult = {paging: criteria.paging, results: []};
        let receiptItemLineWithCustomerProvidedSN = await _searchReceiptItemLineWithCustomerProvidedSN(criteria);
        if (!_.isEmpty(receiptItemLineWithCustomerProvidedSN)) {
            pagingResult = await inventoryStatusReportServiceV2(ctx).searchInventoryByPaging({
                "receiptIds": _.mapUniq(receiptItemLineWithCustomerProvidedSN, "receiptId"),
                "itemSpecIds": _.mapUniq(receiptItemLineWithCustomerProvidedSN, "itemSpecId"),
                "snNotNull": true
            });
            await _fillLpIdFromReceiptLpSetup(pagingResult.results, receiptItemLineWithCustomerProvidedSN);
        }
        return pagingResult;
    }

    async function _searchReceiptItemLineWithCustomerProvidedSN(criteria) {
        await _buildCriteriaByKeyword(criteria);
        criteria.snDetailsNotNull = true;
        return await receiptItemLineService(ctx).aggregateSearchReceiptItemLine(criteria);
    }

    async function _fillLpIdFromReceiptLpSetup(inventories, providedSNReceiptItemLines) {
        if (_.isEmpty(inventories)) return;
        //get receipt itemline by receiptId and itemSpecId, then fill receiptItemLineId to inventory
        let itemLineMap = _.keyBy(providedSNReceiptItemLines, o => `${o.receiptId}|${o.itemSpecId}`);

        _.each(inventories, i => {
            let key = `${i.receiptId}|${i.itemSpecId}`;
            let itemLine = itemLineMap[key];
            i.receiptItemLineId = itemLine ? itemLine._id.toString() : "";
        });
        //get lp setup info by receiptId
        let results = await receiptLpSetupCollection(ctx).find({"lpDetails.receiptId": {$in: _.mapUniq(providedSNReceiptItemLines, "receiptId")}}).toArray();
        let lpSetupDetails = _.flatten(_.map(results, "lpDetails"));

        //overwrite lpId of inventory by receipt setup original lpId
        _.each(inventories, i => {
            _.each(lpSetupDetails, lpDetail => {
                _.each(lpDetail.items, item => {
                    if (item.itemLineId === i.receiptItemLineId) {
                        i.lpId = lpDetail.lpId;
                    }
                });
            });
        });
    }

    async function cartonLevelInquiryReport(criteria) {
        let cartons = await _searchCartonLevelReceiptItemLine(criteria);
        return await commonService(ctx).buildReportReturn(cartons, null, criteria, ["cartonLevelFieldMappings"], inboundReportResolver(ctx).resolveInboundFields);
    }

    async function _searchCartonLevelReceiptItemLine(criteria) {
        let receiptItemLines = await receiptItemLineService(ctx).aggregateSearchReceiptItemLine(criteria);
        let receiptItemLineWithCartons = _.filter(receiptItemLines, o => o.cartons !== null && _.size(o.cartons) !== 0);
        return _.isEmpty(receiptItemLineWithCartons) ? [] : _buildCartonData(receiptItemLineWithCartons);
    }

    function _buildCartonData(receiptItemLineWithCartons) {
        let cartons = [];
        _.each(receiptItemLineWithCartons, o => {
            _.each(o.cartons, carton => {
                let data = _.assign({}, carton);
                data.receiptId = o.receiptId;
                data.itemSpecId = o.itemSpecId;
                data.titleId = o.titleId;
                data.supplierId = o.supplierId;
                data.unitId = o.unitId;
                data.customerId = o.customerId;
                cartons.push(data);
            });
        });
        return cartons;
    }

    async function expandingInquiryReportSearchByPaging(criteria) {
        let pagingResult = await _searchReceiptItemLineByPaging(criteria);
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["generalLevelFieldMappings", "detailLevelFieldMappings", "idLevelFieldMappings"], inboundReportResolver(ctx).resolveInboundFields);
    }

    async function _buildCriteriaByKeyword(criteria) {
        if (criteria.itemKeyword) {
            criteria.itemSpecIds = await itemSpecService(ctx).searchItemSpecIdByKeyword(criteria.itemKeyword, criteria.customerId);
            if (_.isEmpty(criteria.itemSpecIds)) {
                criteria.itemSpecIds = ["-1"];
            }
        }
    }

    async function _searchReceiptItemLineByPaging(criteria) {
        await _buildCriteriaByKeyword(criteria);
        let pagingResult = await receiptItemLineService(ctx).aggregateSearchReceiptItemLineByPaging(criteria);
        _.each(pagingResult.results, o => {
            o.receiptItemLineId = o._id.toString();
        });
        return pagingResult;
    }

    async function _searchReceiptByPaging(criteria) {
        await _buildCriteriaByKeyword(criteria);
        let pagingResult = await receiptService(ctx).aggregateSearchReceiptByPaging(criteria);
        _.each(pagingResult.results, o => {
            o.receiptId = o._id;
        });
        return pagingResult;
    }

    async function scheduleSummaryReportSearchByPaging(criteria) {
        let pagingResult = await receiptService(ctx).aggregateSearchScheduleSummaryByPaging(criteria);
        _.each(pagingResult.results, o => {
            o.receiptIds = _.uniq(o.receiptIds);
            o.expectedReceiptCount = _.size(o.receiptIds)
        });
        commonService(ctx).assignDataOut(pagingResult.results, '_id');
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["scheduleSummaryFieldMappings"], inboundReportResolver(ctx).resolveInboundFields);
    }

    async function receivingSummaryReportSearchByPaging(criteria) {
        let pagingResult = await receiptService(ctx).aggregateSearchReceivingSummaryByPaging(criteria);
        _.each(pagingResult.results, o => {
            o.receiptIds = _.uniq(o.receiptIds);
            o.receiptCount = _.size(o.receiptIds)
        });
        commonService(ctx).assignDataOut(pagingResult.results, '_id');
        return await commonService(ctx).buildReportReturn(pagingResult.results, pagingResult.paging, criteria, ["receivingOrShippingSummaryFieldMappings"], inboundReportResolver(ctx).resolveInboundFields);
    }

    return {
        inquiryReportSearchByPaging,
        itemLevelInquiryReportSearchByPaging,
        idLevelInquiryReportSearchByPaging,
        expandingInquiryReportSearchByPaging,
        scheduleSummaryReportSearchByPaging,
        receivingSummaryReportSearchByPaging,
        cartonLevelInquiryReport
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};