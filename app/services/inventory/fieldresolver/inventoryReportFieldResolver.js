let service = (app, ctx) => {
    return {
        getItem: function () {
            let itemSpec = ctx.cached.itemSpecMap[this.itemSpecId];
            return itemSpec ? itemSpec : {};
        },
        getUOM: function () {
            return ctx.cached.unitMap[this.unitId];
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
        getUnitPerPackage: function () {
            return ctx.cached.unitPerPkgMap[this.unitId];
        },
        getIncommingQty: function () {
            return ctx.cached.incommingItemQtyMap[this.itemSpecId + "|" + this.unitId + "|" + this.titleId] || 0;
        },
        getOpenOrderQty: function () {
            return ctx.cached.openOrderItemQtyMap[this.itemSpecId + "|" + this.unitId + "|" + this.titleId] || 0;
        },
        getStatusReportSnList: function () {
            return ctx.cached.statusReportItemSnMap[this.itemSpecId + "|" + this.unitId + "|" + this.titleId];
        },
        getAdjustFrom: function () {
            switch (this.type) {
                case "Adjust UOM" :
                    return ctx.cached.unitMap[this.adjustFrom] ? ctx.cached.unitMap[this.adjustFrom].name : "";
                    break;
                default:
                    return this.adjustFrom;
            }
        },
        getAdjustTo: function () {
            switch (this.type) {
                case "Adjust UOM" :
                    return ctx.cached.unitMap[this.adjustTo] ? ctx.cached.unitMap[this.adjustTo].name : "";
                    break;
                default:
                    return this.adjustTo;
            }
        }
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};