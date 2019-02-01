const _ = require('lodash');

let service = (app, ctx) => {

    return {
        getReceipt: function () {
            let receipt = ctx.cached.receiptMap[this.receiptId];
            return receipt ? receipt : {};
        },

        getCustomer: function () {
            let customer = ctx.cached.orgBasicMap[this.customerId];
            return customer ? customer : {};
        },

        getTitle: function () {
            let title = ctx.cached.orgBasicMap[this.titleId];
            return title ? title : {};
        },

        getSupplier: function () {
            let supplier = ctx.cached.orgBasicMap[this.supplierId];
            return supplier ? supplier : {};
        },

        getCarrier: function () {
            let carrier = ctx.cached.orgBasicMap[this.carrierId];
            let carrierDetail = ctx.cached.carrierMap[this.carrierId];
            _.assign(carrier, carrierDetail);

            return carrier ? carrier : {};
        },

        getItem: function () {
            let itemSpec = ctx.cached.itemSpecMap[this.itemSpecId];
            return itemSpec ? itemSpec : {};
        },

        getExpectedUom: function () {
            let expectedUom = ctx.cached.unitMap[this.unitId];
            return expectedUom ? expectedUom : {};
        },

        getReceivedUom: function () {
            let receivedUom = ctx.cached.unitMap[this.receivedUnitId];
            return receivedUom ? receivedUom : {};
        },

        getBaseQty: function () {
            let uom = ctx.cached.unitMap[this.unitId];
            return uom ? this.qty * ctx.cached.unitMap[this.unitId].baseQty : "";
        },

        getReceivedCsQty: function () {
            let csUnit = ctx.cached.csUnitMap[this.itemSpecId];
            if (!csUnit) return "";

            return (this.receivedQty * ctx.cached.unitMap[this.receivedUnitId].baseQty / csUnit.baseQty).toFixed(0);
        },

        getExpectedCft: function () {
            let unitCft = itemUnitService(ctx).getCftByUOM(ctx.cached.unitMap[this.unitId]);
            return _.round(this.qty * unitCft, 2);
        },

        getReceivedCft: function () {
            let unitCft = itemUnitService(ctx).getCftByUOM(ctx.cached.unitMap[this.receivedUnitId]);
            return _.round(this.receivedQty * unitCft, 2);
        },

        getExpectedWeight: function () {
            let unitWeight = itemUnitService(ctx).getWeightByUOM(ctx.cached.unitMap[this.unitId]);
            return _.round(this.qty * unitWeight, 2);
        },

        getReceivedWeight: function () {
            let unitWeight = itemUnitService(ctx).getWeightByUOM(ctx.cached.unitMap[this.receivedUnitId]);
            return _.round(this.receivedQty * unitWeight, 2);
        },

        getQtyPerPallet: function () {
            let qtyPerPallet = ctx.cached.qtyPerPalletMap[this.itemSpecId];
            return qtyPerPallet ? qtyPerPallet : "";
        },

        getPalletNo: function () {
            let lp = ctx.cached.lpMap[this.lpId];
            return lp ? lp.palletNo : "";
        },

        getEquipment: function () {
            let equipmentInfo = ctx.cached.equipmentInfoMap[this.receiptId];
            if (equipmentInfo) {
                return equipmentInfo;
            }

            let receipt = ctx.cached.receiptMap[this.receiptId];
            if (receipt.containerNo) {
                return {
                    equipmentType: "CONTAINER",
                    equipmentNo: receipt.containerNo
                }
            }

            if (receipt.trailerNo) {
                return {
                    equipmentType: "TRAILER",
                    equipmentNo: receipt.trailerNo
                }
            }

            return {};
        },

        getReceiptDynTxtProperty: function () {
            let customer = ctx.cached.customerMap[this.customerId];
            let customerReceiptDynFields = customer.receiptDynamicFields;
            let customizedDynFields = ctx.request.body.generalDynFields || [];
            return commonService(ctx).getDynamicFieldValues(customerReceiptDynFields, this.dynamicFields, customizedDynFields)
        },

        getEanUpc: function () {
            let itemSpec = ctx.cached.itemSpecMap[this.itemSpecId];
            let ean = _.isEmpty(itemSpec.eanCode) ? "" : itemSpec.eanCode;
            let upc = _.isEmpty(itemSpec.upcCode) ? "" : itemSpec.upcCode;
            return _.join(_.compact([ean, upc]), "/");
        },

        getReceiptItemLineDynTxtProperty: function () {
            let receipt = ctx.cached.receiptMap[this.receiptId];
            let customer = ctx.cached.customerMap[receipt.customerId];
            let customerReceiptItemLineDynFields = customer.receiptItemLineDynamicFields;
            let customizedDynFields = ctx.request.body.detailDynFields || [];
            return commonService(ctx).getDynamicFieldValues(customerReceiptItemLineDynFields, this.dynamicFields, customizedDynFields)
        },

        getCartonDynTxtProperty: function () {
            let customer = ctx.cached.customerMap[this.customerId];
            let customerReceiptItemLineDynFields = customer.receiptItemLineDynamicFields;
            let customizedDynFields = ctx.request.body.detailDynFields || [];
            return commonService(ctx).getDynamicFieldValues(customerReceiptItemLineDynFields, this.dynamicFields, customizedDynFields)
        },

        getItemDynTxtProperty: function () {
            let itemDynProperties = ctx.cached.itemDynTxtPropertyGroup[this.itemSpecId];
            let customizedDynPropertyIds = ctx.request.body.itemDynFieldIds || [];
            return commonService(ctx).getItemDynamicFieldValues(customizedDynPropertyIds, itemDynProperties);
        },

        getExpectdSNQty: function () {
            return _.size(this.snList);
        },

        getReceivedSNQty: function () {
            let receivedSNObj = ctx.cached.receivedSNMap[this.receiptId + "|" + this.itemSpecId];
            if (_.isEmpty(receivedSNObj)) {
                this.receivedSnList = [];
                return 0;
            }
            this.receivedSnList = receivedSNObj.snList;
            return receivedSNObj.snQty;
        },

        getReceivedDamagedQty: function () {
            let damagedDetail = ctx.cached.receivedDamagedMap[this.receiptItemLineId];
            return damagedDetail.qty;
        },

        getReceivedDamagedUOM: function () {
            let damagedDetail = ctx.cached.receivedDamagedMap[this.receiptItemLineId];
            let unitId = damagedDetail.unitId;
            return ctx.cached.unitMap[unitId].name;
        }
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
