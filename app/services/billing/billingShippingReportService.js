const _ = require('lodash');

let service = (app, ctx) => {

    async function _getOrders(param) {
        if (param.orderIds) {
            return await orderCollection(ctx).query({_id: {$in: param.orderIds}}, {projection:tabelFieldMap.orderFields});
        }
        if (!param.customerIds || param.customerIds.length === 0) return [];

        let startTime = momentZone().add(-62, 'days').startOf('day').format('YYYY-MM-DD HH:mm:ss');
        let sentReportManuals = await billingManualCollection(ctx).query({
            type: "SHIP_REPORT",
            sentWhen: {
                $gte: new Date(momentZone(startTime).format())
            }
        },{projection:{orderId:1}});
        let sentOrderIds = _.map(sentReportManuals, "orderId");


        let completeOrderStatus = ["SHIPPED", "SHORT_SHIPPED", "PARTIAL_SHIPPED", "REOPENED", "CANCELLED"];
        startTime = momentZone().add(-60, 'days').startOf('day').format('YYYY-MM-DD HH:mm:ss');
        let orders = await orderCollection(ctx).query({
            customerId: {$in: param.customerIds},
            status: {$in: completeOrderStatus},
            _id: {$nin: sentOrderIds},
            shippedTime: {
                $gte: new Date(momentZone(startTime).format())
            }
        }, {projection:tabelFieldMap.orderFields});


        let shippedOrderIds = _.map(orders, "_id");
        startTime = momentZone().add(-12, 'hours').startOf('day').format('YYYY-MM-DD HH:mm:ss');
        let updateOrders = await orderCollection(ctx).find({
            _id: {$nin: shippedOrderIds},
            customerId: {$in: param.customerIds},
            status: {$in: completeOrderStatus},
            updatedWhen: {
                $gte: new Date(momentZone(startTime).format())
            }
        }, {projection: {_id: 1}}).toArray();
        let updateOrderIds = _.map(updateOrders, "_id");
        updateOrders = await orderCollection(ctx).query({_id:{$in:updateOrderIds}}, {projection:tabelFieldMap.orderFields});
        orders = _.union(orders, updateOrders);

        return orders;
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

    function _getLpContainer(lpId, entryTickets, loadTasks) {
        let containerNo = "";
        let trailerNo = "";
        let railNo = "";
        let loadId = "";
        let entryId = "";
        _.forEach(loadTasks, task => {
            let innerLps = _.map(task.innerLps, "innerLp");
            if (_.includes(innerLps, lpId) || _.includes(task.loadSlpIds, lpId)) {
                entryId = task.entryId;
            }
        })

        _.forEach(entryTickets, ticket => {
            if (ticket.entryId === entryId) {
                containerNo = ticket.containerNOs.join(",");
                trailerNo = ticket.trailers.join(",");
                loadId = ticket.subTaskId;
                if (ticket.equipmentType === "RAIL") railNo = ticket.tractor;
            }
        })

        return {containerNo, trailerNo, railNo, entryId, loadId};
    }

    function _buildOrderLPs(invs, lpMap, uomMap, csUomMap, lpConfiguration, entryTickets, loadTask, originalLpMap) {
        let lps = [];
        let invGroup = _.groupBy(invs, inv => inv.lpId + inv.receiptId + inv.itemSpecId);
        _.forEach(invGroup, (gInvs, key) => {
            let inv = gInvs[0];
            let lp = lpMap[inv.lpId] || {};
            lp.template = lp.template || (lpConfiguration ? lpConfiguration.templateName : "");

            let eaQty = _.sum(_.map(gInvs, gInv => uomMap[gInv.unitId] ? gInv.qty * uomMap[gInv.unitId].baseQty : gInv.qty));
            let csQty = 0;
            let csUom = csUomMap[inv.itemSpecId];
            if (csUom) {
                csQty = Math.floor(eaQty / csUom.baseQty);
            }

            let lpContainer = _getLpContainer(inv.lpId, entryTickets, loadTask);

            if (eaQty === 0) return;
            let receivedWhen = inv.receivedWhen || inv.createdWhen;
            let originalLp = originalLpMap[inv.originalReceiveLPId];
            lps.push({
                LPNo: inv.lpId,
                ReceiptID: inv.receiptId ? inv.receiptId : "",
                DevannedDate: momentZone(receivedWhen).format('YYYY-MM-DD HH:mm:ss'),
                ShippedQty: eaQty,
                ShippedEAQty: eaQty,
                ShippedCSQty: csQty,
                PalletType: lp && lp.template ? lp.template : "",
                PalletQty: lp && lp.template ? 1 : 0,
                ContainerType: "",
                ContainerNo: lpContainer.containerNo,
                TrailerType: "",
                TrailerNo: lpContainer.trailerNo,
                RailType: "",
                RailNo: lpContainer.railNo,
                EntryID: lpContainer.entryId,
                LoadNo: lpContainer.loadId,
                OrgLPNo: inv.originalReceiveLPId || "",
                OrgLPNoCleared: originalLp ? (originalLp.isLpCleared && originalLp.orderId === inv.orderId) : false,
                Stack: originalLp ? originalLp.stack : ""
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

    function _buildReportMaterialLines(materialLineGroup, order, itemMap, itemProperties, itemSpecFields, organizationMap, data) {
        let sizeProperty = _.find(itemProperties, property => property.name === "SIZE");
        let materialProperty = _.find(itemProperties, property => property.name === "MaterialProperty");

        if (materialLineGroup[order._id]) {
            _.forEach(materialLineGroup[order._id], line => {
                let item = itemMap[line.itemSpecId];
                let title = organizationMap[line.titleId];
                let mProperty = _getMaterialProperty(materialProperty, itemSpecFields, line);
                let size = _getMaterialProperty(sizeProperty, itemSpecFields, line);
                let material = {
                    Material: item ? item.name : "",
                    MaterialQty: line.qty,
                    MaterialType: item ? item.name : "",
                    Title: title ? (title.customerCode ? title.customerCode : title.name) : "",
                    PalletSize: size ? size : "",
                    MaterialProperty: mProperty ? mProperty : ""
                };
                data.MaterialLine.push(material);
            })
        }
    }
    
    async function calPackQty(invs, uomMap, csUomMap) {
        let pieceInvs = [];
        for (let inv of invs) {
            let uom = uomMap[inv.unitId];
            let isCaseUom = await itemUnitService(ctx).isCaseUom(uom);
            if (!isCaseUom) pieceInvs.push(inv);
        }
        let invLpGroup = _.groupBy(pieceInvs, "lpId");
        let packQty = 0;
        _.forEach(invLpGroup, (lpInvs, lpId) => {
            let invItemGroup = _.groupBy(lpInvs, "itemSpecId");
            let isHasCase = true;
            _.forEach(invItemGroup, (itemInvs, itemSpecId) => {
                let csUom = csUomMap[itemSpecId];
                if (!csUom) return;
                let qty = _.sum(_.map(itemInvs, inv => {
                    return uomMap[inv.unitId] ? inv.qty * uomMap[inv.unitId].baseQty : inv.qty;
                }));
                if (qty > 0 && qty % csUom.baseQty !== 0) {
                    isHasCase = false;
                    return;
                }
            })
            if (!isHasCase) packQty++;
        })
        return packQty;
    }

    async function _calPickQtyByCaseLevel(invs, uomMap, csUom, inUom, pickQty) {
        let pieceInvs = [];
        for(let inv of invs) {
            let uom = uomMap[inv.unitId];
            let isCaseUom = await itemUnitService(ctx).isCaseUom(uom);
            if (isCaseUom) pickQty.casePickQty += inv.qty;
            else pieceInvs.push(inv);
        }

        let invGroupByLP = _.groupBy(pieceInvs, "lpId");
        _.forEach(invGroupByLP, (lpInvs, lpId) => {
            let invGroupByItem = _.groupBy(lpInvs, "itemSpecId");
            _.forEach(invGroupByItem, (itemInvs, itemSpecId) => {
                let eaQty = _.sum(_.map(itemInvs, inv => uomMap[inv.unitId] ? uomMap[inv.unitId].baseQty * inv.qty : inv.qty));
                if (csUom) {
                    pickQty.casePickQty += Math.floor(eaQty / csUom.baseQty);
                    eaQty = eaQty % csUom.baseQty;
                }
                if (inUom && csUom && inUom.baseQty !== csUom.baseQty) {
                    pickQty.innerPickQty += Math.floor(eaQty / inUom.baseQty);
                    eaQty = eaQty % inUom.baseQty;
                }
                pickQty.piecePickQty += eaQty;
            })
        })
    }

    function _calPickQtyByPalletLevel(itemLpConfigurations, customer, invs, pickTasks, uomMap, csUom, inUom, pickQty) {
        let invGroupByLP = _.groupBy(invs, "lpId");
        _.forEach(invGroupByLP, (lpInvs, lpId) => {
            let invGroupByItem = _.groupBy(lpInvs, "itemSpecId");
            _.forEach(invGroupByItem, (itemInvs, itemSpecId) => {
                let eaQty = _.sum(_.map(itemInvs, inv => uomMap[inv.unitId] ? uomMap[inv.unitId].baseQty * inv.qty : inv.qty));
                let lpConfiguration = _.find(itemLpConfigurations, conf => conf.itemSpecId === itemSpecId && conf.isDefault);

                if (lpConfiguration) {
                    let lpRelocateBaseQty = 0;
                    _.forEach(pickTasks, task => {
                        _.forEach(task.pickHistories, history => {
                            if (history.itemSpecId === itemSpecId && history.toLPId === lpId && history.fromLPId !== history.toLPId) {
                                lpRelocateBaseQty += history.lpRelocateBaseQty || 0;
                            }
                        })
                    })
                    lpRelocateBaseQty = lpRelocateBaseQty > 0 ? lpRelocateBaseQty : 0;

                    let totalPalletEAQty = itemLpConfigurationService(ctx).getItemLpTemplateTatalEaQty(lpConfiguration,customer);

                    if (eaQty > lpConfiguration.totalEAQty) {
                        pickQty.palletPickQty += Math.floor(eaQty / lpConfiguration.totalEAQty);

                        if (lpRelocateBaseQty < totalPalletEAQty && csUom) {
                            pickQty.casePickQty += Math.floor(lpRelocateBaseQty / csUom.baseQty);
                        }
                        eaQty = eaQty % lpConfiguration.totalEAQty;
                    } else if (eaQty >= totalPalletEAQty) {
                        pickQty.palletPickQty += 1;

                        if (lpRelocateBaseQty < totalPalletEAQty && csUom) {
                            pickQty.casePickQty += Math.floor(lpRelocateBaseQty / csUom.baseQty);
                        }
                        return;
                    }
                }
                if (csUom) {
                    pickQty.casePickQty += Math.floor(eaQty / csUom.baseQty);
                    eaQty = eaQty % csUom.baseQty;
                }
                if (inUom && csUom && inUom.baseQty !== csUom.baseQty) {
                    pickQty.innerPickQty += Math.floor(eaQty / inUom.baseQty);
                    eaQty = eaQty % inUom.baseQty;
                }
                pickQty.piecePickQty += eaQty;
            })
        })
    }

    async function calPickQty(customer, itemLpConfigurations, invs, pickTasks, uomMap, csUom, inUom) {
        let pickQty = {
            palletPickQty: 0,
            casePickQty: 0,
            innerPickQty: 0,
            piecePickQty: 0
        };

        if (customer.outBoundBillingLevel === "BY_PALLET") {
            _calPickQtyByPalletLevel(itemLpConfigurations, customer, invs, pickTasks, uomMap, csUom, inUom, pickQty)

        } else {
            await _calPickQtyByCaseLevel(invs, uomMap, csUom, inUom, pickQty);
        }

        return pickQty;
    }

    async function _getInventoriesByOrderIds(orderIds) {
        let orderIdGroup = _.chunk(orderIds, 100);
        let inventories = [];
        for (let ids of orderIdGroup) {
            let orderIdStr = "'" + ids.join("','") + "'";
            let invs = await wmsMysql(ctx).selectAll(`select ${tabelFieldMap.inventoryFields} from inventory where orderId in(${orderIdStr})`);
            inventories = _.union(inventories, invs);
        }
        _.forEach(inventories, inv => {
            inv.lotNo = inv.lotNo ? inv.lotNo : "";
        })
        return inventories;
    }

    function _getOrgIds(orders, orderItemLines, materialLines) {
        let customerIds = _.uniq(_.map(_.filter(orders, order => !_.isEmpty(order.customerId)), "customerId"));
        let titleIds = _.uniq(_.map(_.filter(orderItemLines, line => !_.isEmpty(line.titleId)), "titleId"));
        let supplierIds = _.uniq(_.map(_.filter(orderItemLines, line => !_.isEmpty(line.supplierId)), "supplierId"));
        let materialTitleIds = _.uniq(_.map(_.filter(materialLines, line => !_.isEmpty(line.titleId)), "titleId"));
        let organizationIds = _.uniq(_.union(titleIds, customerIds, supplierIds, materialTitleIds));
        return organizationIds;
    }

    function _getLineInvs(inventories, line, uomMap, orderId) {
        let invs = _.filter(inventories, inv => {
            if (inv.qty <= 0) return false;
            if (line.lotNo) {
                return inv.itemSpecId === line.itemSpecId && inv.lotNo === line.lotNo && inv.orderId === orderId && inv.lpId;
            }
            return inv.itemSpecId === line.itemSpecId && inv.orderId === orderId && inv.lpId;
        });

        let invQty = _.sum(_.map(invs, inv => uomMap[inv.unitId] ? uomMap[inv.unitId].baseQty * inv.qty : inv.qty));
        let lineQty = uomMap[line.unitId] ? uomMap[line.unitId].baseQty * line.qty : line.qty;
        if (invQty <= lineQty) return invs;

        let matchInv = _.find(inventories, inv => {
            let qty = uomMap[inv.unitId] ? uomMap[inv.unitId].baseQty * inv.qty : inv.qty;
            return qty === lineQty;
        });
        if (matchInv) {
            let newInv = JSON.parse(JSON.stringify(matchInv));
            matchInv.qty = 0;
            return [newInv];
        }

        inventories = _.sortBy(inventories, inv => uomMap[inv.unitId] ? uomMap[inv.unitId].baseQty * inv.qty : inv.qty);
        invs = [];
        for (let inv of inventories) {
            if (inv.qty === 0) continue;

            let newInv = JSON.parse(JSON.stringify(inv));
            let invQty = uomMap[inv.unitId] ? uomMap[inv.unitId].baseQty * inv.qty : inv.qty;
            if (invQty <= lineQty) {
                inv.qty = 0;
                lineQty -= invQty;
            } else {
                newInv.qty = uomMap[inv.unitId] ? Math.ceil(lineQty / uomMap[inv.unitId].baseQty) : lineQty;
                inv.qty -= newInv.qty;
            }
            invs.push(newInv);
            if (lineQty <= 0) break;
        }
        return invs;
    }

    async function getReport(param) {
        if (!param) return [];

        let orders = await _getOrders(param);
        if (!orders || orders.length === 0) return [];

        let orderIds = _.map(orders, "_id");
        let carrierIds = _.uniq(_.map(_.filter(orders, order => !_.isEmpty(order.carrierId)), "carrierId"));
        let [carriers,inventories] = await Promise.all([
            carrierCollection(ctx).find({_id: {$in: carrierIds}}).toArray(),
            _getInventoriesByOrderIds(orderIds)
        ]);
        let originalLpMap = await inventoryService(ctx).getOriginalReceiveLPId(inventories);
        let carrierMap = _.keyBy(carriers, "_id");
        let lpIds = _.compact(_.uniq(_.map(inventories, "lpId")));

        let [lpMap, materialLines,orderItemLines] = await Promise.all([
            lpService(ctx).getLpWithTemplateMap(lpIds),
            materialLineCollection(ctx).find({orderId: {$in: orderIds}}, {projection:tabelFieldMap.materialLineFields}).toArray(),
            orderService(ctx).getOrderItemLines(orderIds)
        ]);
        let materialLineGroup = _.groupBy(materialLines, "orderId");
        let orderItemLineGroup = _.groupBy(orderItemLines, "orderId");

        let organizationIds = _getOrgIds(orders, orderItemLines, materialLines);
        let itemSpecIds = _.uniq(_.map(orderItemLines, "itemSpecId"));
        let materialItemSpecIds = _.uniq(_.map(materialLines, "itemSpecId"));
        itemSpecIds = _.uniq(_.union(itemSpecIds, materialItemSpecIds));
        let [organizationMap, items, uoms] = await Promise.all([
            organizationService(ctx).getOrganizationMap(organizationIds),
            itemSpecCollection(ctx).find({_id: {$in: itemSpecIds}}, {projection:tabelFieldMap.itemSpecFields}).toArray(),
            itemUnitCollection(ctx).find({itemSpecId: {$in: itemSpecIds}}).toArray()
        ]);
        let itemMap = _.keyBy(items, "_id");
        let uomMap = _.keyBy(uoms, "_id");
        let csUoms = _.filter(uoms, uom => uom.name === "CS");
        let csUomMap = _.keyBy(csUoms, "itemSpecId");
        let eaUoms = _.filter(uoms, uom => uom.name === "EA");
        let eaUomMap = _.keyBy(eaUoms, "itemSpecId");
        let inUoms = _.filter(uoms, uom => uom.name === "IN");
        let inUomMap = _.keyBy(inUoms, "itemSpecId");

        let itemProperties = await itemPropertyCollection(ctx).find({name: {$in:["SIZE","TV Size","MaterialProperty"]}}).toArray();
        let itemPropertyIds = _.map(itemProperties, property => property._id + "");
        let itemSpecFields = await itemSpecFieldCollection(ctx).find({
            itemSpecId: {$in: itemSpecIds},
            propertyId: {$in: itemPropertyIds}
        }).toArray();
        let tvSizeProperty = _.find(itemProperties, property => property.name === "TV Size");

        let loadOrderIdMap = await loadService(ctx).getLoadMapByOrderId(orderIds);
        let loadIds = [];
        _.forEach(loadOrderIdMap, (loads, oderId) => {
            loadIds = _.union(loadIds, _.map(loads, "loadId"));
        })

        let [pickTaskOrderMap,loadTaskOrderMap,entryTicketMap,shipmentTickets,itemLpConfigurations] = await Promise.all([
            pickTaskService(ctx).getPickTaskMapByOrderId(orderIds, ["CLOSED", "FORCE_CLOSED"]),
            loadTaskService(ctx).getLoadTaskMapByOrderId(orderIds, ["CLOSED", "FORCE_CLOSED"]),
            entryTicketService(ctx).getEntryTicketMapBySubTaskId(loadIds),
            shipmentTicketCollection(ctx).find({orderId: {$in: orderIds}}).toArray(),
            itemLpConfigurationService(ctx).getItemLpConfigurations(itemSpecIds)
        ]);
        let shipmentTicketMap = _.keyBy(shipmentTickets, "orderId");

        let report = [];
        for(let order of orders) {
            let customer = organizationMap[order.customerId];
            let loads = loadOrderIdMap[order._id];
            let entryTickets = [];
            _.forEach(entryTicketMap, (tickets, loadId) => {
                if (_.includes(_.map(loads, "loadId"), loadId)) {
                    entryTickets = _.union(entryTickets, tickets);
                }
            });
            let pTasks = pickTaskOrderMap[order._id];
            let shipmentTicket = shipmentTicketMap[order._id];
            let loadTasks = loadTaskOrderMap[order._id];
            let loadSlpCount = _.sum(_.map(loadTasks, task => task.loadSlpIds.length));

            let orderInvs = _.filter(inventories, inv => inv.orderId === order._id);
            let data = {
                Company: app.systemConf.company,
                Facility: app.systemConf.facility,
                OrderID: order._id,
                OrderType: order.orderType ? order.orderType : "",
                Customer: customer ? (customer.customerCode ? customer.customerCode : customer.name) : "",
                Carrier: carrierMap[order.carrierId] ? carrierMap[order.carrierId].name : "",
                Reference: order.referenceNo ? order.referenceNo : "",
                PO: order.poNo ? order.poNo : "",
                SO: order.soNos ? order.soNos.join(",") : "",
                PRO: order.proNo ? order.proNo : "",
                StoreNo: order.shipToAddress && order.shipToAddress.storeNo ? order.shipToAddress.storeNo : "",
                CreateTime: momentZone(order.createdWhen).format('YYYY-MM-DD HH:mm:ss'),
                ScheduleDate: order.scheduleDate ? momentZone(order.scheduleDate).format('YYYY-MM-DD HH:mm:ss') : "",
                AppointmentTime: order.appointmentTime ? momentZone(order.appointmentTime).format('YYYY-MM-DD HH:mm:ss') : "",
                InYardDate: order.inYardTime ? momentZone(order.inYardTime).format('YYYY-MM-DD HH:mm:ss') : "",
                PickedDate: pTasks && pTasks.length > 0 ? pTasks[0].startTime : "",
                ShippedDate: order.shippedTime ? momentZone(order.shippedTime).format('YYYY-MM-DD HH:mm:ss') : "",
                Cancelled: order.status === "CANCELLED",
                CancelledDate: order.status === "CANCELLED" && order.canceledDate ? momentZone(order.canceledDate).format('YYYY-MM-DD HH:mm:ss') : "",
                EntryType: order.orderTypeCode && order.orderTypeCode.toUpperCase() === "FTP" ? "FTP" : (order.source === "EDI" ? "EDI" : "Manual"),

                ContainerNo: "",
                ContainerType: "",
                ContainerQty: 0,
                TrailerQty: 0,
                TrailerType: "",

                PackQty: await calPackQty(orderInvs, uomMap, csUomMap),
                EntryID: entryTickets ? _.map(entryTickets, "entryId").join(",") : "",
                RushOrder: order.isRush ? order.isRush : false,
                LoadNo: loads ? _.map(loads, "loadId").join(",") : "",
                LoadType: loads ? loads[0].type : "",
                UsedHours: 0,
                LabelQty: shipmentTicket && shipmentTicket.loadedSlpIds && shipmentTicket.loadedSlpIds.length > 0 ? shipmentTicket.loadedSlpIds.length : 1,
                Documentations: [],
                Scan: [],
                ItemLine: [],
                MaterialLine: []
            };

            let pickType = pTasks && pTasks.length > 0 && pTasks[0].pickType ? pTasks[0].pickType : "";
            if (orderItemLineGroup[order._id]) {
                let linePalletQty = _.sum(_.map(orderItemLineGroup[order._id], "adjustedPalletQty"));
                linePalletQty += _.sum(_.map(orderItemLineGroup[order._id], "palletQty"));
                if (linePalletQty > 0) {
                    loadSlpCount = 0;
                }
                for(let line of orderItemLineGroup[order._id]) {
                    let item = itemMap[line.itemSpecId];
                    let uom = uomMap[line.unitId];
                    let [isCaseUom,isPieceUom] = await Promise.all([
                        itemUnitService(ctx).isCaseUom(uom),
                        itemUnitService(ctx).isPieceUom(uom)
                    ]);
                    let csUom = isCaseUom ? uom : csUomMap[line.itemSpecId];
                    let inUom = inUomMap[line.itemSpecId];
                    let eaUom = isPieceUom ? uom : eaUomMap[line.itemSpecId];
                    let tvSize = _getTvSize(tvSizeProperty, itemSpecFields, line);
                    let invs = _getLineInvs(inventories, line, uomMap, order._id);

                    let lpConfiguration = _.find(itemLpConfigurations, conf => conf.itemSpecId === line.itemSpecId && conf.isDefault);
                    let lps = _buildOrderLPs(invs, lpMap, uomMap, csUomMap, lpConfiguration, entryTickets, loadTasks, originalLpMap);

                    let title = organizationMap[line.titleId];
                    let supplier = organizationMap[line.supplierId];
                    let shippedQty = _.sum(_.map(invs, inv => uomMap[inv.unitId] ? uomMap[inv.unitId].baseQty * inv.qty : inv.qty));
                    shippedQty = Math.floor(uom && uom.baseQty ? shippedQty / uom.baseQty : shippedQty);
                    let eaQty = uom ? shippedQty * uom.baseQty : 0;
                    let csQty = csUom ? Math.floor(eaQty / csUom.baseQty) : 0;

                    let pickQty = await calPickQty(customer, itemLpConfigurations, invs, pTasks, uomMap, csUom, inUom);

                    let loadPalletQty = line.adjustedPalletQty ? Math.floor(line.adjustedPalletQty) : (line.palletQty ? Math.floor(line.palletQty) : 0);
                    if (loadPalletQty === 0) {
                        loadPalletQty = loadSlpCount;
                        loadSlpCount = 0;
                    }

                    let itemLine = {
                        Item: item ? item.name : "",
                        ItemGrade: item && item.grade ? item.grade : "",
                        ItemType: tvSize ? tvSize : "",
                        Title: title ? (title.customerCode ? title.customerCode : title.name) : "",
                        Supplier: supplier ? (supplier.customerCode ? supplier.customerCode : supplier.name) : "",
                        ItemUOM: uom ? uom.name : "",
                        OrderedQty: line.qty,
                        PickType: pickType,
                        PickQty: 0,
                        ShippedQty: shippedQty,
                        ShippedCSQty: csQty,
                        ShippedEAQty: eaQty,
                        PalletPickQty: pickQty.palletPickQty,
                        CasePickQty: pickQty.casePickQty,
                        InnerPickQty: pickQty.innerPickQty,
                        PiecePickQty: pickQty.piecePickQty,
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
                        PalletQty: loadPalletQty,
                        LPS: lps
                    };
                    data.ItemLine.push(itemLine);
                }
            }

            _buildReportMaterialLines(materialLineGroup, order, itemMap, itemProperties, itemSpecFields, organizationMap, data);
            report.push(data);
        }

        return report;
    }


    return {
        getReport,
        calPickQty,
        calPackQty
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
