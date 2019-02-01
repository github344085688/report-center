const syncFacilityApi = "/api/Vendor/AddSite",
    syncCustomerApiAdd = "/api/Vendor/AddVendorInfo",
    syncCustomerApiUpdate = "/api/Vendor/UpdateVendorInfo",
    syncMaterialsApi = "/api/Questionnaire/InsertQuestionFactorsAndQuestion",
    syncItemApi = "/api/clientworkorder/ImportItemReport";

let service = (app, ctx) => {

    function checkOrgIsInit(orgId, billingOrgRecords) {
        if (_.isEmpty(billingOrgRecords)) {
            return false;
        }
        for (let record of billingOrgRecords) {
            if (record.orgId == orgId && record.isCreated) {
                return true;
            }
        }

        return false;

    }


    async function syncFacilities() {
        let configurations = await configurationCollection(ctx).find({propertyGroup: "BillingConfiguration"}).toArray();
        let conf = _.find(configurations, conf => conf.propertyName === "Consignee");
        let billConsignee = conf ? conf.propertyValue : null;
        try {
            let facilities = await facilityCollection(ctx).find().toArray();
            let orgIds = _.map(facilities, "_id");
            let organizations = await organizationCollection(ctx).find({_id: {$in: orgIds}}).toArray();
            let organizationMap = _.keyBy(organizations, "_id");
            let resultData = [];

            let billingOrgRecords = await initBillingOrgRecordCollection(ctx).find({orgType: "FACILITY"}).toArray();
            if (!_.isEmpty(facilities)) {
                let records = [];
                for (let facility of facilities) {
                    let orgId = facility._id;
                    if (!checkOrgIsInit(orgId, billingOrgRecords)) {
                        let data = {
                            "Program": "Wise",
                            "SiteID": organizationMap[orgId].name,
                            "Site": organizationMap[orgId].name
                        };
                        try {
                            let response = await billingService(ctx).postBillingApi(syncFacilityApi, data);
                            if (response && response.body && response.body.Status) {
                                records.push({orgId: orgId, orgType: "FACILITY", isCreated: true});
                                data.status = true;
                                data.message = "success";
                                resultData.push(data);
                            } else {
                                data.status = false;
                                data.message = response.body.ErrorMsg;
                                resultData.push(data);
                            }
                        } catch (ex) {
                            data.status = false;
                            data.message = ex.message;
                            resultData.push(data);
                            console.log(ex);
                        }

                    }


                }

                try {
                    if (!_.isEmpty(records)) {
                        let res = await fdApp(ctx).post("/init-billing-org-record/batchCreate", records);
                    }

                } catch (ex) {
                    console.log(ex);
                }

                let emailBody = _buildMailBody(resultData);
                await app.sendMail("Record Sent Billing Sync Facility", emailBody, null, billConsignee);

                return resultData;


            }
        } catch (ex) {
            console.log(ex);
            let mesg = `Fail:${ex.status}<br/>${ex.message}<br/><br/>${ex.stack}<br/><br/>`;
            await app.sendMail("Billing Sync Customers Fail", mesg, null, billConsignee);
        }


    }

    function _buildMailBody(resultData) {
        let successRecords = _.filter(resultData, function (item) {
            return item.status == true;
        });
        let failRecords = _.filter(resultData, function (item) {
            return item.status == false;
        })

        let emailBody = "Process Success Count:" + successRecords.length + "<br>"
            + "Total Count:" + resultData.length + "<br>"
            + "Detail:<br>";
        let detail = "";
        _.forEach(resultData, function (item) {
            detail += JSON.stringify(item) + "<br>";
        });
        emailBody += detail;
        return emailBody;
    }

    async function syncCustomers() {
        let configurations = await configurationCollection(ctx).find({propertyGroup: "BillingConfiguration"}).toArray();
        let conf = _.find(configurations, conf => conf.propertyName === "Consignee");
        let billConsignee = conf ? conf.propertyValue : null;
        try {
            let company = await organizationCollection(ctx).findOne({name: app.systemConf.company});
            let customers = await customerCollection(ctx).find().toArray();
            let activatedFacilityIds = _.uniq(_.flatMap(customers, "activatedFacilityIds"));
            let orgIds = _.union(_.map(customers, "orgId"), activatedFacilityIds);
            let organizations = await organizationCollection(ctx).find({_id: {$in: orgIds}}).toArray();
            let organizationMap = _.keyBy(organizations, "_id");
            let organizationExtend = await organizationExtendCollection(ctx).find({orgId: {$in: _.map(customers, "orgId")}}).toArray();
            let organizationExtendMap = _.keyBy(organizationExtend, "orgId");

            let resultData = [];

            let billingOrgRecords = await initBillingOrgRecordCollection(ctx).find({orgType: "CUSTOMER"}).toArray();
            if (!_.isEmpty(customers)) {
                let records = [];
                for (let customer of customers) {
                    let orgId = customer.orgId;
                    if (!checkOrgIsInit(orgId, billingOrgRecords)) {
                        let activatedFacilityIds = customer.activatedFacilityIds;
                        let processCount = 0;
                        if (activatedFacilityIds) {
                            let roles = await fdApp(ctx).get("/organization-relationship/get-relationship-tags/" + company._id + "/" + orgId + "");
                            for (let facId of activatedFacilityIds) {
                                let data = {
                                    AccountID: organizationExtendMap[orgId].customerCode,
                                    Category: "Customer",
                                    VendorName: organizationMap[orgId].name,
                                    VendorShortName: organizationMap[orgId].name,
                                    Description: "",
                                    Email: "",
                                    Program: "Wise",
                                    CustomerID: organizationExtendMap[orgId].customerCode,
                                    CustomerName: organizationMap[orgId].name,
                                    SiteID: organizationMap[facId].name,
                                    Site: organizationMap[facId].name,
                                    TitleID: _.includes(roles, "Supplier") ? organizationExtendMap[orgId].customerCode : "",
                                    Title: _.includes(roles, "Supplier") ? organizationMap[orgId].name : ""

                                };
                                try {
                                    let initCustomerApi = processCount == 0 ? syncCustomerApiAdd : syncCustomerApiUpdate;
                                    let response = await billingService(ctx).postBillingApi(initCustomerApi, data);
                                    if (response && response.body && response.body.Status) {
                                        processCount++;
                                        data.status = true;
                                        data.message = "success";
                                        resultData.push(data);
                                    } else {
                                        data.status = false;
                                        data.message = response.body.ErrorMsg;
                                        resultData.push(data);
                                    }
                                } catch (ex) {
                                    console.log(ex);
                                    data.status = false;
                                    data.message = ex.message;
                                    resultData.push(data);
                                }


                            }


                            if (processCount == activatedFacilityIds.length) {
                                records.push({orgId: orgId, orgType: "CUSTOMER", isCreated: true});
                            }
                        }

                    }

                }

                try {
                    if (!_.isEmpty(records)) {
                        let res = await fdApp(ctx).post("/init-billing-org-record/batchCreate", records);
                    }

                } catch (ex) {
                    console.log(ex);
                }

            }

            let emailBody = _buildMailBody(resultData);
            await app.sendMail("Billing Sync Customers", emailBody, null, billConsignee);

            return resultData;
        } catch (ex) {
            console.log(ex);
            let mesg = `Fail:${ex.status}<br/>${ex.message}<br/><br/>${ex.stack}<br/><br/>`;
            await app.sendMail("Billing Sync Customers Fail", mesg, null, billConsignee);

        }


    }

    async function syncMaterials() {
        let configurations = await configurationCollection(ctx).find({propertyGroup: "BillingConfiguration"}).toArray();
        let conf = _.find(configurations, conf => conf.propertyName === "Consignee");
        let billConsignee = conf ? conf.propertyValue : null;

        try {
            let materials = await itemSpecCollection(ctx).query({tags: ["MATERIAL"]}, {
                projection: {
                    name: 1,
                    customerId: 1,
                    titleIds: 1
                }
            });
            if (_.isEmpty(materials)) return;

            let resultData = [];
            let syncRecords = await initBillingOrgRecordCollection(ctx).find({orgType: "MATERIAL"}).toArray();
            let syncRecordMap = _.groupBy(syncRecords, "orgId");
            materials = _.filter(materials, material => !syncRecordMap[material._id]);
            if (_.isEmpty(materials)) return;

            let organizationIds = _.concat(_.uniq(_.map(materials, "customerId")));
            let titleIds = _.concat(_.uniq(_.flatMap(materials, "titleIds")));
            organizationIds = _.uniq(_.union(organizationIds, titleIds));
            let organizationMap = await organizationService(ctx).getOrganizationMap(organizationIds);

            let itemProperties = await itemPropertyCollection(ctx).find({name: {$in: ["SIZE", "MaterialProperty"]}}).toArray();
            let itemPropertyIds = _.map(itemProperties, property => property._id + "");
            let itemSpecFields = await itemSpecFieldCollection(ctx).find({
                itemSpecId: {$in: _.map(materials, "_id")},
                propertyId: {$in: itemPropertyIds}
            }).toArray();

            let sizeProperty = _.find(itemProperties, property => property.name === "SIZE");
            let materialProperty = _.find(itemProperties, property => property.name === "MaterialProperty");

            let records = [];
            for (let material of materials) {
                let mProperty = null;
                if (materialProperty) {
                    let itemSpecField = _.find(itemSpecFields, field => field.itemSpecId === material._id && field.propertyId === materialProperty._id.toString());
                    if (itemSpecField) {
                        mProperty = itemSpecField.value;
                    }
                }
                let size = null;
                if (materialProperty) {
                    let itemSpecField = _.find(itemSpecFields, field => field.itemSpecId === material._id && field.propertyId === sizeProperty._id.toString());
                    if (itemSpecField) {
                        size = itemSpecField.value;
                    }
                }
                let customer = organizationMap[material.customerId];
                let title = _.isEmpty(material.titleIds) ? null : organizationMap[material.titleIds[0]];

                let data = {
                    Program: "Wise",
                    Customer: customer ? (customer.customerCode ? customer.customerCode : customer.name) : "",
                    TitleID: title ? (title.customerCode ? title.customerCode : title.name) : "",
                    Material: material.name || "",
                    PalletSize: size || "",
                    MaterialProperty: mProperty || ""
                };
                try {
                    let response = await billingService(ctx).postBillingApi(syncMaterialsApi, data);
                    if (response && response.body && response.body.Status) {
                        data.status = true;
                        data.message = "success";
                        resultData.push(data);
                        records.push({orgId: material._id, orgType: "MATERIAL", isCreated: true});
                    } else {
                        data.status = false;
                        data.message = response.body.ErrorMsg;
                        resultData.push(data);
                    }

                } catch (ex) {
                    console.log(ex);
                    data.status = false;
                    data.message = ex.message;
                    resultData.push(data);
                }
            }
            await fdApp(ctx).post("/init-billing-org-record/batchCreate", records);

            let emailBody = _buildMailBody(resultData);
            await app.sendMail("Billing Sync Materials", emailBody, null, billConsignee);

            return resultData;

        } catch (ex) {
            console.log(ex);
            let mesg = `Fail:${ex.status}<br/>${ex.message}<br/><br/>${ex.stack}<br/><br/>`;
            await app.sendMail("Billing Sync Materials Fail", mesg, null, billConsignee);
        }
    }

    async function syncItems(param) {
        let configurations = await configurationCollection(ctx).find({propertyGroup: "BillingConfiguration"}).toArray();
        let conf = _.find(configurations, conf => conf.propertyName === "Consignee");
        let billConsignee = conf ? conf.propertyValue : null;
        try {
            let time = momentZone().add(-15, "minutes");
            let search = param && !_.isEmpty(param.itemSpecIds) ? {_id: {$in: param.itemSpecIds}} : await buildItemSearch(time);
            let items = await itemSpecCollection(ctx).find(search, {
                projection: {
                    _id: 1,
                    name: 1,
                    customerId: 1,
                    titleIds: 1,
                    supplierIds: 1,
                    grade: 1
                }
            }).toArray();

            if (_.isEmpty(items)) return;
            let customerIds = _.uniq(_.map(items, "customerId"));
            let titleIds = _.compact(_.flatMap(items, "titleIds"));
            let supplierIds = _.compact(_.flatMap(items, "supplierIds"));
            let orgIds = _.uniq(_.concat(customerIds, titleIds, supplierIds));
            let itemSpecIds = _.map(items, "_id");

            let [organizationMap, uoms] = await Promise.all([
                organizationService(ctx).getOrganizationMap(orgIds),
                itemUnitCollection(ctx).find({itemSpecId: {$in: itemSpecIds}}).toArray()
            ]);
            let uomGroup = _.groupBy(uoms, "itemSpecId");

            let itemProperties = await itemPropertyCollection(ctx).find({name: "TV Size"}).toArray();
            let itemPropertyIds = _.map(itemProperties, property => property._id + "");
            let itemSpecFields = await itemSpecFieldCollection(ctx).find({
                itemSpecId: {$in: itemSpecIds},
                propertyId: {$in: itemPropertyIds}
            }).toArray();
            let tvSizeProperty = _.find(itemProperties, property => property.name === "TV Size");

            let resultData = [];
            let records = [];
            for (let item of items) {
                let tvSize = _getTvSize(tvSizeProperty, itemSpecFields, item._id);
                let eaUom = _.find(uomGroup[item._id], {name: "EA"});
                let csUom = _.find(uomGroup[item._id], {name: "CS"});
                let data = {
                    Company: app.systemConf.company,
                    Facility: app.systemConf.facility,
                    Customer: organizationMap[item.customerId] ? (organizationMap[item.customerId].customerCode ? organizationMap[item.customerId].customerCode : organizationMap[item.customerId].name) : "",
                    Title: getOrgNameByIds(item.titleIds, organizationMap),
                    Supplier: getOrgNameByIds(item.supplierIds, organizationMap),
                    Item: item.name,
                    ItemGrade: item.grade || "",
                    ItemType: tvSize ? tvSize : "",
                    ItemUOM: getDefaultUom(uomGroup[item._id]),
                    ItemEAVOL: itemUnitService(ctx).getCftByUOM(eaUom),
                    ItemCSVOL: itemUnitService(ctx).getCftByUOM(csUom),
                    VolumeUOM: app.defaultValues.volumeUOM,
                    ItemEAWGT: itemUnitService(ctx).getWeightByUOM(eaUom),
                    ItemCSWGT: itemUnitService(ctx).getWeightByUOM(csUom),
                    WeightUOM: app.defaultValues.weightUOM,
                    ItemEAAREA: itemUnitService(ctx).getSquareByUOM(eaUom),
                    ItemCSAREA: itemUnitService(ctx).getSquareByUOM(csUom),
                    AreaUOM: app.defaultValues.areaUOM
                };

                try {
                    let response = await billingService(ctx).postBillingApi(syncItemApi, [data]);
                    if (response && response.body && response.body.Status) {
                        data.status = true;
                        data.message = "success";
                        resultData.push(data);
                        records.push({itemSpecId: item._id, isCreated: true});
                    } else {
                        data.status = false;
                        data.message = response.body.ErrorMsg;
                        resultData.push(data);
                    }

                } catch (ex) {
                    console.log(ex);
                    data.status = false;
                    data.message = ex.message;
                    resultData.push(data);
                }

            }

            let emailBody = _buildMailBody(resultData);
            await app.sendMail("Billing Sync Items", emailBody, null, billConsignee);

            return resultData;
        } catch (ex) {
            console.log(ex);
            let mesg = `Fail:${ex.status}<br/>${ex.message}<br/><br/>${ex.stack}<br/><br/>`;
            await app.sendMail("Billing Sync Items Fail", mesg, null, billConsignee);
        }

    }

    function getDefaultUom(uoms) {
        if (_.isEmpty(uoms)) return "";
        for (let uom of uoms) {
            if (uom.isDefaultUnit) {
                return uom.name;
            }
        }
        return "";
    }

    async function buildItemSearch(time) {
        let itemUnits = await itemUnitCollection(ctx).find({updatedWhen: {$gt: new Date(time)}}).toArray();
        let itemSpecIds = _.uniq(_.map(itemUnits, "itemSpecId"));
        let search = _.isEmpty(itemSpecIds) ? {updatedWhen: {$gt: new Date(time)}} : {$or: [{updatedWhen: {$gt: new Date(time)}}, {_id: {$in: itemSpecIds}}]};
        return search;

    }

    function getOrgNameByIds(orgIds, organizationMap) {
        if (_.isEmpty(orgIds)) return "";
        let orgNames = [];
        _.forEach(orgIds, orgId => {
            let name = organizationMap[orgId] ? (organizationMap[orgId].customerCode ? organizationMap[orgId].customerCode : organizationMap[orgId].name) : "";
            if (name) {
                orgNames.push(name);
            }
        })
        return orgNames.join(',');
    }

    function _getTvSize(tvSizeProperty, itemSpecFields, itemSpecId) {
        let tvSize = null;
        if (tvSizeProperty) {
            let itemSpecField = _.find(itemSpecFields, field => field.itemSpecId === itemSpecId && field.propertyId === tvSizeProperty._id.toString());
            if (itemSpecField) {
                tvSize = itemSpecField.value;
            }
        }
        return tvSize;
    }

    return {
        syncFacilities,
        syncCustomers,
        syncMaterials,
        syncItems
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
