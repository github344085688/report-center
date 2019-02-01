const _ = require('lodash');

let service = (app, ctx) => {

    async function _getCurrentInventories(param) {
        let dateFrom = momentZone().format('YYYY-MM-DD');

        let sentReportManuals = await billingManualCollection(ctx).query({
            type: "INV_REPORT",
            sentWhen: {
                $gte: new Date(dateFrom)
            }
        });
        let sentCustomerIds = _.uniq(_.map(_.filter(sentReportManuals, o => !_.isEmpty(o.customerId)), "customerId"));
        let customerIds = _.filter(param.customerIds, id => !_.includes(sentCustomerIds, id));
        if (customerIds.length === 0) return [];

        let sqlWhere = `where status in('AVAILABLE','DAMAGE','ON_HOLD') and customerId in('${customerIds.join("','")}') and qty>0`;
        let [inventories, onShippingInventories] = await Promise.all([
            wmsMysql(ctx).selectAll(`select ${tabelFieldMap.inventoryFields} from inventory ${sqlWhere}`),
            inventoryService(ctx).getOnShippingInventoryStorage(customerIds)
        ]);
        inventories = _.union(inventories, onShippingInventories);

        return inventories;
    }

    async function _getHistoryInventories(param) {
        let inventories = [];
        let _ctx = await app.createCtx();
        for (let customerId of param.customerIds) {
            let invs = await inventoryService(_ctx).getHistoryInventory(customerId, null, param.date);
            inventories = _.union(inventories, invs);
        }

        let invRes = _.filter(inventories, inv => {
            return inv.status === "AVAILABLE" || inv.status === "ON_HOLD" || inv.status === "DAMAGE";
        });

        return invRes;
    }

    async function _getInventories(param) {
        let inventories = [];
        if (!param.date) {
            inventories = await _getCurrentInventories(param);
        } else {
            let timeNow = momentZone().startOf('day');
            let date = momentZone(param.date);
            if (date >= timeNow) {
                let sqlWhere = `where status in('AVAILABLE','DAMAGE','ON_HOLD') and customerId in('${param.customerIds.join("','")}') and qty>0`;
                inventories = await wmsMysql(ctx).selectAll(`select ${tabelFieldMap.inventoryFields} from inventory ${sqlWhere}`);
                let onShippingInventories = await inventoryService(ctx).getOnShippingInventoryStorage(param.customerIds);
                inventories = _.union(inventories, onShippingInventories);

            } else {
                inventories = await _getHistoryInventories(param);
            }
        }
        return inventories;
    }

    function _getTvSize(tvSizeProperty, itemSpecFields, inventory) {
        let tvSize = null;
        if (tvSizeProperty) {
            let itemSpecField = _.find(itemSpecFields, field => field.itemSpecId === inventory.itemSpecId && field.propertyId === tvSizeProperty._id.toString());
            if (itemSpecField) {
                tvSize = itemSpecField.value;
            }
        }
        return tvSize;
    }

    async function _groupInventoryPallet(inventories, uomMap, eaUomMap) {
        let itemSpecIds = _.uniq(_.map(inventories, "itemSpecId"));
        let itemLpConfigurations = await itemLpConfigurationService(ctx).getItemLpConfigurations(itemSpecIds);

        let palletInvs = [];
        let invsGroup = _.groupBy(inventories, inv => inv.lpId + inv.itemSpecId + inv.titleId + inv.supplierId + inv.receiptId);
        _.forEach(invsGroup, (invs, key) => {
            let itemSpecId = invs[0].itemSpecId;
            let eaUom = eaUomMap[itemSpecId];
            let lpConfiguration = _.find(itemLpConfigurations, conf => conf.itemSpecId === itemSpecId && conf.isDefault);

            let eaQty = 0;
            _.forEach(invs, inv => {
                let uom = uomMap[inv.unitId];
                if (uom) {
                    eaQty += inv.qty * uom.baseQty;
                }
            })

            if (invs.length === 1) {
                palletInvs = _.union(palletInvs, invs);
            } else {
                palletInvs.push({
                    lpId: invs[0].lpId,
                    itemSpecId: itemSpecId,
                    unitId: eaUom ? eaUom._id.toString() : "",
                    qty: eaQty,
                    customerId: invs[0].customerId,
                    titleId: invs[0].titleId,
                    supplierId: invs[0].supplierId,
                    palletType: lpConfiguration ? lpConfiguration.templateName : "",
                    palletQty: lpConfiguration ? Math.ceil(eaQty / lpConfiguration.totalEAQty) : 1,
                    createdWhen: invs[0].createdWhen,
                    receiptId: invs[0].receiptId
                });
            }

        })

        return palletInvs;
    }

    function _getReportDate(param) {
        let inventoryReportedDate = param.date;
        if (!inventoryReportedDate) {
            let hour = momentZone().hour();
            if (hour === 24 || hour === 0) {
                inventoryReportedDate = momentZone().add(-1, "hours").format('YYYY-MM-DD HH:mm:ss');
            } else {
                inventoryReportedDate = momentZone().format('YYYY-MM-DD HH:mm:ss');
            }
        }
        return inventoryReportedDate;
    }

    async function getReport(param) {
        if (!param || !param.customerIds || param.customerIds.length === 0) {
            return [];
        }
        let inventories = await _getInventories(param);
        if (!inventories || inventories.length === 0) return [];

        let itemSpecIds = _.uniq(_.map(inventories, "itemSpecId"));
        let [items, uoms] = await Promise.all([
            itemSpecCollection(ctx).find({_id: {$in: itemSpecIds}}, {projection: tabelFieldMap.itemSpecFields}).toArray(),
            itemUnitCollection(ctx).find({itemSpecId: {$in: itemSpecIds}}).toArray()
        ]);
        let itemMap = _.keyBy(items, "_id");
        let uomMap = _.keyBy(uoms, "_id");
        let csUoms = _.filter(uoms, uom => uom.name === "CS");
        let csUomMap = _.keyBy(csUoms, "itemSpecId");
        let eaUoms = _.filter(uoms, uom => uom.name === "EA");
        let eaUomMap = _.keyBy(eaUoms, "itemSpecId");

        let itemProperties = await itemPropertyCollection(ctx).find({name: "TV Size"}).toArray();
        let itemPropertyIds = _.map(itemProperties, property => property._id + "");
        let itemSpecFields = await itemSpecFieldCollection(ctx).find({
            itemSpecId: {$in: itemSpecIds},
            propertyId: {$in: itemPropertyIds}
        }).toArray();
        let tvSizeProperty = _.find(itemProperties, property => property.name === "TV Size");

        let customerIds = _.uniq(_.map(_.filter(inventories, inventory => !_.isEmpty(inventory.customerId)), "customerId"));
        let titleIds = _.uniq(_.map(_.filter(inventories, inventory => !_.isEmpty(inventory.titleId)), "titleId"));
        let supplierIds = _.uniq(_.map(_.filter(inventories, inventory => !_.isEmpty(inventory.supplierId)), "supplierId"));
        let organizationIds = _.uniq(_.union(titleIds, customerIds, supplierIds));
        let receiptIds = _.compact(_.uniq(_.map(inventories, "receiptId")));
        let lpIds = _.compact(_.uniq(_.map(inventories, "lpId")));

        let [organizationMap, receipts, lpMap] = await Promise.all([
            organizationService(ctx).getOrganizationMap(organizationIds),
            receiptCollection(ctx).find({_id: {$in: receiptIds}}, {projection: tabelFieldMap.receiptFields}).toArray(),
            lpService(ctx).getLpWithTemplateMap(lpIds)
        ]);
        let receiptMap = _.keyBy(receipts, "_id");

        let palletInventories = await _groupInventoryPallet(inventories, uomMap, eaUomMap);
        let inventoryReportedDate = _getReportDate(param);
        let lpStackMap = await locationService(ctx).getLocationStackLpIdMap(lpIds);

        let report = [];
        for (let inventory of palletInventories) {
            let item = itemMap[inventory.itemSpecId];
            let uom = uomMap[inventory.unitId];
            let [isCaseUom, isPieceUom] = await Promise.all([
                itemUnitService(ctx).isCaseUom(uom),
                itemUnitService(ctx).isPieceUom(uom)
            ]);
            let csUom = isCaseUom ? uom : csUomMap[inventory.itemSpecId];
            let eaUom = isPieceUom ? uom : eaUomMap[inventory.itemSpecId];
            let tvSize = _getTvSize(tvSizeProperty, itemSpecFields, inventory);
            let eaQty = 0;
            let csQty = 0;
            if (uom) {
                eaQty = inventory.qty * uom.baseQty;
            }
            if (csUom) {
                csQty = Math.ceil(eaQty / csUom.baseQty);
                //eaQty = eaQty % csUom.baseQty;
            }
            let receipt = receiptMap[inventory.receiptId];
            let lp = lpMap[inventory.lpId];
            let customer = organizationMap[inventory.customerId];
            let title = organizationMap[inventory.titleId];
            let supplier = organizationMap[inventory.supplierId];
            let devannedDate = inventory.receivedWhen || inventory.createdWhen;
            let data = {
                Company: app.systemConf.company,
                Facility: app.systemConf.facility,
                ReceiptID: inventory.receiptId ? inventory.receiptId : "",
                Customer: customer ? (customer.customerCode ? customer.customerCode : customer.name) : "",
                Title: title ? (title.customerCode ? title.customerCode : title.name) : "",
                Supplier: supplier ? (supplier.customerCode ? supplier.customerCode : supplier.name) : "",
                LPNo: inventory.lpId ? inventory.lpId : "",
                Reference: receipt && receipt.referenceNo ? receipt.referenceNo : "",
                PO: receipt && receipt.poNo ? receipt.poNo : "",
                DevannedDate: devannedDate ? momentZone(devannedDate).format('YYYY-MM-DD HH:mm:ss') : "",
                Item: item ? item.name : "",
                ItemGrade: item && item.grade ? item.grade : "",
                ItemType: tvSize ? tvSize : "",
                ItemQty: inventory.qty,
                ItemEAQty: eaQty,
                ItemCSQty: csQty,
                ItemUOM: uom ? uom.name : "",
                PalletType: inventory.palletType ? inventory.palletType : (lp && lp.template ? lp.template : ""),
                PalletQty: inventory.palletQty ? inventory.palletQty : 1,
                ItemVOL: itemUnitService(ctx).getCftByUOM(uom),
                ItemEAVOL: itemUnitService(ctx).getCftByUOM(eaUom),
                ItemCSVOL: itemUnitService(ctx).getCftByUOM(csUom),
                VolumeUOM: app.defaultValues.volumeUOM,
                ItemWGT: itemUnitService(ctx).getWeightByUOM(uom),
                ItemCSWGT: itemUnitService(ctx).getWeightByUOM(csUom),
                ItemEAWGT: itemUnitService(ctx).getWeightByUOM(eaUom),
                WeightUOM: app.defaultValues.weightUOM,
                ItemAREA: itemUnitService(ctx).getSquareByUOM(uom),
                ItemEAAREA: itemUnitService(ctx).getSquareByUOM(eaUom),
                ItemCSAREA: itemUnitService(ctx).getSquareByUOM(csUom),
                AreaUOM: app.defaultValues.areaUOM,
                InventoryReportedDate: inventoryReportedDate,
                Stack: lpStackMap[inventory.lpId] || ""
            };
            report.push(data);
        }

        return {
            head: header,
            data: report
        }
    }

    let header = [
        'Company',
        'Facility',
        'ReceiptID',
        'Customer',
        'Title',
        'Supplier',
        'LPNo',
        'Reference',
        'PO',
        'DevannedDate',
        'Item',
        'ItemGrade',
        'ItemType',
        'ItemQty',
        'ItemEAQty',
        'ItemCSQty',
        'ItemUOM',
        'PalletType',
        'PalletQty',
        'ItemVOL',
        'ItemEAVOL',
        'ItemCSVOL',
        'VolumeUOM',
        'ItemWGT',
        'ItemCSWGT',
        'ItemEAWGT',
        'WeightUOM',
        'ItemAREA',
        'ItemEAAREA',
        'ItemCSAREA',
        'AreaUOM',
        'InventoryReportedDate'
    ];


    return {
        getReport
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};

