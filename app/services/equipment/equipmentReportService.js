let service = (app, ctx) => {
    async function searchByPaging(criteria) {
        let data = [];
        criteria.nullFields = ["checkOutTime", "checkOutEntry"];
        let result = await ymsApp(ctx).post('/yard-equipment/search-by-paging', criteria);
        if (!_.isEmpty(result.equipments)) {
            data = await _buildEquipmentReportData(result.equipments);
        }
        return {
            results: {
                data: data,
                head: ["Entry ID", "Entry Time", "Customer", "Equipment Type", "Equipment#", "Load Status", "Current Location", "Time in Yard"],
                shortHead: ["Entry ID", "Entry Time", "Equipment#", "Load Status", "Time in Yard"]
            },
            paging: result.paging
        }
    }

    async function _buildEquipmentReportData(equipments) {
        let data = [];
        let currentLocationMap = await _getLocationNameMap(equipments);
        let entryIdCustomerNameMap = await _getEntryCustomerMap(equipments);
        _.each(equipments, e => {
            let equipment = {
                "Entry ID": commonService(ctx).ensureNotNull(e.checkInEntry),
                "Entry Time": commonService(ctx).formatTimeToMMDDYYYYHHMM(e.checkInTime),
                "Customer": entryIdCustomerNameMap[e.checkInEntry],
                "Equipment Type": commonService(ctx).ensureNotNull(e.type),
                "Equipment#": commonService(ctx).ensureNotNull(e.equipmentNo),
                "Load Status": commonService(ctx).ensureNotNull(e.status),
                "Current Location": commonService(ctx).ensureNotNull(currentLocationMap[e.currentLocationId]),
                "Time in Yard": commonService(ctx).calculateDuration(e.checkInTime, momentZone())
            };
            data.push(equipment);
        });
        return data;
    }

    async function _getLocationNameMap(equipments) {
        let locationIds = _.uniq(_.map(equipments, "currentLocationId"));
        let locationMap = await locationService(ctx).getLocationMapById(locationIds);
        return _.mapValues(locationMap, o => o.name);
    }

    async function _getEntryCustomerMap(equipments) {
        let customerIds = [];
        let receiptCustomerIdMap = {};
        let loadCustomerIdMap = {};

        let entryIds = _.uniq(_.map(equipments, "checkInEntry"));
        if (_.isEmpty(entryIds)) return {};
        let entryTickets = await entryTicketActivityCollection(ctx).find({"entryId": {$in: entryIds}}).toArray();
        if (_.isEmpty(entryTickets)) return {};

        // get customerId from receipt
        let receiptIds = _.uniq(_.map(_.filter(entryTickets, o => 'RECEIVE' === o.taskType), "subTaskId"));
        if (!_.isEmpty(receiptIds)) {
            let receipts = await receiptCollection(ctx).find({"_id": {$in: receiptIds}}).toArray();
            if (!_.isEmpty(receipts)) {
                receiptCustomerIdMap = _.mapValues(_.keyBy(receipts, "_id"), o => o.customerId);
                customerIds = _.values(receiptCustomerIdMap);
            }
        }

        // get customerId from load
        let loadIds = _.uniq(_.map(_.filter(entryTickets, o => 'LOAD' === o.taskType), "subTaskId"));
        if (!_.isEmpty(loadIds)) {
            let loads = await loadCollection(ctx).find({"_id": {$in: loadIds}}).toArray();
            if (!_.isEmpty(loads)) {
                loadCustomerIdMap = _.mapValues(_.keyBy(loads, "_id"), o => o.customerId);
                customerIds = _.union(customerIds, _.values(loadCustomerIdMap));
            }
        }

        // combine customerIds and get customerIdNameMap
        let customerMap = await organizationService(ctx).getOrganizationBasicMap(customerIds);
        let customerIdNameMap = _.mapValues(customerMap, o => o.name);

        //build subTaskId customerName map
        let subTaskIdCustomerNameMap = {};
        _.each(receiptCustomerIdMap, (customerId, receiptId) => {
            subTaskIdCustomerNameMap[receiptId] = commonService(ctx).ensureNotNull(customerIdNameMap[customerId]);
        });
        _.each(loadCustomerIdMap, (customerId, loadId) => {
            subTaskIdCustomerNameMap[loadId] = commonService(ctx).ensureNotNull(customerIdNameMap[customerId]);
        });

        //fill customerName to entryTickets
        _.each(entryTickets, e => {
            e.customerName = subTaskIdCustomerNameMap[e.subTaskId];
        });

        return _.mapValues(_.keyBy(entryTickets, "entryId"), o => o.customerName);
    }

    return {
        searchByPaging
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};