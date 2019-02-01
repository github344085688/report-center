const _ = require('lodash');

let service = (app, ctx) => {

    async function getEnumFieldMap() {
        if (app.enumFieldMap) return app.enumFieldMap;

        let enumFields = await wmsApp(ctx).get("/enum");
        app.enumFieldMap = {};
        _.forEach(enumFields, enumField => {
            let toDbFormat = {};
            let toWebFormat = {};
            _.forEach(enumField.enumFields, field => {
                toDbFormat[field.webValue] = field.dbValue;
                toWebFormat[field.dbValue] = field.webValue;
            })
            app.enumFieldMap[enumField.enumClass] = {
                toDbFormat: toDbFormat,
                toWebFormat: toWebFormat
            };
        })

        return app.enumFieldMap;
    }

    async function enumToDbFormat(enumName, key) {
        let enumFieldMap = await getEnumFieldMap();

        if (!enumFieldMap[enumName]) return key;
        return enumFieldMap[enumName].toDbFormat[key] || key;
    }

    async function enumToWebFormat(enumName, key) {
        let enumFieldMap = await getEnumFieldMap();

        if (!enumFieldMap[enumName]) return key;
        return enumFieldMap[enumName].toWebFormat[key] || key;
    }

    async function multiEnumToDbFormat(enumName, keys) {
        if (!keys) return;
        let converted = [];
        for (let key of keys) {
            converted.push(await enumToDbFormat(enumName, key));
        }
        return converted;
    }

    async function multiEnumToWebFormat(enumName, keys) {
        if (!keys) return;
        let converted = [];
        for (let key of keys) {
            converted.push(await enumToWebFormat(enumName, key));
        }
        return converted;
    }

    async function getAllPageDataFromAPI(service, api, param, resField) {
        let pageSize = 500;
        let pageNo = 1;
        param = param || {};
        param.paging = {pageNo: pageNo, limit: pageSize};

        let res = await service(ctx).post(api, param);
        if (!res || !res[resField]) return [];

        let data = res[resField];
        let paging = res.paging;
        while (paging && paging.totalCount > pageSize * pageNo) {
            pageNo++;
            param.paging = {pageNo: pageNo, limit: pageSize};
            let res = await service(ctx).post(api, param);
            data = _.union(data, res[resField]);
        }

        return data;
    }

    async function getAllPageDataFromBillingCallBillPay(param) {
        let InvoiceHeader = {
            results: {
                data: [],
                head: []
            }
        };
        let InvoiceDetails = {
            results: {
                data: [],
                head: []
            }
        };
        let res = await billingService(ctx).postBillingApi(param.api, param.data);
        if (!res || !res.body.Status || !res.body.Result || !res.body.Page || !res.body.Result.length > 0)  return [InvoiceHeader, InvoiceDetails];
        let dataPage = {
            TotalNumber: res.body.Page.TotalNumber,
            PageSize: res.body.Page.PageSize,
            PageIndex: res.body.Page.CurrentPage
        };
        let AllPageDataFrom = res.body.Result;
        while (dataPage.TotalNumber > dataPage.PageSize * dataPage.PageIndex) {
            dataPage.PageIndex++;
            param.data.PageIndex = dataPage.PageIndex;
            let res = await billingService(ctx).postBillingApi(param.api, param.data);
            AllPageDataFrom = [...AllPageDataFrom, ...res.body.Result];
        }
        AllPageDataFrom.forEach((item) => {
            InvoiceHeader.results.data.push(item.InvoiceHeader);
            InvoiceDetails.results.data.push(item.InvoiceDetails);
        });
        InvoiceHeader.results.head = _.keys(AllPageDataFrom[0].InvoiceHeader);
        InvoiceHeader.results.data = _.flattenDeep(InvoiceHeader.results.data);
        InvoiceDetails.results.data = _.flattenDeep(InvoiceDetails.results.data);
        InvoiceDetails.results.head = _.keys(InvoiceDetails.results.data[0]);
        return [InvoiceHeader, InvoiceDetails];
    }

    async function getAllPageDataFromFunction(searchByPagingFunction, criteria) {
        criteria.paging = {"limit": 1000, "pageNo": 1};
        app.setCtxPaging(ctx, criteria.paging);

        let totalRecords = [];
        let criteriaCopy = _.cloneDeep(criteria);
        let result = await searchByPagingFunction(criteriaCopy);
        totalRecords = _.union(totalRecords, result.results.data);
        //get left pages
        let i = 2;
        while (i <= result.paging.totalPage) {
            criteria.paging.pageNo = i;
            app.setCtxPaging(ctx, criteria.paging);
            let criteriaCopy = _.cloneDeep(criteria);
            let nextResult = await searchByPagingFunction(criteriaCopy);
            totalRecords = _.union(totalRecords, nextResult.results.data);
            i++;
        }
        return {
            "head": result.results.head,
            "data": totalRecords
        };
    }

    function convertWeightToPound(weight, weightUnit) {
        let KG_TO_POUND = 2.2046;
        let G_TO_POUND = 0.0022046;
        if (weightUnit === "KG") {
            weight = weight * KG_TO_POUND;
        }
        if (weightUnit === "G") {
            weight = weight * G_TO_POUND;
        }

        return weight;

    }

    async function getAllPages(searchByPagingFunction, criteria) {
        criteria.paging = {"limit": 1000, "pageNo": 1};
        app.setCtxPaging(ctx, criteria.paging);

        let criteriaCopy = _.cloneDeep(criteria);
        let firstPage = await searchByPagingFunction(criteriaCopy);
        let totalDatas = firstPage.results.data;
        let head = firstPage.results.head;

        //get left pages
        let i = 2;
        while (i <= firstPage.paging.totalPage) {
            criteria.paging.pageNo = i;
            app.setCtxPaging(ctx, criteria.paging);
            let criteriaCopy = _.cloneDeep(criteria);
            let nextResult = await searchByPagingFunction(criteriaCopy);
            totalDatas = _.union(totalDatas, nextResult.results.data);
            i++;
        }
        return {
            "results": {
                "data": totalDatas,
                "head": head
            }
        };
    }

    function formatTimeToMMDDYYYYHHMM(time) {
        return time === null ? "" : momentZone(time).format('MM-DD-YYYY HH:MM');
    }

    function ensureNotNull(str) {
        return (str == null || str === "undefined") ? "" : str;
    }

    /*
     You can pass lodash letter convert function like _.upperCase, _.toUpper, _.upperFirst, _.lowerCase, _.toLower, _.lowerFirst
     or your self defined function to convertObjectKeyByFunction()
     */
    function convertObjectKeyByFunction(object, convertFunction) {
        return _.mapKeys(object, function (value, key) {
            return convertFunction(key)
        });
    }

    function unwindList(arr) {
        if (Array.isArray(arr)) {
            return _.join(arr, ",");
        }
    }

    function buildReportReturnBody(reportData, header, paging) {
        return {
            results: {
                data: reportData,
                head: header
            },
            paging: paging
        }
    }

    function convertToYN(value) {
        if (value === true) {
            return "Y"
        } else if (value === false) {
            return "N"
        } else {
            return ""
        }
    }

    function convertToYNObjectLevel(obj) {
        return _.mapValues(obj, function (o) {
            if (o === true || o === false) {
                return convertToYN(o)
            }
            return o;
        });
    }

    function calculateDuration(startTime, endTime) {
        let time = "";
        if (!startTime || !startTime) {
            return "";
        }
        let end = momentZone(endTime);
        let start = momentZone(startTime);
        let durationTime = (end - start); //毫秒

        let days = durationTime / (3600000 * 24); //day
        durationTime = durationTime % (3600000 * 24);
        if (_.floor(days) === 1) {
            time += _.round((days)) + " day ";
        }
        if (_.floor(days) > 1) {
            time += _.round((days)) + " days ";
        }

        let hours = durationTime / 3600000; //hour
        durationTime = durationTime % 3600000; //hour
        if (_.floor(hours) === 1) {
            time += _.round((hours)) + " hr ";
        }
        if (_.floor(hours) > 1) {
            time += _.round((hours)) + " hrs ";
        }

        let mins = durationTime / 60000; //min
        time += _.round((mins)) + " min"
        return time;
    }

    function isEmptyObject(obj) {
        for (var key in obj) {
            if (obj[key] !== null || !_.isEmpty(obj[key]))
                return false;
        }
        return true;
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

    async function getReportFieldMappingCustomization(customerId, reportCategory) {
        if (_.isEmpty(reportCategory)) {
            throw new Error("Report category is empty in request body!");
        }
        let fieldMapping = await reportFieldMappingCustomizationCollection(ctx).findOne({
            "reportCategory": reportCategory,
            "customerId": customerId
        });
        if (_.isEmpty(fieldMapping)) {
            fieldMapping = await reportFieldMappingCustomizationCollection(ctx).findOne({
                "reportCategory": reportCategory,
                "customerId": "default"
            });
        }
        return fieldMapping;
    }


    async function getFieldMapping(headerList, customerId, reportCategory, reportLevels) {
        let reportFieldMapping = await commonService(ctx).getReportFieldMappingCustomization(customerId, reportCategory);
        if (_.isEmpty(reportFieldMapping)) {
            throw new Error("Can not find report field mapping by " + reportCategory);
        }
        let fieldMappings = [];
        _.each(reportLevels, level => {
            fieldMappings = _.union(fieldMappings, reportFieldMapping[level]);
        });
        fieldMappings = _.uniqWith(fieldMappings, _.isEqual);
        if (_.isEmpty(headerList)) {
            fieldMappings = _.filter(fieldMappings, mapping => mapping.isDefaultField === true)
        } else {
            fieldMappings = _.filter(fieldMappings, filedMapping => _.includes(headerList, filedMapping.customerField))
        }
        if (_.isEmpty(fieldMappings)) {
            throw new BadRequestError("Field mapping is empty !")
        }
        return fieldMappings;
    }

    async function buildReportReturn(reportData, paging, originalCriteria, reportLevels, resolveFunction) {
        let headerList = originalCriteria.headerList;
        let customerId = originalCriteria.customerId;
        let reportCategory = originalCriteria.reportCategory;
        let fieldMappings = await getFieldMapping(headerList, customerId, reportCategory, reportLevels);
        let results = [];
        if (!_.isEmpty(reportData)) {
            results = await resolveFunction(reportData, fieldMappings);
        }
        return _buildReportReturnBodyByFieldMapping(fieldMappings, results, paging)
    }

    function _buildReportReturnBodyByFieldMapping(fieldMappings, results, paging) {
        return {
            results: {
                head: _.map(fieldMappings, "customerField"),
                data: results
            },
            paging: paging
        }
    }

    function getDynamicFieldValues(customerDynFields, valueDynFields, userSpecifiedDynFields) {
        let dynTxtProperty = [];
        if (_.isEmpty(customerDynFields)) {
            return;
        }
        //get dynamic name and value
        _.each(Object.keys(customerDynFields), key => {
                let dynFieldName = _.isEmpty(customerDynFields[key]) ? null : customerDynFields[key];
                let dynFieldValue = _.isEmpty(valueDynFields[key]) ? null : valueDynFields[key];
                if (_.isEmpty(dynFieldName) || _.isEmpty(dynFieldValue)) {
                    return;
                }

                if (!_.isEmpty(userSpecifiedDynFields) && !_.includes(userSpecifiedDynFields, key)) {
                    return;
                }
                let dynTxtPropertyString = `${dynFieldName}:${dynFieldValue}`;
                dynTxtProperty.push(dynTxtPropertyString)
            }
        );
        return _.join(dynTxtProperty, ",");
    }

    function getItemDynamicFieldValues(customizedDynPropertyIds, itemDynProperties) {
        let matchedProperties = itemDynProperties;
        let propertyStrings = [];
        if (!_.isEmpty(customizedDynPropertyIds)) {
            matchedProperties = _.filter(itemDynProperties, p => _.includes(customizedDynPropertyIds, p._id));
        }
        _.each(matchedProperties, p => {
            propertyStrings.push(`${p.name}:${p.value}`);
        });
        return _.join(propertyStrings, ",");
    }

    function assignDataOut(results, targetElement) {
        _.each(results, r => _.assign(r, r[targetElement]))
    }

    function formatTimeZone(time) {
        return time !== null ? momentZone(time).format('MM/DD/YYYY HH:mm:ss') : time;
    }

    return {
        enumToDbFormat,
        enumToWebFormat,
        getAllPageDataFromAPI,
        getAllPageDataFromFunction,
        getAllPages,
        ensureNotNull,
        formatTimeToMMDDYYYYHHMM,
        convertObjectKeyByFunction,
        unwindList,
        buildReportReturnBody,
        multiEnumToDbFormat,
        multiEnumToWebFormat,
        convertWeightToPound,
        convertToYN,
        isEmptyObject,
        convertToYNObjectLevel,
        calculateDuration,
        getReportFieldMapping,
        getReportFieldMappingCustomization,
        getDynamicFieldValues,
        getFieldMapping,
        buildReportReturn,
        getAllPageDataFromBillingCallBillPay,
        assignDataOut,
        formatTimeZone,
        getItemDynamicFieldValues
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};