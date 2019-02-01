const _ = require('lodash');

let service = (app, ctx) => {
    async function searchByPaging(criteria) {
        let head = ["LP",
            "DN",
            "Status",
            "Store #",
            "Long Haul #",
            "Qty",
            "Uom"
        ];
        let shortHead = head;
        let customerId = criteria.customerId
        if (!criteria.customerId || criteria.customerId.length === 0) {
            throw new BadRequestError('CustomerId can not be empty.');
        }
        let inventoriesSql = `select b.id as id, a.id as lpId,b.orderId,b.status,b.itemSpecId,b.qty,b.unitId from lp a,inventory b where b.status in('PICKED','PACKED','STAGED','LOADED') and b.qty>0 and HOUR(timediff(now(),b.createdWhen))>24 and a.id = b.lpId and b.customerId = '${customerId}'`;

        let inventories = await wmsMysql(ctx).query(inventoriesSql);
        let inventoryGroup = _.groupBy(inventories, "lpId");
        if (!inventories || inventories.length === 0) {
            return buildEmptyResult(head, shortHead);
        }
        let orderIds = _.uniq(_.map(inventories, "orderId"));
        let orders = await orderCollection(ctx).find({_id: {$in: orderIds}}).toArray();
        orderIds = _.map(orders, "_id");
        let orderMap = _.keyBy(orders, "_id");
        if (_.isEmpty(orderIds)) {
            orderIds = ["-1"];
        }
        let orderLongHualIds = _.uniq(_.map(orders, "longHaulId"));
        let orderLongHuals = await longHaulCollection(ctx).find({_id: {$in: orderLongHualIds}}).toArray();
        let orderLongHualMap = _.keyBy(orderLongHuals, "_id");


        let itemSpecIds = _.uniq(_.map(inventories, "itemSpecId"));
        let uoms = await itemUnitCollection(ctx).find({itemSpecId: {$in: itemSpecIds}}).toArray();
        let uomMap = _.keyBy(uoms, "_id");
        let storeNo = _.uniq(_.map(orders, "shipToAddress.storeNo"));
        let longHaul = await longHaulCollection(ctx).find({
            "stops.addressStoreNo": {$in: storeNo},
            customerId: customerId
        }).toArray();
        let longHaulMap = getLongHualMap(longHaul);
        let ids = _.uniq(_.map(inventories, "id"));
        let lpInvSql = `select * from inventory where id in('${ids.join("','")}') order by orderId desc `;
        let lpInvs = await wmsMysql(ctx).queryByPaging(lpInvSql);
        let data = [];
        _.forEach(lpInvs.results, function (inv) {
            let storeHaul = orderMap[inv.orderId] ? orderMap[inv.orderId].shipToAddress.storeNo : "";
            data.push({
                "LP": inv.lpId,
                "DN": inv.orderId,
                "Status": inv.status,
                "Store #": storeHaul,
                "Long Haul#": orderMap[inv.orderId] && orderMap[inv.orderId].longHaulId ? orderLongHualMap[orderMap[inv.orderId].longHaulId].longHaulNo : getLongHaul(longHaulMap, storeHaul),
                "Qty": inv.qty,
                "Uom": uomMap[inv.unitId] ? uomMap[inv.unitId].name : ""
            })

        })

        lpInvs.results = {
            data: data,
            head: head,
            shortHead: shortHead

        }
        return lpInvs;

    }

    function getLongHaul(longHaulMap, storeHaul) {
        if (!_.isEmpty(longHaulMap[storeHaul])) {
            if (longHaulMap[storeHaul].length === 1) {
                return longHaulMap[storeHaul][0].longHaulNo;
            }
        }
        return "";

    }

    function getLongHualMap(longHuals) {
        let map = {};
        _.forEach(longHuals, function (item) {
            _.forEach(item.stops, function (stop) {
                map[stop.addressStoreNo] = _.union(map[stop.addressStoreNo], [item]);
            })
        })
        return map;

    }

    function buildEmptyResult(head, shortHead) {
        return {
            results: {
                data: [],
                head: head,
                shortHead: shortHead
            },
            paging: {}
        }
    }

    function getOrderQty(inventories) {
        let qty = 0.0;
        _.forEach(inventories, function (item) {
            qty += item.qty;
        })
        return qty;
    }

    return {
        searchByPaging

    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};