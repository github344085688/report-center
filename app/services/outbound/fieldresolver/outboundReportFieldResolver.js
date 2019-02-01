const _ = require('lodash');

let service = (app, ctx) => {

    return {
        getOrder: function () {
            let order = ctx.cached.orderMap[this.orderId];
            return order ? order : {};
        },

        getEntryCarrierByLoad: function () {
            let entryCarrierInfo = ctx.cached.entryCarrierMapByLoad[this.loadId];
            return entryCarrierInfo ? entryCarrierInfo : {};
        },

        getLoadTask: function () {
            let loadTask = ctx.cached.loadTaskMap[this.loadTaskId];
            return loadTask ? loadTask : {}
        },

        getLoad: function () {
            let load = ctx.cached.loadMap[this.loadId];
            return load ? load : {}
        },

        getItem: function () {
            let itemSpec = ctx.cached.itemSpecMap[this.itemSpecId];
            return itemSpec ? itemSpec : {};
        },

        getShippedUom: function () {
            let shippedUom = ctx.cached.unitMap[this.shippedUnitId];
            return shippedUom ? shippedUom : {};
        },

        getCustomer: function () {
            let customer = ctx.cached.orgBasicMap[this.customerId];
            return customer ? customer : {};
        },

        getRetailer: function () {
            let retailer = ctx.cached.orgBasicMap[this.retailerId];
            return retailer ? retailer : {};
        },

        getCarrier: function () {
            let carrier = ctx.cached.carrierMap[this.carrierId];
            return carrier ? carrier : {};
        },

        getOrderDynTxtProperty: function () {
            let customer = ctx.cached.customerMap[this.customerId];
            let customerOrderDynFields = customer.orderDynamicFields;
            let customizedDynFields = ctx.request.body.generalDynFields || [];
            return commonService(ctx).getDynamicFieldValues(customerOrderDynFields, this.dynamicFields, customizedDynFields)
        },

        getOrderItemLineDynTxtProperty: function () {
            let order = ctx.cached.orderMap[this.orderId];
            let customer = ctx.cached.customerMap[order.customerId];
            let customerOrderItemLineDynFields = customer.orderItemLineDynamicFields;
            let customizedDynFields = ctx.request.body.detailDynFields || [];
            return commonService(ctx).getDynamicFieldValues(customerOrderItemLineDynFields, this.dynamicFields, customizedDynFields)
        },

        getEquipment: function () {
            let equipmentInfo = ctx.cached.equipmentInfoMap[this.orderId];
            if (equipmentInfo) {
                return equipmentInfo;
            }

            let receipt = ctx.cached.orderMap[this.orderId];
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

        getOrderedCft: function () {
            let unitCft = itemUnitService(ctx).getCftByUOM(ctx.cached.unitMap[this.unitId]);
            return _.round(this.orderedQty * unitCft, 2);
        },

        getShippedCft: function () {
            let unitCft = itemUnitService(ctx).getCftByUOM(ctx.cached.unitMap[this.unitId]);
            return _.round(this.shippedQty * unitCft, 2);
        },

        getOrderedWeight: function () {
            let unitWeight = itemUnitService(ctx).getWeightByUOM(ctx.cached.unitMap[this.unitId]);
            return _.round(this.orderedQty * unitWeight, 2);
        },

        getShippedWeight: function () {
            let unitWeight = itemUnitService(ctx).getWeightByUOM(ctx.cached.unitMap[this.unitId]);
            return _.round(this.shippedQty * unitWeight, 2);
        },

        getTrackingNo: function () {
            let key = this.orderId + "|" + this.itemSpecId;
            return ctx.cached.trackingNoMap[key]
        },

        getUnitPrice: function () {
            let uom = ctx.cached.unitMap[this.unitId];
            return uom.price;
        },

        getUOM: function () {
            return ctx.cached.unitMap[this.unitId];
        },

        getEanUpc: function () {
            let itemSpec = ctx.cached.itemSpecMap[this.itemSpecId];
            let ean = _.isEmpty(itemSpec.eanCode) ? "" : itemSpec.eanCode;
            let upc = _.isEmpty(itemSpec.upcCode) ? "" : itemSpec.upcCode;
            return _.join(_.compact([ean, upc]), "/");
        },

        getOrderItemLineDynTxtProperty: function () {
            let order = ctx.cached.orderMap[this.orderId];
            let customer = ctx.cached.customerMap[order.customerId];
            let customerOrderItemLineDynFields = customer.orderItemLineDynamicFields;
            return commonService(ctx).getDynamicFieldMapping(customerOrderItemLineDynFields, this.dynamicFields)
        }
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
