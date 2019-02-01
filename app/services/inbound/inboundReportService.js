const _ = require('lodash');
const ObjectID = require('mongodb-core').BSON.ObjectID;

/*
 startTime //for INBOUND_FINISHED
 endTime  //for INBOUND_FINISHED
 createdTimeFrom //for INBOUND_SCHEDULE
 createdTimeTo  //for INBOUND_SCHEDULE
 customerId
 receiptStatuses
 reportType
 paging {"pageNo": 1, "limit": 10000},
 receiptIds,
 poNo
 referenceNo
 containerNo,
 snNo
 */

let service = (app, ctx) => {

    // Receipt Level
    async function searchByPagingForReceiptLevel(criteria) {
        criteria.receiptIds = await _searchReceiptByKeyword(criteria);
        let [pagingResult, reportFieldMapping] = await Promise.all([
            _searchReceiptByPaging(criteria),
            getReportFieldMapping(criteria.reportType, "RECEIPT_LEVEL", criteria.customerId)
        ]);
        _fillReceiptId(pagingResult.results);

        pagingResult.results = await formatData(reportFieldMapping, pagingResult.results);
        return pagingResult;
    }

    async function _searchReceiptByPaging(criteria) {
        let receiptSearch = new ReceiptSearch(criteria);
        let option = receiptSearch.buildClause();
        return await receiptCollection(ctx).findByPaging(option);
    }

    function _fillReceiptId(receipts) {
        _.each(receipts, r => {
            r.receiptId = r._id;
        });
    }

    // ItemLine Level
    async function searchByPagingForItemLevel(criteria) {
        let receipts = await searchReceipts(criteria);
        let [pagingResult, reportFieldMapping] = await Promise.all([
            searchReceiptItemLineByPaging(criteria, receipts),
            getReportFieldMapping(criteria.reportType, "ITEM_LEVEL", criteria.customerId)
        ]);

        pagingResult.results = await formatData(reportFieldMapping, pagingResult.results);
        return pagingResult;
    }

    async function searchReceiptItemLineByPaging(criteria, receipts) {
        criteria.receiptIds = _getReceiptIds(receipts);
        let receiptItemLineSearch = new ReceiptItemLineSearch(criteria);
        let option = receiptItemLineSearch.buildClause();
        let response = await receiptItemLineCollection(ctx).findByPaging(option);

        let receiptMap = _.keyBy(receipts, "_id");
        _.each(response.results, itemLine => {
            // TODO: this can be simplified by aggregate pipeline after mongodb upgrade to 4.0
            let receipt = _.pick(receiptMap[itemLine.receiptId],
                ['status', 'customerId', 'titleId', 'carrierId', 'containerNo', 'containerSize', 'referenceNo', 'poNo', 'appointmentTime', 'inYardTime', 'devannedTime', 'source']);
            _.assign(itemLine, receipt);
        });

        return response;
    }

    // LP Level
    async function searchByPagingForLPLevelData(criteria) {
        let [pagingResult, reportFieldMapping] = await Promise.all([
            _searchByPagingForLPLevelRawData(criteria),
            getReportFieldMapping(criteria.reportType, "LP_LEVEL", criteria.customerId)
        ]);
        pagingResult.results = await formatData(reportFieldMapping, pagingResult.results);
        return pagingResult;
    }

    async function _searchByPagingForLPLevelRawData(criteria) {
        let receipts = await searchReceipts(criteria);
        let pagingResult = await searchReceiptItemLineByPaging(criteria, receipts);

        let itemLevelRawDatas = pagingResult.results;
        let itemLineMap = _.keyBy(itemLevelRawDatas, "_id");
        let itemLineIds = _.map(itemLevelRawDatas, d => d._id.toString());

        let lpSetups = await _getLPSetupsByItemLineIds(itemLineIds);
        let lpLevelRawDatas = app.util.unwind(app.util.unwind(lpSetups, "lpDetails"), "items");
        lpLevelRawDatas = _.filter(lpLevelRawDatas, data => _.includes(itemLineIds, data.itemLineId));
        _.each(lpLevelRawDatas, data => {
            data.receivedQty = data.qty;
            data.receivedUnitId = data.unitId;

            // TODO: this can be simplified by aggregate pipeline after mongodb upgrade to 4.0
            let itemLine = _.pick(itemLineMap[data.itemLineId],
                ["itemSpecId", 'status', 'customerId', 'titleId', 'carrierId', 'containerNo', 'containerSize', 'referenceNo', 'poNo', 'appointmentTime', 'inYardTime', 'devannedTime', 'source']);
            _.assign(data, itemLine);
        });

        pagingResult.results = lpLevelRawDatas;
        return pagingResult;
    }

    // SN Level
    async function searchByPagingForSnLevelData(criteria) {
        let [pagingResult, reportFieldMapping] = await Promise.all([
            _searchByPagingForLPLevelRawData(criteria),
            getReportFieldMapping(criteria.reportType, "SN_LEVEL", criteria.customerId)
        ]);

        let lpLevelRawDatas = pagingResult.results;
        let lpMap = _.keyBy(lpLevelRawDatas, "lpId");
        let lpIds = _.uniq(_.map(lpLevelRawDatas, "lpId"));

        let snLevelRawDatas = await _getSnScansByLPIds(_.uniq(_.map(lpLevelRawDatas, "lpId")));
        snLevelRawDatas = app.util.unwind(snLevelRawDatas, "scanDetails");
        snLevelRawDatas = app.util.unwind(snLevelRawDatas, "itemSNs");
        snLevelRawDatas = app.util.unwind(snLevelRawDatas, "snList", "sn");

        snLevelRawDatas = _.filter(snLevelRawDatas, data => _.includes(lpIds, data.lpId));
        _.each(snLevelRawDatas, data => {
            // TODO: this can be simplified by aggregate pipeline after mongodb upgrade to 4.0
            let lp = _.pick(lpMap[data.lpId],
                ["receiptId", "itemSpecId", 'status', 'customerId', 'titleId', 'carrierId', 'containerNo', 'containerSize', 'referenceNo', 'poNo', 'appointmentTime', 'inYardTime', 'devannedTime', 'source', "unitId", "lpId"]);
            _.assign(data, lp);

            data.receivedQty = 1;
            data.receivedUnitId = data.unitId;
        });

        pagingResult.results = await formatData(reportFieldMapping, snLevelRawDatas);
        return pagingResult;
    }

    async function _getSnScansByLPIds(lpIds) {
        if (_.isEmpty(lpIds)) {
            return [];
        }

        return await receiveSnScanCollection(ctx).find({"scanDetails.lpId": {$in: lpIds}}, {projection:{
            _id: -1,
            scanDetails: 1
        }}).toArray();

    }

    async function _getLPSetupsByItemLineIds(itemLineIds) {
        return await receiveLpSetupCollection(ctx).find({"lpDetails.items.itemLineId": {$in: itemLineIds}}, {projection:{
            _id: -1,
            lpDetails: 1
        }}).toArray();
    }

    async function searchReceipts(criteria) {
        if (criteria.receiptStatuses) {
            criteria.receiptStatuses = await commonService(ctx).multiEnumToDbFormat("ReceiptStatus", criteria.receiptStatuses);
        }
        let hash = app.util.hash(criteria);
        if (!ctx.cached.hashMap[hash]) {
            let receiptSearch = new ReceiptSearch(criteria);
            ctx.cached.hashMap[hash] = await receiptCollection(ctx).query(receiptSearch.buildClause());
        }

        return ctx.cached.hashMap[hash];
    }

    function _getReceiptIds(receipts) {
        let receiptIds = _.uniq(_.map(receipts, "_id"));
        if (_.isEmpty(receiptIds)) {
            return ["-1"];
        }
        return receiptIds;
    }

    async function getReportFieldMapping(reportType, level, customerId) {
        let reportFieldMapping = await reportFieldMappingCollection(ctx).findOne({
            "reportType": reportType,
            "customerId": customerId,
            "level": level,
            "status": "ACTIVE"
        });
        if (_.isEmpty(reportFieldMapping)) {
            reportFieldMapping = await reportFieldMappingCollection(ctx).findOne({
                "reportType": reportType,
                "customerId": "default",
                "level": level,
                "status": "ACTIVE"
            });
        }
        return reportFieldMapping;
    }

    async function _searchReceiptByKeyword(criteria) {
        if (_.isEmpty(criteria.keyword)) return [];
        let [receipts, inventories] = await Promise.all([
            wmsApp(ctx).post('/inbound/receipt/search', {"keyword": criteria.keyword}),
            wmsApp(ctx).post('/inventories/search', {"sn": criteria.keyword})]);
        return _.union(_.mapUniq(receipts, "id"), _.mapUniq(inventories, "receiptId"));
    }

    async function formatData(reportFieldMapping, rawDatas) {
        let results = await inboundReportResolver(ctx).resolveInboundFields(rawDatas, reportFieldMapping.fieldMappings);
        return {
            head: _.map(reportFieldMapping.fieldMappings, "customerField"),
            data: results
        }
    }


    // download
    async function buildDownloadDataForReceiptLevel(criteria) {
        return await commonService(ctx).getAllPageDataFromFunction(searchByPagingForReceiptLevel, criteria);
    }

    async function buildDownloadDataForItemLevel(criteria) {
        return await commonService(ctx).getAllPageDataFromFunction(searchByPagingForItemLevel, criteria);
    }

    async function buildDownloadDataForLPLevel(criteria) {
        return await commonService(ctx).getAllPageDataFromFunction(searchByPagingForLPLevelData, criteria);
    }

    async function buildDownloadDataForSnLevel(criteria) {
        return await commonService(ctx).getAllPageDataFromFunction(searchByPagingForSnLevelData, criteria);
    }

    class ReceiptSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'customerId'),
                receiptIds: new MongoOperator('$in', '_id'),
                poNos: new MongoOperator('$in', 'poNo'),
                referenceNos: new MongoOperator('$in', 'referenceNo'),
                containerNos: new MongoOperator('$in', 'containerNo'),
                startTime: new MongoOperator('$gte', 'devannedTime', 'Date'),
                endTime: new MongoOperator('$lte', 'devannedTime', 'Date'),
                createdTimeFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                createdTimeTo: new MongoOperator('$lte', 'createdWhen', 'Date'),
                receiptStatuses: new MongoOperator('$in', 'status')
            };
        }
    }

    class ReceiptItemLineSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                itemSpecId: new MongoOperator('$eq', 'itemSpecId'),
                itemSpecIds: new MongoOperator('$in', 'itemSpecId'),
                receiptIds: new MongoOperator('$in', 'receiptId'),
                lotNos: new MongoOperator('$in', 'lotNo')
            };
        }
    }

    return {
        searchByPagingForReceiptLevel,
        searchByPagingForItemLevel,

        buildDownloadDataForReceiptLevel,
        buildDownloadDataForItemLevel,
        buildDownloadDataForLPLevel,
        buildDownloadDataForSnLevel,

        searchReceipts,
        searchReceiptItemLineByPaging,

        searchByPagingForReceiptLevel,
        searchByPagingForItemLevel,
        searchByPagingForLPLevelData,
        searchByPagingForSnLevelData,

        formatData,
        getReportFieldMapping
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
