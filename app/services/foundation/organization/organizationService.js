const _ = require('lodash');

let service = (app, ctx) => {
    async function getOrganizationMap(orgIds) {
        return await app.util.getMapFromCache(ctx.cached.orgMap, orgIds, _getOrganizationMap);
    }

    function getOrganizationNameById(orgId, organizationMap) {
        return organizationMap[orgId] ? organizationMap[orgId].name : ""
    }

    async function _getOrganizationMap(orgIds) {
        if (!orgIds || orgIds.length === 0) return {};

        let organizations = await organizationCollection(ctx).find({_id: {$in: orgIds}}).toArray();
        let organizationExtends = await organizationExtendCollection(ctx).find({orgId: {$in: orgIds}}).toArray();
        let customers = await customerCollection(ctx).find({orgId: {$in: orgIds}}).toArray();
        let customerMap = _.keyBy(customers, "orgId");
        let organizationExtendMap = _.keyBy(organizationExtends, "orgId");

        let data = [];
        _.forEach(organizations, org => {
            let customer = customerMap[org._id];
            data.push({
                id: org._id,
                name: org.name,
                customerCode: organizationExtendMap[org._id] && organizationExtendMap[org._id].customerCode ? organizationExtendMap[org._id].customerCode : "",
                storageFreeOfChargeHours: customer ? customer.storageFreeOfChargeHours : null,
                outBoundBillingLevel: customer ? customer.outBoundBillingLevel : null,
                billingPalletQtyPercent: customer ? customer.billingPalletQtyPercent : null,
                inventoryReportExcludeMakePalletAdjustRecord: customer ? customer.inventoryReportExcludeMakePalletAdjustRecord : false,
                orderTotalPalletsFirst: customer && customer.bolOtherOptions ? customer.bolOtherOptions.orderTotalPalletsFirst : false
            });
        });

        return _.keyBy(data, "id");
    }

    async function getBillingCustomers() {
        let invs = await wmsMysql(ctx).query("select distinct customerId from inventory where qty>0");
        let customerIds = _.map(invs, "customerId");
        let customers = await customerCollection(ctx).find({
            orgId: {$in: customerIds},
            billingPay: true
        }, {projection: {orgId: 1}}).toArray();
        customerIds = _.map(customers, "orgId");
        return customerIds;
    }

    function getOrganizationContact(org) {
        let contacts = org.extend && org.extend.contacts ? org.extend.contacts : [];
        let contact = {};
        contact.name = _.map(_.filter(contacts, o => !_.isEmpty(o.name)), "name").join(",");
        contact.phone = _.map(_.filter(contacts, o => !_.isEmpty(o.phone)), "phone").join(",");
        contact.email = _.map(_.filter(contacts, o => !_.isEmpty(o.email)), "email").join(",");
        contact.type = _.map(_.filter(contacts, o => !_.isEmpty(o.type)), "type").join(",");
        return contact;
    }

    async function getReport(param) {
        let organizations = await commonService(ctx).getAllPageDataFromAPI(fdApp, "/organization-relationship/search-by-paging", param, "organizations");
        if (!organizations || organizations.length === 0) return [];

        let data = [];
        _.forEach(organizations, org => {
            let contact = getOrganizationContact(org);
            data.push({
                Name: org.basic.name,
                "Customer Code": org.extend && org.extend.customerCode ? org.extend.customerCode : "",
                Tags: org.roles ? org.roles.join(",") : "",
                Contact: contact.name ? contact.name : "",
                Phone: contact.phone ? contact.phone : "",
                Email: contact.email ? contact.email : "",
                Department: contact.type ? contact.type : "",
                Note: org.extend && org.extend.note ? org.extend.note : ""
            });
        });
        return {
            head: header,
            data: data
        }
    }

    let header = [
        "Name",
        "Customer Code",
        "Tags",
        "Contact",
        "Phone",
        "Email",
        "Department",
        "Note"
    ];

    async function getOrganizationBasicMap(orgIds) {
        return await app.util.getMapFromCache(ctx.cached.orgBasicMap, orgIds, _getOrganizationBasicMap);
    }

    async function _getOrganizationBasicMap(orgIds) {
        if (!orgIds || orgIds.length === 0) return {};
        let organizations = await organizationCollection(ctx).find({_id: {$in: orgIds}}).toArray();
        return _.keyBy(organizations, "_id");
    }

    return {
        getOrganizationMap,
        getBillingCustomers,
        getReport,
        getOrganizationBasicMap,
        getOrganizationNameById
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};