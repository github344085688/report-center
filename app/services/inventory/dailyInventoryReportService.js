let service = (app, ctx) => {
    async function report(criteria) {
        let customerId = criteria.customerId;
        let ftpFilePath = criteria.ftpFilePath;
        let connection = {
            host: criteria.ftpHost,
            port: criteria.ftpPort,
            user: criteria.ftpUser,
            password: criteria.ftpPassword
        };



        let head = [
            "Item",
            "Item Description",
            "Product",
            "SN",
            "Lot No.",
            "Expiration Date",
            "Mfg Date",
            "Shelf Life Days",
            "QTY",
            "Unit",
            "Conversion QTY",
            "Conversion Unit",
            "Total Weight",
            "Weight Unit",
            "Total CFT",
            "Status",
            "Item Status",
            "LP",
            "Location",
            "Customer",
            "Title",
            "Receipt ID",
            "Order ID",
            "Po No.",
            "Container No.",
            "Pallet No.",
            "Receive Date"
        ];

        let inventories = await wmsMysql(ctx).selectAll(`select b.locationId,a.* from inventory a,lp b where a.status not in('SHIPPED') and a.qty >0 and a.lpId = b.id and a.customerId ='${customerId}' `)
        if (_.isEmpty(inventories)) {
            return;
        }
        let itemSpecIds = _.uniq(_.map(inventories, "itemSpecId"));
        let locationIds = _.compact(_.uniq(_.map(inventories, "locationId")));
        let titleIds = _.compact(_.uniq(_.map(inventories, "titleId")));

        let [customerMap, itemMap, itemUnitMap, locationMap, titleMap] = await Promise.all([
            _getOrganizationMap([customerId]),
            _getItemMap(itemSpecIds, customerId),
            _getItemUnitMap(itemSpecIds),
            _getLocationMap(locationIds),
            _getOrganizationMap(titleIds)
        ]);

        let data = [];
        _.forEach(inventories, inv => {
            let itemUnit = itemUnitMap[inv.unitId];
            data.push({
                "Item": itemMap[inv.itemSpecId] ? itemMap[inv.itemSpecId].name : "",
                "Item Description": itemMap[inv.itemSpecId] ? itemMap[inv.itemSpecId].desc : "",
                "SN": inv.sn || "",
                "Lot No.": inv.lotNo || "",
                "Expiration Date": inv.expirationDate ? momentZone(inv.expirationDate).format("YYYY-MM-DD HH:mm:ss") : "",
                "Mfg Date": inv.mfgDate || "",
                "Shelf Life Days": inv.shelfLifeDays || "",
                "QTY": inv.qty,
                "Unit": itemUnit ? itemUnit.name : "",
                "Conversion QTY": inv.conversionQty || "",
                "Conversion Unit": inv.conversionUOM || "",
                "Total Weight": (!inv.weight ? inv.weight : ((!itemUnit && !itemUnit.weight) ? itemUnit.weight * inv.qty : 0)),
                "Weight Unit": itemUnit ? (itemUnit.weightUnit ? itemUnit.weightUnit : "Pound") : "Pound",
                "Total CFT": itemUnitService(ctx).getCftByUOM(itemUnit) * inv.qty,
                "Status": inv.status,
                "Item Status": itemMap[inv.itemSpecId] ? itemMap[inv.itemSpecId].status : "",
                "LP": inv.lpId,
                "Location": locationMap[inv.locationId] ? locationMap[inv.locationId].name : "",
                "Customer": customerMap[customerId].name,
                "Title": titleMap[inv.titleId] ? titleMap[inv.titleId].name : "",
                "Receipt ID": inv.receiptId || "",
                "Order ID": inv.orderId || "",
                "Po No.": inv.poNo || "",
                "Container No.": inv.containerNo || "",
                "Pallet No.": inv.palletNo || "",
                "Receive Date": inv.receivedWhen ? momentZone(inv.receivedWhen).format("YYYY-MM-DD HH:mm:ss") : ""
            })


        })
        let reportData = {
            data: data,
            head: head
        };

        let file = await jsonCovertToXlsx(reportData, customerMap[customerId].name);
        let ftp = await app.FtpUtil.connect(connection);
        await app.FtpUtil.upload(ftp, file.filePath, ftpFilePath + "/" + file.fileName);
        await app.FtpUtil.end(ftp);
    }

    async function _getOrganizationMap(orgIds) {
        let customers = await organizationCollection(ctx).find({_id: {$in: orgIds}}, {
            projection: {
                '_id': 1,
                'name': 1
            }
        }).toArray();

        let customerMap = _.keyBy(customers, "_id");
        return customerMap;
    }


    async function _getItemMap(itemSpecIds, customerId) {
        let items = await itemSpecCollection(ctx).find({_id: {$in: itemSpecIds}, customerId: customerId}, {
            projection: {
                '_id': 1,
                'name': 1,
                'desc': 1,
                'status': 1
            }
        }).toArray();
        let itemMap = _.keyBy(items, "_id");
        return itemMap;
    }

    async function _getLocationMap(locationIds) {
        let locations = await locationCollection(ctx).find({_id: {$in: locationIds}}, {
            projection: {
                '_id': 1,
                'name': 1
            }
        }).toArray();
        let locationMap = _.keyBy(locations, "_id");
        return locationMap;
    }

    async function _getItemUnitMap(itemSpecIds) {
        let itemUnits = await itemUnitCollection(ctx).find({itemSpecId: {$in: itemSpecIds}}, {
            projection: {
                '_id': 1,
                'name': 1,
                'weight': 1,
                'weightUnit': 1,
                'cft': 1,
                'width': 1,
                'length': 1,
                'height': 1,
                'linearUnit': 1

            }
        }).toArray();
        let itemUnitMap = _.keyBy(itemUnits, "_id");
        return itemUnitMap;
    }

    return {
        report
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};