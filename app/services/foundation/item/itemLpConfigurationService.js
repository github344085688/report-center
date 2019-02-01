const ObjectID = require('mongodb-core').BSON.ObjectID;

let service = (app, ctx) => {

    async function getItemLpConfigurations(itemSpecIds) {
        let itemLpConfigurations = await singleItemLpConfigurationCollection(ctx).find({itemSpecId: {$in: itemSpecIds}}).toArray();
        if (!itemLpConfigurations || itemLpConfigurations.length === 0) return [];

        let lpConfigurationTemplateIds = _.uniq(_.map(itemLpConfigurations, "lpConfigurationTemplateId"));
        let singleLpTemplates = await singleLpTemplateCollection(ctx).find({_id: {$in: lpConfigurationTemplateIds}}).toArray();
        let singleLpTemplateMap = _.keyBy(singleLpTemplates, "_id");

        let unitIds = _.uniq(_.map(itemLpConfigurations, "unitId"));
        unitIds = _.map(unitIds, unitId => new ObjectID(unitId));
        let units = await itemUnitCollection(ctx).find({_id: {$in: unitIds}}).toArray();
        let uomMap = _.keyBy(units, "_id");

        let configurations = [];
        _.forEach(itemLpConfigurations, conf => {
            let uom = uomMap[conf.unitId];
            let lpTemplate = singleLpTemplateMap[conf.lpConfigurationTemplateId];
            configurations.push({
                confId: conf.lpConfigurationTemplateId,
                itemSpecId: conf.itemSpecId,
                name: conf.name,
                isDefault: conf.isDefault,
                uomName: uom ? uom.name : "",
                templateName: lpTemplate ? lpTemplate.name : "",
                totalQty: lpTemplate ? lpTemplate.totalQty : 0,
                totalEAQty: lpTemplate && uom ? lpTemplate.totalQty * uom.baseQty : 0
            })
        })

        return configurations;
    }

    function getItemLpTemplateTatalEaQty(lpConfiguration, customer) {
        let totalEAQty = lpConfiguration ? lpConfiguration.totalEAQty : 0;
        let qtyPercent = customer && customer.billingPalletQtyPercent ? customer.billingPalletQtyPercent : app.defaultValues.palletQtyPercent;

        return totalEAQty * qtyPercent;
    }

    async function getQtyPerPalletMap(itemSpecIds) {
        return await app.util.getMapFromCache(ctx.cached.qtyPerPalletMap, itemSpecIds, _getQtyPerPalletMap);
    }

    async function _getQtyPerPalletMap(itemSpecIds) {
        //get item lp configration
        if (_.isEmpty(itemSpecIds)) return;
        let itemLpConfigurations = await singleItemLpConfigurationCollection(ctx).find({
            "itemSpecId": {$in: itemSpecIds},
            "scene": "INBOUND",
            "status": "ENABLE"
        }).toArray();
        if (_.isEmpty(itemLpConfigurations)) return;
        let lpConfigurationMapByItem = _.keyBy(itemLpConfigurations, "itemSpecId");

        //get lp template
        let lpTemplateIds = _.uniq(_.map(itemLpConfigurations, "lpConfigurationTemplateId"));
        let unitIds = _.uniq(_.map(itemLpConfigurations, "unitId"));
        if (_.isEmpty(lpTemplateIds)) return;
        let [lpTemplates,] = await Promise.all([
            singleLpTemplateCollection(ctx).find({"_id": {$in: lpTemplateIds}}).toArray(),
            itemUnitService(ctx).getUnitMapByIds(unitIds)
        ]);

        let lpTemplatesMap = _.keyBy(lpTemplates, "_id");
        _.each(lpConfigurationMapByItem, (lpConfiguration, itemSpecId) => {
            let lpTemplate = lpTemplatesMap[lpConfiguration.lpConfigurationTemplateId];
            let lpConfUom = ctx.cached.unitMap[lpConfiguration.unitId];
            if (!lpTemplate || !lpConfUom) return;

            ctx.cached.qtyPerPalletMap[itemSpecId] = `${lpTemplate.totalQty} ${lpConfUom.name}`;
        });
    }


    return {
        getItemLpConfigurations,
        getItemLpTemplateTatalEaQty,
        getQtyPerPalletMap
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};