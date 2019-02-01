const _ = require('lodash');
const ObjectID = require('mongodb-core').BSON.ObjectID;

let service = (app, ctx) => {
    async function getItemSpecMap(itemSpecIds) {
        return await app.util.getMapFromCache(ctx.cached.itemSpecMap, itemSpecIds, _getItemSpecMap);
    }

    async function _getItemSpecMap(itemSpecIds) {
        if (_.isEmpty(itemSpecIds)) return {};

        let itemSpecs = await itemSpecCollection(ctx).find({_id: {$in: _.uniq(itemSpecIds)}}).toArray();
        return _.keyBy(itemSpecs, "_id");
    }

    async function getItemDynPropertyGroup(itemSpecIds) {
        return await app.util.getMapFromCache(ctx.cached.itemDynTxtPropertyGroup, itemSpecIds, _getItemDynPropertyGroup);
    }

    async function _getItemDynPropertyGroup(itemSpecIds) {
        let itemDynFields = await itemSpecFieldCollection(ctx).find({"itemSpecId": {$in: itemSpecIds}}).toArray();
        if (_.isEmpty(itemDynFields)) return;
        let allPropertyIds = _.mapUniq(itemDynFields, "propertyId");
        if (_.isEmpty(allPropertyIds)) return;
        let propertyObjectIds = _.map(allPropertyIds, id => new ObjectID(id));
        let itemProperties = await itemPropertyCollection(ctx).find({"_id": {$in: propertyObjectIds}}).toArray();
        if (_.isEmpty(itemProperties)) return;

        _.each(itemProperties, property => {
            property._id = property._id.toString();
        });
        let propertyMap = _.keyBy(itemProperties, "_id");

        _.each(itemDynFields, function (o) {
            let property = propertyMap[o.propertyId];
            o.name = property ? property.name : "";
        });
        return _.groupBy(itemDynFields, "itemSpecId");
    }

    async function _getItemOrganizationMap(itemSpecs, akas) {
        let customerIds = _.map(itemSpecs, "customerId");
        let titleIds = _.flatten(_.map(itemSpecs, "titleIds"));
        let supplierIds = _.flatten(_.map(itemSpecs, "supplierIds"));
        let brandIds = _.map(itemSpecs, "brandId");
        let akaOrgIds = _.map(akas, "organizationId");
        let orgIds = _.compact(_.union(customerIds, titleIds, supplierIds, akaOrgIds, brandIds));
        if (!orgIds || orgIds.length === 0) return {};
        let orgs = await organizationCollection(ctx).query({_id: {$in: orgIds}});
        return _.keyBy(orgs, "_id");
    }

    function _getOrgNames(orgIds, orgMap) {
        let orgNames = [];
        _.forEach(orgIds, id => {
            if (orgMap[id]) {
                orgNames.push(orgMap[id].name);
            }
        });
        return _.uniq(orgNames);
    }

    function _fillItemProperties(itemSpecFields, itemPropertyMap) {
        _.forEach(itemSpecFields, field => {
            let itemProperty = itemPropertyMap[field.propertyId];
            if (!itemProperty) return;
            field.name = itemProperty.name;
            field.type = itemProperty.type;
        });
        return itemSpecFields;
    }

    function _getNamedUom(itemId, itemUnitGroup, uomName, isBaseUnit) {
        let uoms = _.filter(itemUnitGroup[itemId], unit => unit.itemSpecId === itemId && unit.name === uomName && unit.isBaseUnit === isBaseUnit);
        if (uoms) {
            return uoms[0];
        }
        return {};
    }

    async function searchByPaging(param) {
        if (!param || _.isEmpty(param.customerIds) && !_.includes(param.tags, "Material")) {
            throw new BadRequestError('Please select one customer.');
        }
        let resData = _getEmptyPage();
        let itemSpecRes = await fdApp(ctx).post("/item-spec/search-by-paging", param);
        resData.paging = itemSpecRes.paging;
        let itemSpecs = itemSpecRes.itemSpecs;
        if (!itemSpecs || itemSpecs.length === 0) return resData;
        let itemSpecIds = _.map(itemSpecs, "id");

        let [itemProperties, itemSpecFields, itemGroups, itemUnits, itemAkas, itemTemplates] = await
            Promise.all([
                itemPropertyCollection(ctx).query({status: "ENABLE"}),
                itemSpecFieldCollection(ctx).query({itemSpecId: {$in: itemSpecIds}}),
                itemGroupCollection(ctx).query(),
                itemUnitCollection(ctx).query({itemSpecId: {$in: itemSpecIds}}),
                itemAkaCollection(ctx).query({itemSpecId: {$in: itemSpecIds}}),
                singleItemLpConfigurationCollection(ctx).query({
                    itemSpecId: {$in: itemSpecIds},
                    scene: "INBOUND",
                    isDefault: true
                })
            ]);
        let itemPropertyMap = _.keyBy(itemProperties, "_id");
        let itemGroupMap = _.keyBy(itemGroups, "_id");
        let itemSpecFieldGroup = _.groupBy(itemSpecFields, "itemSpecId");
        let itemUnitGroup = _.groupBy(itemUnits, "itemSpecId");
        let itemAkaGroup = _.groupBy(itemAkas, "itemSpecId");
        let itemTemplateMap = _.keyBy(itemTemplates, "itemSpecId");

        let orgMap = await _getItemOrganizationMap(itemSpecs, itemAkas);
        let templateMap = await _getSingleLpTemplateMap(itemTemplates);

        let data = [];
        for (let item of itemSpecs) {
            let itemMainInfo = await _buildItemInfo(item, itemGroupMap, orgMap);
            let uomInfo = await _buildUOMData(item.id, itemUnitGroup);
            let akaInfo = await _buildAkaData(item.id, itemAkaGroup, orgMap);
            let propertyInfo = _buildPropertyData(item.id, itemSpecFieldGroup, itemPropertyMap);
            let templateInfo = _buildTemplateData(item.id, itemTemplateMap, templateMap, itemUnitGroup);
            data.push(_.assign({}, itemMainInfo, uomInfo, akaInfo, propertyInfo, templateInfo))
        }

        resData.results.data = data;
        return resData;
    }

    function _buildTemplateData(itemSpecId, itemTemplateMap, templateMap, itemUnitGroup) {
        if (_.isEmpty(templateMap)) {
            return;
        }
        let palletInfo = {};
        let csUnit = _getNamedUom(itemSpecId, itemUnitGroup, "CS", false);
        if (_.isEmpty(csUnit)) {
            return palletInfo;
        }
        let csUnitId = csUnit._id.toString();
        let itemTemplate = itemTemplateMap[itemSpecId];
        if (itemTemplate && itemTemplate.unitId === csUnitId) {
            let template = templateMap[itemTemplate.lpConfigurationTemplateId];
            if (template) {
                palletInfo = {
                    Pallet_Ti: template.layer,
                    Pallet_Hi: template.totalQty / template.layer,
                    Cases_Per_Pallet: template.totalQty
                }
            }
        }
        return palletInfo;
    }

    async function _getSingleLpTemplateMap(itemTemplates) {
        let templateIds = _.map(itemTemplates, "lpConfigurationTemplateId");
        if (!_.isEmpty(templateIds)) {
            let templates = await singleLpTemplateCollection(ctx).query({_id: {$in: templateIds}});
            return _.keyBy(templates, "_id")
        }
        return {};
    }

    async function _buildItemInfo(itemSpec, itemGroupMap, orgMap) {
        let titles = _getOrgNames(itemSpec.titleIds, orgMap);
        let suppliers = _getOrgNames(itemSpec.supplierIds, orgMap);
        return {
            ActionCode_AU: 'U',
            allowOverWriteItem: commonService(ctx).convertToYN(itemSpec.allowOverWriteItem),
            companyId: '',
            supplierId: suppliers.join(","),
            customerId: orgMap[itemSpec.customerId] ? orgMap[itemSpec.customerId].name : "",
            itemID: itemSpec.name,
            itemDescription: commonService(ctx).ensureNotNull(itemSpec.desc),
            shortDescription: commonService(ctx).ensureNotNull(itemSpec.shortDescription),
            abbreviation: commonService(ctx).ensureNotNull(itemSpec.abbreviation),
            ItemGroupID: "",
            ItemSubGroupID: '',
            titleIds: titles.join(","),
            tags: await _getEnumWebContext("GroupType", itemSpec.tags),
            labels: itemSpec.labels ? itemSpec.labels.join(",") : "",
            brandID: orgMap[itemSpec.brandId] ? orgMap[itemSpec.brandId].name : "",
            groupID: itemGroupMap[itemSpec.groupId] ? itemGroupMap[itemSpec.groupId].name : "",
            grade: commonService(ctx).ensureNotNull(itemSpec.grade),
            freightClass: commonService(ctx).ensureNotNull(itemSpec.freightClass),
            nmfc: commonService(ctx).ensureNotNull(itemSpec.nmfc),
            commodityDescription: commonService(ctx).ensureNotNull(itemSpec.commodityDescription),
            countryOrigin: commonService(ctx).ensureNotNull(itemSpec.countryOrigin),
            fileIDs: itemSpec.fileIds ? itemSpec.fileIds.join(",") : "",
            UPCCode: commonService(ctx).ensureNotNull(itemSpec.upcCode),
            UPCCode_Case: commonService(ctx).ensureNotNull(itemSpec.upcCodeCase),
            EANCode: commonService(ctx).ensureNotNull(itemSpec.eanCode),
            isBundle: commonService(ctx).convertToYN(itemSpec.bundle),
            hasSerialNumber: commonService(ctx).convertToYN(itemSpec.hasSerialNumber),
            serialNoLength: parseInt(itemSpec.serialNoLength),
            isHazardousMaterial: commonService(ctx).convertToYN(itemSpec.isHazardousMaterial),
            NeedAllowOverwriteByImport: commonService(ctx).convertToYN(itemSpec.allowOverWriteByImport),
            status: await _getEnumWebContext("ItemSpecStatus", [itemSpec.status]),
            validationInboundSerialNo: commonService(ctx).convertToYN(itemSpec.validatedOutboundSerialNoAgainstInbound),
            serialNoScanLotNoCheck: commonService(ctx).convertToYN(itemSpec.serialNoScanLotNoCheck),
            requireCollectLotNoOnReceive: commonService(ctx).convertToYN(itemSpec.requireCollectLotNoOnReceive),
            defaultPutAwayLocationSubType: await _getEnumWebContext("LocationSubType", [itemSpec.defaultPutAwayLocationSubType]),
            validationOutboundSerialNo: commonService(ctx).convertToYN(itemSpec.validationOutboundSerialNo),
            needScanOutboundSerialNo: '',
            validatedOutboundSerialNoAgainstInbound: commonService(ctx).convertToYN(itemSpec.validatedOutboundSerialNoAgainstInbound),
            isAllowOverWriteSuggestedPickLP: '',
            'Shipping Rule': await _getEnumWebContext("ShippingRule", [itemSpec.shippingRule])
        };
    }

    async function _getEnumWebContext(enumClass, list) {
        if (_.isEmpty(list)) return "";
        let convertedList = [];
        for (let a of list) {
            let converted = await commonService(ctx).enumToWebFormat(enumClass, a);
            convertedList.push(converted);
        }
        return convertedList.join(",");
    }

    async function _buildUOMData(itemSpecId, itemUnitGroup) {
        let baseUom = _getNamedUom(itemSpecId, itemUnitGroup, "EA", true);
        let caseUom = _getNamedUom(itemSpecId, itemUnitGroup, "CS", false);
        let innerUom = _getNamedUom(itemSpecId, itemUnitGroup, "IN", false);
        let baseUOMData = {};
        let caseUOMData = {};
        let innerUOMData = {};
        if (baseUom) {
            baseUOMData = {
                Base_UOM: baseUom.name,
                Base_Length: commonService(ctx).ensureNotNull(baseUom.length),
                Base_Width: commonService(ctx).ensureNotNull(baseUom.width),
                Base_Height: commonService(ctx).ensureNotNull(baseUom.height),
                Base_UnitLength: _unitLengthConvert(baseUom.linearUnit),
                Base_Weight: commonService(ctx).ensureNotNull(baseUom.weight),
                Base_UnitWeight: await _getEnumWebContext("WeightUnit", [baseUom.weightUnit]),
                Base_Volume: commonService(ctx).ensureNotNull(baseUom.volume),
                Base_UnitVolume: await _getEnumWebContext("VolumeUnit", [baseUom.volumeUnit])
            }
        }
        if (caseUom) {
            caseUOMData = {
                Case_UOM: caseUom.name,
                Case_Inside_UOM: _getUOMName(caseUom.insideUnitId, itemUnitGroup),
                Case_Qty: commonService(ctx).ensureNotNull(caseUom.baseQty),
                Case_Length: commonService(ctx).ensureNotNull(caseUom.length),
                Case_Width: commonService(ctx).ensureNotNull(caseUom.width),
                Case_Height: commonService(ctx).ensureNotNull(caseUom.height),
                Case_UnitLength: _unitLengthConvert(caseUom.linearUnit),
                Case_Weight: commonService(ctx).ensureNotNull(caseUom.weight),
                Case_UnitWeight: await _getEnumWebContext("WeightUnit", [caseUom.weightUnit])
            }
        }
        if (innerUom) {
            innerUOMData = {
                Inner_Pack_Qty: commonService(ctx).ensureNotNull(innerUom.baseQty),
                Inner_Pack_UOM: innerUom.name,
            }
        }
        return _.assign({}, baseUOMData, caseUOMData, innerUOMData);
    }

    function _unitLengthConvert(linearUnit) {
        if (_.isEmpty(linearUnit)) {
            return ""
        }
        if (linearUnit === "INCH") {
            return "Inch"
        }
    }

    function _getUOMName(unitId, itemUnitGroup) {
        let units = _.flatten(_.values(itemUnitGroup));
        let matchedUnit = _.filter(units, unit => unit._id.toString() === unitId);
        return !_.isEmpty(matchedUnit) ? (matchedUnit[0].name ? matchedUnit[0].name : "") : "";
    }

    async function _buildAkaData(itemSpecId, itemAkaGroup, orgMap) {
        let akas = itemAkaGroup[itemSpecId];
        if (!akas) return;
        let i = 1;
        let akaBlock = {};
        for (let aka of akas) {
            let j = (i < 10) ? '0' + i.toString() : i.toString();
            akaBlock['AKAValue' + j] = aka.value;
            akaBlock['AKAName' + j] = aka.key;
            akaBlock['AKA' + j + ' Tag'] = await _getEnumWebContext("ItemAkaTag", [aka.tag]);
            akaBlock['AKA' + j + ' Org'] = aka.organizationId ? (orgMap[aka.organizationId] ? orgMap[aka.organizationId].name : "") : "";
            i++
        }
        return akaBlock;
    }

    function _buildPropertyData(itemSpecId, itemSpecFieldGroup, itemPropertyMap) {
        let itemProperties = _fillItemProperties(itemSpecFieldGroup[itemSpecId], itemPropertyMap);
        let textProperty = {};
        let timeProperty = {};
        let numberProperty = {};
        if (itemProperties) {
            let i = 1;
            _.each(itemProperties, property => {
                if (property.type === "TEXT") {
                    let j = (i < 10) ? '0' + i.toString() : i.toString();
                    textProperty['DynTxtPropertyName' + j] = property.name;
                    textProperty['DynTxtPropertyValue' + j] = property.value;
                    i++
                }
            });

            i = 1;
            _.each(itemProperties, property => {
                if (property.type === "DATE") {
                    let j = (i < 10) ? '0' + i.toString() : i.toString();
                    timeProperty['DynDateTimePropertyName' + j] = property.name;
                    timeProperty['DynDateTimePropertyValue' + j] = property.value;
                    i++
                }
            });

            i = 1;
            _.each(itemProperties, property => {
                if (property.type === "NUMBER") {
                    let j = (i < 10) ? '0' + i.toString() : i.toString();
                    numberProperty['DynNumberPropertyName' + j] = property.name;
                    numberProperty['DynNumberPropertyValue' + j] = property.value;
                    i++
                }
            });
        }
        return _.assign({}, textProperty, timeProperty, numberProperty);
    }

    function _getEmptyPage() {
        let head = [
            "ActionCode_AU",
            "allowOverWriteItem",
            "companyId",
            "supplierId",
            "customerId",
            "itemID",
            "itemDescription",
            "shortDescription",
            "abbreviation",
            "ItemGroupID",
            "ItemSubGroupID",
            "titleIds",
            "tags",
            "labels",
            "brandID",
            "groupID",
            "grade",
            "freightClass",
            "nmfc",
            "commodityDescription",
            "countryOrigin",
            "fileIDs",
            "UPCCode",
            "UPCCode_Case",
            "EANCode",
            "isBundle",
            "hasSerialNumber",
            "serialNoLength",
            "isHazardousMaterial",
            "NeedAllowOverwriteByImport",
            "status",
            "validationInboundSerialNo",
            "serialNoScanLotNoCheck",
            "requireCollectLotNoOnReceive",
            "defaultPutAwayLocationSubType",
            "validationOutboundSerialNo",
            "needScanOutboundSerialNo",
            "validatedOutboundSerialNoAgainstInbound",
            "isAllowOverWriteSuggestedPickLP",
            "Shipping Rule",
            "Base_UOM",
            "Base_Length",
            "Base_Width",
            "Base_Height",
            "Base_UnitLength",
            "Base_Weight",
            "Base_UnitWeight",
            "Base_Volume",
            "Base_UnitVolume",
            "Inner_Pack_Qty",
            "Inner_Pack_UOM",
            "Case_UOM",
            "Case_Inside_UOM",
            "Case_Qty",
            "Case_Length",
            "Case_Width",
            "Case_Height",
            "Case_UnitLength",
            "Case_Weight",
            "Case_UnitWeight",
            "Pallet_Ti",
            "Pallet_Hi",
            "Cases_Per_Pallet",
            "DynTxtPropertyName01",
            "DynTxtPropertyValue01",
            "DynTxtPropertyName02",
            "DynTxtPropertyValue02",
            "DynTxtPropertyName03",
            "DynTxtPropertyValue03",
            "DynTxtPropertyName04",
            "DynTxtPropertyValue04",
            "DynTxtPropertyName05",
            "DynTxtPropertyValue05",
            "DynTxtPropertyName06",
            "DynTxtPropertyValue06",
            "DynTxtPropertyName07",
            "DynTxtPropertyValue07",
            "DynTxtPropertyName08",
            "DynTxtPropertyValue08",
            "DynTxtPropertyName09",
            "DynTxtPropertyValue09",
            "DynTxtPropertyName10",
            "DynTxtPropertyValue10",
            "DynTxtPropertyName11",
            "DynTxtPropertyValue11",
            "DynTxtPropertyName12",
            "DynTxtPropertyValue12",
            "DynTxtPropertyName13",
            "DynTxtPropertyValue13",
            "DynTxtPropertyName14",
            "DynTxtPropertyValue14",
            "DynTxtPropertyName15",
            "DynTxtPropertyValue15",
            "DynTxtPropertyName16",
            "DynTxtPropertyValue16",
            "DynTxtPropertyName17",
            "DynTxtPropertyValue17",
            "DynTxtPropertyName18",
            "DynTxtPropertyValue18",
            "DynTxtPropertyName19",
            "DynTxtPropertyValue19",
            "DynTxtPropertyName20",
            "DynTxtPropertyValue20",
            "DynDateTimePropertyName01",
            "DynDateTimePropertyValue01",
            "DynDateTimePropertyName02",
            "DynDateTimePropertyValue02",
            "DynDateTimePropertyName03",
            "DynDateTimePropertyValue03",
            "DynNumberPropertyName01",
            "DynNumberPropertyValue01",
            "DynNumberPropertyName02",
            "DynNumberPropertyValue02",
            "DynNumberPropertyName03",
            "DynNumberPropertyValue03",
            "DynNumberPropertyName04",
            "DynNumberPropertyValue04",
            "DynNumberPropertyName05",
            "DynNumberPropertyValue05",
            "DynNumberPropertyName06",
            "DynNumberPropertyValue06",
            "DynNumberPropertyName07",
            "DynNumberPropertyValue07",
            "DynNumberPropertyName08",
            "DynNumberPropertyValue08",
            "DynNumberPropertyName09",
            "DynNumberPropertyValue09",
            "DynNumberPropertyName10",
            "DynNumberPropertyValue10",
            "AKAValue01",
            "AKAName01",
            "AKA01 Tag",
            "AKA01 Org",
            "AKAValue02",
            "AKAName02",
            "AKA02 Tag",
            "AKA02 Org",
            "AKAValue03",
            "AKAName03",
            "AKA03 Tag",
            "AKA03 Org",
            "AKAValue04",
            "AKAName04",
            "AKA04 Tag",
            "AKA04 Org",
            "AKAValue05",
            "AKAName05",
            "AKA05 Tag",
            "AKA05 Org",
            "AKAValue06",
            "AKAName06",
            "AKA06 Tag",
            "AKA06 Org",
            "AKAValue07",
            "AKAName07",
            "AKA07 Tag",
            "AKA07 Org",
            "AKAValue08",
            "AKAName08",
            "AKA08 Tag",
            "AKA08 Org",
            "AKAValue09",
            "AKAName09",
            "AKA09 Tag",
            "AKA09 Org",
            "AKAValue10",
            "AKAName10",
            "AKA10 Tag",
            "AKA10 Org",
            "DiverseProperty01",
            "DiverseProperty02",
            "DiverseProperty03",
            "DiverseProperty04",
            "DiverseProperty05",
            "DiverseProperty06",
            "DiverseProperty07",
            "DiverseProperty08",
            "DiverseProperty09",
            "DiverseProperty10"
        ];

        return {
            results: {
                data: [],
                head: head
            }
        };
    }

    async function itemSearch(criteria) {
        let itemSpecSearch = new ItemSpecSearch(criteria);
        let option = itemSpecSearch.buildClause();
        return await itemSpecCollection(ctx).find(option).toArray();
    }

    class ItemSpecSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                groupId: new MongoOperator('$eq', 'groupId'),
                ids: new MongoOperator('$in', '_id'),
                name: new MongoOperator('$regex', 'name'),
                eqName: new MongoOperator('$eq(ignoreCase)', 'name'),
                names: new MongoOperator('$in', 'name'),
                titleIds: new MongoOperator('$in', 'titleIds'),
                customerId: new MongoOperator('$eq', 'customerId'),
                customerIds: new MongoOperator('$in', 'customerId'),
                supplierIds: new MongoOperator('$in', 'supplierIds'),
                brandId: new MongoOperator('$eq', 'brandId'),
                groupIds: new MongoOperator('$in', 'groupId'),
                status: new MongoOperator('$eq', 'status'),
                statuses: new MongoOperator('$in', 'status'),
                keyword: new MongoOperator('$regex(multiFields)', '_id,upcCode,upcCodeCase,upcCodeOther,eanCode,name,desc,shortDescription'),
                itemKeyword: new MongoOperator('$regex(multiFields)', '_id,upcCode,upcCodeCase,upcCodeOther,eanCode,name,desc,shortDescription'),
                isCaseUPCVerified: new MongoOperator('$eq', 'isCaseUPCVerified')
            };
        }
    }
    /*
     keyword can be item keyword or AKA value
     */
    async function searchItemSpecIdByKeyword(itemKeyword, customerId) {
        let items = await fdApp(ctx).post('/item-spec/search', {
            keyword: itemKeyword,
            customerId: customerId
        });
        let itemsFromAka = await itemAkaCollection(ctx).find({
            value: itemKeyword,
            organizationId: customerId
        }).toArray();

        return _.union(_.map(items, "id"), _.map(itemsFromAka, "itemSpecId"));
    }

    return {
        getItemSpecMap,
        searchByPaging,
        itemSearch,
        searchItemSpecIdByKeyword,
        getItemDynPropertyGroup
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};