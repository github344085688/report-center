const _ = require('lodash');
const ObjectID = require('mongodb-core').BSON.ObjectID;

let service = (app, ctx) => {
    let CUBIC_METER_CONVERT_TO_CFT = 35.3147248;
    let CUBIC_CENTIMETER_CONVERT_TO_CFT = 0.0000353;
    let CUBIC_INCH_CONVERT_TO_CFT = 0.0005787;

    async function getUnitMapByIds(unitIds) {
        return await app.util.getMapFromCache(ctx.cached.unitMap, unitIds, getUnitMap);
    }

    async function getCsUnitMapByItemSpecIds(itemSpecIds) {
        return await app.util.getMapFromCache(ctx.cached.csUnitMap, itemSpecIds, _getCsUnitMapByItemSpecIds);
    }

    async function _getCsUnitMapByItemSpecIds(itemSpecIds) {
        let units = await getUnitMap(null, null, itemSpecIds);
        units = _.filter(units, u => u.name === "CS");
        return _.keyBy(units, "itemSpecId");
    }

    async function getUnitMap(unitIds, customerId, itemSpecIds) {
        let units = await _getUnits(unitIds, customerId, itemSpecIds);
        _.forEach(units, uom => {
            uom._id = uom._id.toString();
        });
        return _.keyBy(units, "_id");
    }

    async function _getUnits(unitIds, customerId, itemSpecIds) {
        itemSpecIds = itemSpecIds || [];
        if (customerId) {
            let items = await itemSpecCollection(ctx).query({customerId: customerId}, {projection: {_id: 1}});
            let itemIds = _.map(items, "_id");
            itemSpecIds = _.union(itemSpecIds, itemIds);
        }
        let param = {};
        if (unitIds && unitIds.length > 0) {
            let objIds = _.map(unitIds, unitId => new ObjectID(unitId));
            param._id = {$in: objIds};
        }
        if (itemSpecIds && itemSpecIds.length > 0) {
            param.itemSpecId = {$in: itemSpecIds};
        }

        return await itemUnitCollection(ctx).query(param, {
            projection: {
                itemSpecId: 1,
                name: 1,
                qty: 1,
                baseQty: 1,
                price: 1,
                priceUnit: 1,
                length: 1,
                width: 1,
                height: 1,
                linearUnit: 1,
                weight: 1,
                weightUnit: 1,
                volume: 1,
                volumeUnit: 1

            }
        });
    }

    function getCftByUOM(itemUnit) {
        if (!itemUnit) return 0;
        if (itemUnit.cft) {
            return itemUnit.cft;
        }

        let cft = 0;
        if (!_.isEmpty(itemUnit.volume) && !_.isEmpty(itemUnit.volumeUnit)) {
            cft = _calculateCFTByVolume(itemUnit);
        } else {
            cft = _calculateCFTByWLH(itemUnit);
        }

        itemUnit.cft = cft;
        return cft;
    }

    function _calculateCFTByWLH(itemUnit) {
        let cft = 0;
        if (itemUnit.width) {
            cft = itemUnit.width;
        }
        if (itemUnit.length) {
            cft = cft * itemUnit.length;
        }
        if (itemUnit.height) {
            cft = cft * itemUnit.height;
        }

        if (!itemUnit.linearUnit) {
            cft = cft * CUBIC_INCH_CONVERT_TO_CFT;
        }

        if (itemUnit.linearUnit === "M") {
            cft = cft * CUBIC_METER_CONVERT_TO_CFT;
        }
        if (itemUnit.linearUnit === "CM") {
            cft = cft * CUBIC_CENTIMETER_CONVERT_TO_CFT;
        }
        if (itemUnit.linearUnit === "INCH") {
            cft = cft * CUBIC_INCH_CONVERT_TO_CFT;
        }

        return cft;
    }

    function _calculateCFTByVolume(itemUnit) {
        let cft = 0;
        switch (itemUnit.volumeUnit) {
            case "CU_IN":
                cft = itemUnit.volume * CUBIC_INCH_CONVERT_TO_CFT;
                break;
            case "CBM":
                cft = itemUnit.volume * CUBIC_METER_CONVERT_TO_CFT;
                break;
            default:
                break;
        }
        return cft;
    }

    function getSquareByUOM(itemUnit) {
        if (!itemUnit) return 0;

        let square = 0;
        if (itemUnit.width) {
            square = itemUnit.width;
        }
        if (itemUnit.length) {
            square = square * itemUnit.length;
        }

        if (!itemUnit.linearUnit) {
            return square;
        }

        let M_CONVERT_TO_CFT = 10.76391;
        let CM_CONVERT_TO_CFT = 0.0010764;
        let INCH_CONVERT_TO_CFT = 0.006944;

        if (itemUnit.linearUnit === "M") {
            return square * M_CONVERT_TO_CFT;
        }
        if (itemUnit.linearUnit === "CM") {
            return square * CM_CONVERT_TO_CFT;
        }
        if (itemUnit.linearUnit === "INCH") {
            return square * INCH_CONVERT_TO_CFT;
        }

        return square;
    }

    function getWeightByUOM(itemUnit) {
        if (!itemUnit) return 0;

        let weight = 0;
        if (itemUnit.weight) {
            weight = itemUnit.weight;
        }

        if (!itemUnit.weightUnit) {
            return weight;
        }

        let KG_TO_POUND = 2.2046;
        let G_TO_POUND = 0.0022046;

        if (itemUnit.weightUnit === "KG") {
            return weight * KG_TO_POUND;
        }
        if (itemUnit.weightUnit === "G") {
            return weight * G_TO_POUND;
        }
        return weight;
    }

    async function isCaseUom(itemUnit) {
        if (!itemUnit) return false;
        if (!app.csUnitNames) {
            let groups = await pickStrategyUnitGroupCollection(ctx).find({pickType: "CASE_PICK"}).toArray();
            app.csUnitNames = [];
            _.forEach(groups, group => {
                app.csUnitNames = _.union(app.csUnitNames, group.unitNames);
            })
            app.csUnitNames = _.compact(_.uniq(app.csUnitNames));
        }
        return _.includes(app.csUnitNames, itemUnit.name);
    }

    async function isPieceUom(itemUnit) {
        if (!itemUnit) return false;
        if (!app.eaUnitNames) {
            let groups = await pickStrategyUnitGroupCollection(ctx).find({pickType: "PIECE_PICK"}).toArray();
            app.eaUnitNames = [];
            _.forEach(groups, group => {
                app.eaUnitNames = _.union(app.eaUnitNames, group.unitNames);
            });
            app.eaUnitNames = _.compact(_.uniq(app.eaUnitNames));
        }
        return _.includes(app.eaUnitNames, itemUnit.name);
    }

    return {
        getUnitMapByIds,
        getCsUnitMapByItemSpecIds,
        getUnitMap,
        getCftByUOM,
        getSquareByUOM,
        getWeightByUOM,
        isCaseUom,
        isPieceUom
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
