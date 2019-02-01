const os = require('os');
const ObjectID = require('mongodb-core').BSON.ObjectID;
const moment = require('moment');

let service = (app, ctx) => {
    let reportHeader = [];

    async function searchByPaging(param) {
        let appointmentPagingResult = await wmsApp(ctx).post(`/appointment/search-by-paging`, param);
        if (_.isEmpty(appointmentPagingResult.appointments)) {
            return buildReportResult([], _.get(appointmentPagingResult, "paging"));
        }
        let outboundScheduleImports = await _fillOutboundSchedules(appointmentPagingResult);
        return buildReportResult(outboundScheduleImports, _.get(appointmentPagingResult, "paging"));
    }

    function buildReportResult(data, paging) {
        return {
            results: {
                head: _getHeader(),
                data: data
            },
            paging: paging
        };
    }

    async function _fillOutboundSchedules(schedules) {
        // let orderIds = _.uniq(_.map(schedules.appointments, "orderId"));
        let loadIds = _.uniq(_.flatMap(schedules.appointments, "documentNos"));
        if (_.isEmpty(loadIds)) return;
        // let orderIds = ["DN-26860", "DN-26859", "DN-26853", "DN-26844"];
        let loads = await loadCollection(ctx).find({_id: {$in: loadIds}}).toArray();
        let loadOrderLines = await loadOrderLineCollection(ctx).find({loadId: {$in: loadIds}}).toArray();
        let orderIds = _.uniq(_.map(loadOrderLines, "orderId"));
        let orders = await orderCollection(ctx).find({_id: {$in: orderIds}}).toArray();
        let orderItemLines = await orderItemLineCollection(ctx).find({orderId: {$in: orderIds}}).toArray();

        let sql = `select * from lp where orderId in ('${orderIds.join("','")}') AND status='STAGED' ORDER BY updatedWhen DESC`;
        let lps = await wmsMysql(ctx).query(sql);
        let locationIds = _.map(lps, "locationId");
        let locationsMap = {};
        if (!_.isEmpty(locationIds)) {
            let locations = await locationCollection(ctx).find({_id: {$in: locationIds}}).toArray();
            locations.forEach(location => {
                locationsMap[location._id] = location
            });
        }

        let itemSpecIds = _.map(orderItemLines, "itemSpecId");
        let unitIds = _.uniq(_.map(orderItemLines, "unitId"));
        unitIds = _.map(unitIds, unitId => new ObjectID(unitId));
        let orgIds = _.union(_.map(orders, "customerId"), _.map(orders, "retailerId"), _.map(orders, "carrierId"), _.map(orderItemLines, "supplierId"), _.map(orderItemLines, "titleId"), _.map(orders, "shipToAddress.organizationId"), _.map(loads, "carrierId"));
        let orgs = await organizationCollection(ctx).find({_id: {$in: orgIds}}).toArray();
        let itemSpecs = await itemSpecCollection(ctx).find({_id: {$in: itemSpecIds}}).toArray();
        let units = await itemUnitCollection(ctx).find({_id: {$in: unitIds}}).toArray();
        let cftUnits = await fdApp(ctx).get(`/cft-unit/conversion`);
        let ordersMap = {};
        let orgsMap = {};
        let itemSpecsMap = {};
        let unitsMap = {};
        let cftUnitMap = {};
        let loadMap = {};
        let orderMapByReferenceNo = _.keyBy(orders, "referenceNo");
        let orderMapById = _.keyBy(orders, "_id");

        orders.forEach(order => ordersMap[order._id] = order);
        orgs.forEach(org => orgsMap[org._id] = org);
        itemSpecs.forEach(itemSpec => itemSpecsMap[itemSpec._id] = itemSpec);
        units.forEach(unit => unitsMap[unit._id] = unit);
        cftUnits.forEach(cftUnit => cftUnitMap[cftUnit.id] = cftUnit);
        loads.forEach(load => loadMap[load._id] = load);

        let reports = [];

        for (let schedule of schedules.appointments) {
            let loadOrders = _.filter(loadOrderLines, function (o) {
                if (o.loadId == _.head(schedule.documentNos)) {
                    return true;
                }
            });

            _.each(loadOrders, function (loadOrder) {
                let order = orderMapById[_.get(loadOrder, "orderId")];;
                let orderId = _.get(order, "_id");

                let itemLines = _.filter(orderItemLines, {'orderId': orderId});
                let supplerName = [];
                let cubicFeet = 0;
                itemLines.forEach(itemLine => {
                    if (orgsMap[itemLine.titleId]) {
                        supplerName.push(orgsMap[itemLine.titleId].name);
                    }

                    let itemUnit = unitsMap[itemLine.unitId];
                    let cft = 0;
                    if (itemUnit.linearUnit) {
                        if (itemUnit.length) {
                            cft = itemUnit.length;
                        }
                        if (itemUnit.width) {
                            cft *= itemUnit.width;
                        }
                        if (itemUnit.height) {
                            cft *= itemUnit.height;
                        }
                        itemUnit.cft = cft * cftUnitMap[_.toUpper(itemUnit.linearUnit)].value;
                    } else {
                        itemUnit.cft = 0;
                    }
                    cubicFeet += cft;
                });

                let stagingAreaName = [];
                _.filter(lps, {"orderId": orderId}).forEach(lp => {
                    if (locationsMap[lp.locationId]) {
                        stagingAreaName.push(locationsMap[lp.locationId].name);
                    }
                });


                reports.push({
                    "WHSEID": app.systemConf.facility,
                    "Scheduled Date": formatDate(_.get(schedule, "createdWhen")),
                    "Appointment Date": formatDate(_.get(schedule, "appointmentTime")),
                    "Ordered Date": formatDate(_.get(order, "orderedDate")),
                    "Requested Date": formatDate(_.get(order, "createdWhen")),
                    "Carrier": orgsMap[_.get(loadMap[_.head(_.get(schedule, "documentNos"))], "carrierId")] ? orgsMap[_.get(loadMap[_.head(_.get(schedule, "documentNos"))], "carrierId")].name : orgsMap[_.get(order, "carrierId")].name,
                    "Staging Area": _.isEmpty(stagingAreaName) ? app.systemConf.facility : _.toString(stagingAreaName),
                    "Customer Id": orgsMap[_.get(order, "customerId")] ? orgsMap[_.get(order, "customerId")].name : null,
                    "Account Id": orgsMap[_.get(order, "retailerId")] ? orgsMap[_.get(order, "retailerId")].name : null,
                    "Supplier Id": _.toString(supplerName),
                    "Order No": _.get(order, "_id"),
                    "Status": _.get(order, "status"),
                    "Reference No": _.get(order, "referenceNo"),
                    "Po No": _.get(order, "poNo"),
                    "Load No": _.get(loadMap[_.head(_.get(schedule, "documentNos"))], "loadNo"),
                    "Shipped Date": _.includes(["Partial Shipped", "Short Shipped", "Shipped", "Closed"], _.get(order, "status")) ? _.get(order, "updateWhen") : null,
                    "Scan Item": !_.isEmpty(_.head(itemLines)) ? (itemSpecsMap[_.head(itemLines).itemSpecId].hasSerialNumber ? "Y" : "N") : "N",
                    "SN": !_.isEmpty(_.head(itemLines)) ? (itemSpecsMap[_.head(itemLines).itemSpecId].hasSerialNumber ? "Y" : "N") : "N",
                    "Ship To": _.get(order, "shipToAddress.organizationName"),
                    "Ordered Qty": _.sumBy(itemLines, "qty"),
                    "Shipped Qty": _.sumBy(itemLines, "shippedQty"),
                    "Pallet Qty": _.sumBy(itemLines, "palletQty"),
                    "Cubic Feet": _.round(cubicFeet, 2),
                    "Invoice No": null
                });
            });


        }
        return reports;
    }

    function _getHeader() {
        return ["WHSEID",
            "Scheduled Date",
            "Appointment Date",
            "Ordered Date",
            "Requested Date",
            "Carrier",
            "Staging Area",
            "Customer Id",
            "Account Id",
            "Supplier Id",
            "Order No",
            "Status",
            "Reference No",
            "Po No",
            "Load No",
            "Shipped Date",
            "Scan Item",
            "SN",
            "Ship To",
            "Ordered Qty",
            "Shipped Qty",
            "Pallet Qty",
            "Cubic Feet",
            "Invoice No"
        ]
    }

    function formatDate(val) {
        if (val) {
            return moment(val).format('MM/DD/YYYY HH:mm:ss')
        } else {
            return "";
        }
    }

    async function downloadReport(param) {
        let report = await commonService(ctx).getAllPages(outboundScheduleImportReport(ctx).searchByPaging, param);
        return report;
    }

    return {
        downloadReport,
        searchByPaging
    };
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};