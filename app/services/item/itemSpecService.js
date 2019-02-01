var _ = require('lodash');

let service = (app, ctx) => {

    async function getItemBasicInfoMap(itemIds) {
        let ids = Array.from(itemIds);
        if (!ids || ids.length === 0) {
            return {};
        }
        return (await fdApp(ctx).post('/item-spec/search', {
            "ids": ids
        })).reduce((map, obj) => {
            map[obj.id] = obj;
            return map;
        }, {});
    }

    async function fillItemName(objects) {
        let itemSpecIds = _.uniq(_.union(_.map(objects, "itemSpecId"), _.map(objects, "packageTypeItemSpecId")));
        itemSpecIds = _.compact(itemSpecIds);
        let itemMap = await getItemBasicInfoMap(itemSpecIds);
        _.forEach(objects, o => {
            if (o.itemSpecId && itemMap[o.itemSpecId]) {
                let itemSpec = itemMap[o.itemSpecId];
                o.itemSpecName = itemSpec.name;
                o.itemSpecDesc = itemSpec.desc;
                o.shortDescription = itemSpec.shortDescription;
                o.grade = itemSpec.grade;
                o.itemType = itemSpec.tags ? (_.includes(itemSpec.tags, "Material") ? "Material" : "Product") : null;
                o.nmfc = itemSpec.nmfc;
                o.freightClass = itemSpec.freightClass;
                o.groupId = itemSpec.groupId;
            }
            if (o.packageTypeItemSpecId && itemMap[o.packageTypeItemSpecId]) {
                o.packageTypeItemName = itemMap[o.packageTypeItemSpecId].name;
                o.packageTypeItemDesc = itemMap[o.packageTypeItemSpecId].desc;
            }
        });
    }

    return {
        fillItemName
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};