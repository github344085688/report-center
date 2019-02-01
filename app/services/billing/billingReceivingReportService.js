const _ = require('lodash');

let service = (app, ctx) => {

    async function _getReceiptsByCustomerIds(customerIds) {
        if (!customerIds || customerIds.length === 0) {
            return [];
        }

        let startTime = momentZone().add(-62, 'days').startOf('day').format('YYYY-MM-DD HH:mm:ss');
        let sentReportManuals = await billingManualCollection(ctx).query({
            type: "RECEIVE_REPORT",
            sentWhen: {
                $gte: new Date(momentZone(startTime).format())
            }
        },{projection:{receiptId:1}});
        let sentReceiptIds = _.map(sentReportManuals, "receiptId");

        let completeReceiptStatus = ["CLOSED", "FORCE_CLOSED", "REOPENED"];
        startTime = momentZone().add(-60, 'days').startOf('day').format('YYYY-MM-DD HH:mm:ss');
        let receipts = await receiptCollection(ctx).query({
            customerId: {$in: customerIds},
            status: {$in: completeReceiptStatus},
            _id: {$nin: sentReceiptIds},
            devannedTime: {
                $gte: new Date(momentZone(startTime).format())
            }
        }, {projection:tabelFieldMap.receiptFields});


        let closedReceiptIds = _.map(receipts, "_id");
        startTime = momentZone().add(-12, 'hours').format('YYYY-MM-DD HH:mm:ss');
        let updateReceipts = await receiptCollection(ctx).find({
            _id: {$nin: closedReceiptIds},
            customerId: {$in: customerIds},
            status: {$in: completeReceiptStatus},
            updatedWhen: {
                $gte: new Date(momentZone(startTime).format())
            }
        }, {projection: {_id: 1}}).toArray();
        let updateReceiptIds = _.map(updateReceipts, "_id");
        updateReceipts = await receiptCollection(ctx).query({_id:{$in:updateReceiptIds}}, {projection:tabelFieldMap.receiptFields});
        receipts = _.union(receipts, updateReceipts);

        return receipts;
    }

    async function _getReceipts(param) {
        let receipts = [];
        if (param.receiptIds) {
            receipts = await receiptCollection(ctx).find({
                _id: {$in: param.receiptIds}
            }, {projection: tabelFieldMap.receiptFields}).toArray();

        } else if (param.customerIds) {
            receipts = await _getReceiptsByCustomerIds(param.customerIds);
        }
        return receipts;
    }

    async function _getReceiptLPs(receiptIds, invLpIds) {
        let receiveLpSetups = await receiveLpSetupCollection(ctx).find({"lpDetails.receiptId": {$in: receiptIds}}).toArray();
        let receiptLpMap = {};
        let lpIds = [];
        _.forEach(receiveLpSetups, lpSetup => {
            _.forEach(lpSetup.lpDetails, detail => {
                if (!detail.receiptId || !detail.lpId) return;
                lpIds.push(detail.lpId);
                if (receiptLpMap[detail.receiptId]) {
                    receiptLpMap[detail.receiptId].push(detail);
                } else {
                    receiptLpMap[detail.receiptId] = [detail];
                }
            })
        })
        lpIds = _.union(lpIds, invLpIds);
        return {receiptLpMap, lpIds};
    }

    function _getTvSize(tvSizeProperty, itemSpecFields, line) {
        let tvSize = null;
        if (tvSizeProperty) {
            let itemSpecField = _.find(itemSpecFields, field => field.itemSpecId === line.itemSpecId && field.propertyId === tvSizeProperty._id.toString());
            if (itemSpecField) {
                tvSize = itemSpecField.value;
            }
        }
        return tvSize;
    }

    function _buildReceiptLPs(param, remainInventoryMap, line, uomMap, lpMap, csUomMap, receiptLpMap, containerTrailer, entryTicket, lpStackMap) {
        let lps = [];
        if (param.takeOutShippedInv) {
            let invs = remainInventoryMap[line.receiptId];
            invs = _.filter(invs, inv => inv.itemSpecId === line.itemSpecId);
            _.forEach(invs, inv => {
                let uom = uomMap[inv.unitId];
                if (!uom) return;

                let lpTemplate = lpMap[inv.lpId];
                let qty = inv.qty;
                let eaQty = inv.qty * uom.baseQty;
                let csQty = 0;
                let csUom = csUomMap[uom.itemSpecId];
                if (csUom) {
                    csQty = Math.floor(eaQty / csUom.baseQty);
                }
                if (qty === 0) return;
                lps.push({
                    LPNo: inv.lpId,
                    ReceivedQty: qty,
                    ReceivedEAQty: eaQty,
                    ReceivedCSQty: csQty,
                    PalletType: lpTemplate && lpTemplate.template ? lpTemplate.template : "",
                    PalletQty: lpTemplate && lpTemplate.template ? 1 : 0,
                    ContainerType: containerTrailer.containerSize ? containerTrailer.containerSize : "",
                    ContainerNo: containerTrailer.containerNo || "",
                    TrailerType: containerTrailer.trailerSize ? containerTrailer.trailerSize : "",
                    TrailerNo: containerTrailer.trailerNo || "",
                    RailType: "",
                    RailNo: containerTrailer.railNo,
                    EntryID: entryTicket && entryTicket.entryId ? entryTicket.entryId : "",
                    Stack: lpStackMap[inv.lpId] || ""
                });
            })
        } else {
            let setupLps = receiptLpMap[line.receiptId];
            _.forEach(setupLps, lp => {
                let lpTemplate = lpMap[lp.lpId];
                let qty = 0;
                let eaQty = 0;
                let csQty = 0;
                _.forEach(lp.items, item => {
                    if (item.itemLineId !== line._id.toString()) return;

                    let uom = uomMap[item.unitId];
                    if (!uom || !item.qty) return;
                    qty += item.qty;
                    eaQty += item.qty * uom.baseQty;
                    let csUom = csUomMap[uom.itemSpecId];
                    if (csUom) {
                        csQty += Math.floor(eaQty / csUom.baseQty);
                        eaQty = eaQty % csUom.baseQty;
                    }
                })
                if (qty === 0) return;
                lps.push({
                    LPNo: lp.lpId,
                    ReceivedQty: qty,
                    ReceivedEAQty: eaQty,
                    ReceivedCSQty: csQty,
                    PalletType: lpTemplate && lpTemplate.template ? lpTemplate.template : "",
                    PalletQty: 1,
                    ContainerType: containerTrailer.containerSize ? containerTrailer.containerSize : "",
                    ContainerNo: containerTrailer.containerNo || "",
                    TrailerType: containerTrailer.trailerSize ? containerTrailer.trailerSize : "",
                    TrailerNo: containerTrailer.trailerNo || "",
                    RailType: "",
                    RailNo: containerTrailer.railNo,
                    EntryID: entryTicket && entryTicket.entryId ? entryTicket.entryId : "",
                    Stack: lpStackMap[lp.lpId] || ""
                });
            })
        }
        return lps;
    }

    function _buildTransloadLPs(transloadTask, uomMap, csUomMap, containerTrailer, entryTicket) {
        if (!transloadTask || !transloadTask.cartons || transloadTask.cartons.length === 0) return [];

        let lps = [];
        _.forEach(transloadTask.cartons, carton => {
            let qty = 0;
            let eaQty = 0;
            let csQty = 0;
            _.forEach(carton.items, item => {
                let uom = uomMap[item.unitId];
                if (!uom || !item.qty) return;
                qty += item.qty;
                eaQty += item.qty * uom.baseQty;
                let csUom = csUomMap[uom.itemSpecId];
                if (csUom) {
                    csQty += Math.floor(eaQty / csUom.baseQty);
                }
            })
            if (qty === 0) return;
            lps.push({
                LPNo: carton.cartonNo,
                ReceivedQty: qty,
                ReceivedEAQty: eaQty,
                ReceivedCSQty: csQty,
                PalletType: carton.palletNo ? carton.palletNo : "",
                PalletQty: 1,
                ContainerType: containerTrailer.containerSize ? containerTrailer.containerSize : "",
                ContainerNo: containerTrailer.containerNo || "",
                TrailerType: containerTrailer.trailerSize ? containerTrailer.trailerSize : "",
                TrailerNo: containerTrailer.trailerNo || "",
                RailType: "",
                RailNo: containerTrailer.railNo,
                EntryID: entryTicket && entryTicket.entryId ? entryTicket.entryId : "",
                Stack: ""
            });
        })
        return lps;
    }

    function _getMaterialProperty(materialProperty, itemSpecFields, line) {
        let mProperty = null;
        if (materialProperty) {
            let itemSpecField = _.find(itemSpecFields, field => field.itemSpecId === line.itemSpecId && field.propertyId === materialProperty._id.toString());
            if (itemSpecField) {
                mProperty = itemSpecField.value;
            }
        }
        return mProperty;
    }

    function _buildReportMaterialLines(materialLineGroup, receipt, itemMap, organizationMap, itemProperties, itemSpecFields, data) {
        let materialProperty = _.find(itemProperties, property => property.name === "MaterialProperty");
        let sizeProperty = _.find(itemProperties, property => property.name === "SIZE");

        if (materialLineGroup[receipt._id]) {
            _.forEach(materialLineGroup[receipt._id], line => {
                let item = itemMap[line.itemSpecId];
                let title = organizationMap[line.titleId];
                let mProperty = _getMaterialProperty(materialProperty, itemSpecFields, line);
                let size = _getMaterialProperty(sizeProperty, itemSpecFields, line);
                let material = {
                    Material: item ? item.name : "",
                    MaterialQty: line.qty ? line.qty : 0,
                    MaterialType: item ? item.name : "",
                    Title: title ? (title.customerCode ? title.customerCode : title.name) : "",
                    PalletSize: size ? size : "",
                    MaterialProperty: mProperty ? mProperty : ""
                };
                data.MaterialLine.push(material);
            })
        }
    }

    async function getReport(param) {
        let receipts = await _getReceipts(param);
        if (!receipts || receipts.length === 0) return [];

        let receiptIds = _.map(receipts, "_id");
        let carrierIds = _.uniq(_.map(_.filter(receipts, receipt => !_.isEmpty(receipt.carrierId)), "carrierId"));
        let [carriers,materialLines,receiptItemLines] = await Promise.all([
            carrierCollection(ctx).find({_id: {$in: carrierIds}}).toArray(),
            materialLineCollection(ctx).find({receiptId: {$in: receiptIds}}, {projection:tabelFieldMap.materialLineFields}).toArray(),
            receiptService(ctx).getReceiptItemLines(receiptIds)
        ]);
        let carrierMap = _.keyBy(carriers, "_id");
        let materialLineGroup = _.groupBy(materialLines, "receiptId");
        let receiptItemLineGroup = _.groupBy(receiptItemLines, "receiptId");

        let titleIds = _.uniq(_.map(_.filter(receipts, receipt => !_.isEmpty(receipt.titleId)), "titleId"));
        let customerIds = _.uniq(_.map(_.filter(receipts, receipt => !_.isEmpty(receipt.customerId)), "customerId"));
        let supplierIds = _.uniq(_.map(_.filter(receiptItemLines, line => !_.isEmpty(line.supplierId)), "supplierId"));
        let materialTitleIds = _.uniq(_.map(_.filter(materialLines, line => !_.isEmpty(line.titleId)), "titleId"));
        let organizationIds = _.uniq(_.union(titleIds, customerIds, supplierIds, materialTitleIds));
        let organizationMap = await organizationService(ctx).getOrganizationMap(organizationIds);

        let itemSpecIds = _.uniq(_.map(receiptItemLines, "itemSpecId"));
        let materialItemSpecIds = _.uniq(_.map(materialLines, "itemSpecId"));
        itemSpecIds = _.uniq(_.union(itemSpecIds, materialItemSpecIds));
        let [items,uoms] = await Promise.all([
            itemSpecCollection(ctx).find({_id: {$in: itemSpecIds}}, {projection:tabelFieldMap.itemSpecFields}).toArray(),
            itemUnitCollection(ctx).find({itemSpecId: {$in: itemSpecIds}}).toArray()
        ]);
        let itemMap = _.keyBy(items, "_id");
        let uomMap = _.keyBy(uoms, "_id");
        let csUoms = _.filter(uoms, uom => uom.name === "CS");
        let csUomMap = _.keyBy(csUoms, "itemSpecId");
        let eaUoms = _.filter(uoms, uom => uom.name === "EA");
        let eaUomMap = _.keyBy(eaUoms, "itemSpecId");

        let itemProperties = await itemPropertyCollection(ctx).find({name: {$in:["SIZE","TV Size","MaterialProperty"]}}).toArray();
        let itemPropertyIds = _.map(itemProperties, property => property._id + "");
        let itemSpecFields = await itemSpecFieldCollection(ctx).find({
            itemSpecId: {$in: itemSpecIds},
            propertyId: {$in: itemPropertyIds}
        }).toArray();
        let tvSizeProperty = _.find(itemProperties, property => property.name === "TV Size");

        let entryTicketMap = await entryTicketService(ctx).getEntryTicketMapBySubTaskId(receiptIds);

        let invLpIds = [];
        let remainInventoryMap = {};
        if (param.takeOutShippedInv) {
            let remainInventories = await wmsMysql(ctx).selectAll(`select ${tabelFieldMap.inventoryFields} from inventory where status in('AVAILABLE','ON_HOLD') and receiptId in('${receiptIds.join("','")}') and qty>0`);

            if (remainInventories && remainInventories.length > 0) {
                remainInventoryMap = _.groupBy(remainInventories, "receiptId");
                invLpIds = _.compact(_.uniq(_.map(remainInventories, "lpId")));
            }
        }

        let {receiptLpMap, lpIds} = await _getReceiptLPs(receiptIds, invLpIds);
        let lpMap = await lpService(ctx).getLpWithTemplateMap(lpIds);
        let lpStackMap = await locationService(ctx).getLocationStackLpIdMap(lpIds);

        let [receiptTaskMap,transloadTaskMap] = await Promise.all([
            receiveTaskService(ctx).getReceiptTaskMapByReceiptId(receiptIds),
            transloadTaskService(ctx).getTransloadTaskMapByReceiptId(receiptIds)
        ]);

        let report = [];
        let rnTaskMap = {};
        for(let receipt of receipts) {
            let entryTicket = entryTicketMap[receipt._id] ? entryTicketMap[receipt._id][0] : null;
            let customer = organizationMap[receipt.customerId];
            let title = organizationMap[receipt.titleId];
            let receiptTask = receiptTaskMap[receipt._id];
            let transloadTask = transloadTaskMap[receipt._id];
            let task = receiptTask || transloadTask || {};

            let devannedDate = receipt.transferTypeFromCrossDockDate ? receipt.transferTypeFromCrossDockDate : receipt.devannedTime;
            let data = {
                Company: app.systemConf.company,
                Facility: app.systemConf.facility,
                ReceiptID: receipt._id,
                ReceiptType: receipt.receiptType ? receipt.receiptType : "",
                Customer: customer ? (customer.customerCode ? customer.customerCode : customer.name) : "",
                Title: title ? (title.customerCode ? title.customerCode : title.name) : "",
                Carrier: carrierMap[receipt.carrierId] ? carrierMap[receipt.carrierId].name : "",
                Reference: receipt.referenceNo ? receipt.referenceNo : "",
                PO: receipt.poNo ? receipt.poNo : "",
                CreateTime: momentZone(receipt.createdWhen).format('YYYY-MM-DD HH:mm:ss'),
                ETA: receipt.eta ? momentZone(receipt.eta).format('YYYY-MM-DD HH:mm:ss') : "",
                AppointmentTime: receipt.appointmentTime ? momentZone(receipt.appointmentTime).format('YYYY-MM-DD HH:mm:ss') : "",
                InYardDate: receipt.inYardTime ? momentZone(receipt.inYardTime).format('YYYY-MM-DD HH:mm:ss') : "",
                DevannedDate: devannedDate ? momentZone(devannedDate).format('YYYY-MM-DD HH:mm:ss') : "",
                EntryType: receipt.source === "EDI" ? "EDI" : "Manual",

                ContainerNo: "",
                ContainerType: "",
                ContainerQty: 0,
                TrailerType: "",
                TrailerQty: 0,

                EntryID: entryTicket && entryTicket.entryId ? entryTicket.entryId : "",
                EquipmentType: entryTicket && entryTicket.equipmentType ? entryTicket.equipmentType : "",
                RushOrder: false,
                ShipMethod: task && task.shippingMethod ? task.shippingMethod : "",
                OffloadType: task && task.offloadType ? task.offloadType : "",
                UsedHours: 0,
                LabelQty: receiptLpMap[receipt._id] ? receiptLpMap[receipt._id].length : 1,
                Documentations: [],
                Scan: [],
                ItemLine: [],
                MaterialLine: []
            };

            let containerTrailer = {
                containerNo: receipt.containerNo,
                containerSize: receipt.containerSize,
                trailerNo: receipt.trailerNo,
                trailerSize: receipt.trailerSize,
                railNo: entryTicket && entryTicket.equipmentType === "RAIL" ? entryTicket.tractor : ""
            };
            if (rnTaskMap[task.id]) {
                containerTrailer = {};
            } else {
                rnTaskMap[task.id] = receipt._id;
            }
            if (receiptItemLineGroup[receipt._id]) {
                for(let line of receiptItemLineGroup[receipt._id]) {
                    let item = itemMap[line.itemSpecId];
                    let uom = uomMap[line.unitId];
                    let [isCaseUom,isPieceUom] = await Promise.all([
                        itemUnitService(ctx).isCaseUom(uom),
                        itemUnitService(ctx).isPieceUom(uom)
                    ]);
                    let csUom = isCaseUom ? uom : csUomMap[line.itemSpecId];
                    let eaUom = isPieceUom ? uom : eaUomMap[line.itemSpecId];
                    let tvSize = _getTvSize(tvSizeProperty, itemSpecFields, line);
                    let lps = [];
                    if (receipt.isTransload) {
                        lps = _buildTransloadLPs(transloadTask, uomMap, csUomMap, containerTrailer, entryTicket);
                    } else {
                        lps = _buildReceiptLPs(param, remainInventoryMap, line, uomMap, lpMap, csUomMap, receiptLpMap, containerTrailer, entryTicket, lpStackMap);
                    }

                    let supplier = organizationMap[line.supplierId];
                    let receivedQty = line.receivedQty ? line.receivedQty : 0;
                    let eaQty = uom ? line.qty * uom.baseQty : 0;
                    let csQty = csUom ? Math.floor(eaQty / csUom.baseQty) : 0;
                    let itemLine = {
                        Item: item ? item.name : "",
                        ItemGrade: item && item.grade ? item.grade : "",
                        ItemType: tvSize ? tvSize : "",
                        Title: title ? (title.customerCode ? title.customerCode : title.name) : "",
                        Supplier: supplier ? (supplier.customerCode ? supplier.customerCode : supplier.name) : "",
                        ItemUOM: uom ? uom.name : "",
                        ExpectedQty: line.qty,
                        ReceivedQty: receivedQty,
                        ReceivedEAQty: eaQty,
                        ReceivedCSQty: csQty,
                        ItemVOL: itemUnitService(ctx).getCftByUOM(uom),
                        ItemCSVOL: itemUnitService(ctx).getCftByUOM(csUom),
                        ItemEAVOL: itemUnitService(ctx).getCftByUOM(eaUom),
                        VolumeUOM: app.defaultValues.volumeUOM,
                        ItemWGT: itemUnitService(ctx).getWeightByUOM(uom),
                        ItemCSWGT: itemUnitService(ctx).getWeightByUOM(csUom),
                        ItemEAWGT: itemUnitService(ctx).getWeightByUOM(eaUom),
                        WeightUOM: app.defaultValues.weightUOM,
                        ItemAREA: itemUnitService(ctx).getSquareByUOM(uom),
                        ItemEAAREA: itemUnitService(ctx).getSquareByUOM(eaUom),
                        ItemCSAREA: itemUnitService(ctx).getSquareByUOM(csUom),
                        AreaUOM: app.defaultValues.areaUOM,
                        PalletType: app.defaultValues.palletSize,
                        PalletQty: line.palletQty ? Math.floor(line.palletQty) : 0,
                        LPS: lps
                    };
                    data.ItemLine.push(itemLine);
                }
            }

            _buildReportMaterialLines(materialLineGroup, receipt, itemMap, organizationMap, itemProperties, itemSpecFields, data);

            if (receiptTask && receiptTask.snScan > 0) {
                data.Scan.push({
                    Scan: "SN",
                    ScanQty: receiptTask.snScan
                })
            }
            if (transloadTask && transloadTask.lpScan > 0) {
                data.Scan.push({
                    Scan: "LP",
                    ScanQty: transloadTask.lpScan
                })
            }

            report.push(data);
        }

        return report;
    };


    return {
        getReport
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};

