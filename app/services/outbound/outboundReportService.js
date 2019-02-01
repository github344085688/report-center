const _ = require('lodash');

let service = (app, ctx) => {
    // Item Level Split by Shipment Ticket
    async function searchItemLevelSplitByShipmentTicket(criteria) {
        let [itemLineRawDatas, reportFieldMapping] = await Promise.all([
            _getItemLineRawDatas(criteria),
            commonService(ctx).getReportFieldMapping("OUTBOUND_FINISHED", "ITEM_LEVEL_SPLIT_BY_SHIPMENT_TICKET", criteria.customerId)
        ]);

        return await _formatData(reportFieldMapping, itemLineRawDatas);
    }

    async function _formatData(reportFieldMapping, rawDatas) {
        let results = await outboundReportResolver(ctx).resolveOutboundFields(rawDatas, reportFieldMapping.fieldMappings);
        return {
            results: {
                head: _.map(reportFieldMapping.fieldMappings, "customerField"),
                data: results
            },
            paging: {
                totalCount: 1,
                pageNo: 1,
                totalPage: 1,
                startIndex: 1,
                endIndex: 1,
            }
        }
    }

    async function _getItemLineRawDatas(criteria) {
        let shipmentTickets = await _searchShipmentTickets(criteria);
        let allShippedLpIds = _.uniq(_.flatMap(shipmentTickets, "loadedSlpIds"));
        if (_.isEmpty(allShippedLpIds)) {
            return [];
        }
        allShippedLpIds = await lpService(ctx).getInnerLpIdsIncludeOuterLp(allShippedLpIds);

        // 50000 is about 2 month data for bevmo (about 80MB)
        if (_.size(allShippedLpIds) > 50000) {
            throw new BadRequestError('Too many data. please reduce order count.');
        }

        await _groupShippedLpIdsToShipmentTicket(shipmentTickets, allShippedLpIds);

        let invSearch = new InventorySearch({orderIds: criteria.orderIds, lpIds: allShippedLpIds});
        let searchSql =
            `SELECT inv.itemSpecId, inv.orderId, inv.lpId, inv.unitId, inv.loadTaskId, sum(inv.qty) qty, sum(weight) weight
               FROM inventory inv
              WHERE ${invSearch.buildClause()}
           GROUP BY inv.itemSpecId, inv.orderId, inv.lpId, inv.unitId`;
        let shippedInvs = await wmsMysql(ctx).query(searchSql);
        return _getItemLineRawDataSplitByShipmentTicket(shipmentTickets, shippedInvs);
    }

    async function _groupShippedLpIdsToShipmentTicket(shipmentTickets, allShippedLpIds) {
        let parentChildrenPairs = await lpService(ctx).getLpParentChildPairs(allShippedLpIds);
        for (let shipmentTicket of shipmentTickets) {
            if (_.isEmpty(shipmentTicket.loadedSlpIds)) continue;

            let innerLpIds = lpService(ctx).getInnerLpIdsByParentChildrenPairs(shipmentTicket.loadedSlpIds, parentChildrenPairs);
            shipmentTicket.loadedSlpIds = _.uniq(_.union(shipmentTicket.loadedSlpIds, innerLpIds));
        }
    }


    function _getItemLineRawDataSplitByShipmentTicket(shipmentTickets, shippedInvs) {
        let invsGroupByShipmentTicket = _getInvsGroupByShipmentTicket(shipmentTickets, shippedInvs);

        let itemLines = [];
        for (let ticket of shipmentTickets) {
            let ticketInvs = _.compact(invsGroupByShipmentTicket[ticket._id]);
            if (_.isEmpty(ticketInvs)) continue;

            let invsGroupByItemAndUnit = _.groupBy(ticketInvs, _buildKeyByItemAndUnit);
            for (invs of _.values(invsGroupByItemAndUnit)) {
                itemLines.push({
                    shipmentTicketId: ticket._id,
                    orderId: invs[0].orderId,
                    itemSpecId: invs[0].itemSpecId,
                    loadId: ticket.loadId,
                    loadTaskId: invs[0].loadTaskId,
                    shippedUnitId: invs[0].unitId,
                    shippedQty: _.sumBy(invs, "qty"),
                    weight: _.sumBy(invs, "weight"),
                    shippedTime: ticket.updatedWhen
                });
            }
        }

        return itemLines;
    }

    function _buildKeyByItemAndUnit(inv) {
        return `${inv.orderId}|${inv.itemSpecId}|${inv.unitId}`;
    }

    function _getInvsGroupByShipmentTicket(shipmentTickets, shippedInvs) {
        let invsGroupByShipmentTicket = {};

        let shippedInvsGroupByLpId = _.groupBy(shippedInvs, "lpId");
        for (let ticket of shipmentTickets) {
            if (_.isEmpty(ticket.loadedSlpIds)) continue;

            let shipmentTicketInvs = [];
            for (let lpId of ticket.loadedSlpIds) {
                shipmentTicketInvs = _.concat(shipmentTicketInvs, shippedInvsGroupByLpId[lpId]);
                delete shippedInvsGroupByLpId[lpId];
            }
            invsGroupByShipmentTicket[ticket._id] = shipmentTicketInvs;
        }

        return invsGroupByShipmentTicket;
    }


    function _getOrderIds(orders) {
        let orderIds = _.uniq(_.map(orders, "_id"));
        if (_.isEmpty(orderIds)) {
            return ["-1"];
        }
        return orderIds;
    }


    async function _searchShipmentTickets(criteria) {
        // For item level split by shipment ticket, shippedTime should be applied on shipment ticket instead of order
        let shipmentTicketCriteria = {
            status: "CLOSED",
            shippedTimeFrom: criteria.shippedTimeFrom,
            shippedTimeTo: criteria.shippedTimeTo
        };

        delete criteria.shippedTimeFrom;
        delete criteria.shippedTimeTo;
        let orders = await _searchOrders(criteria);

        shipmentTicketCriteria.orderIds = _getOrderIds(orders);
        return await shipmentTicketService(ctx).searchShipmentTickets(shipmentTicketCriteria, {
            _id: 1,
            orderId: 1,
            loadId: 1,
            loadedSlpIds: 1,
            updatedWhen: 1
        });
    }

    async function _searchOrders(criteria) {
        let hash = app.util.hash(criteria);
        if (!ctx.cached.hashMap[hash]) {
            let orderSearch = new OrderSearch(criteria);
            ctx.cached.hashMap[hash] = await orderCollection(ctx).query(orderSearch.buildClause());
        }

        return ctx.cached.hashMap[hash];
    }

    class OrderSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                orderId: new MongoOperator('$eq', '_id'),
                orderIds: new MongoOperator('$in', '_id'),
                customerId: new MongoOperator('$eq', 'customerId'),
                shippedTimeFrom: new MongoOperator('$gte', 'shippedTime', 'Date'),
                shippedTimeTo: new MongoOperator('$lt', 'shippedTime', 'Date'),
                orderedDateFrom: new MongoOperator('$gte', 'orderedDate', 'Date'),
                orderedDateTo: new MongoOperator('$lt', 'orderedDate', 'Date'),
                scheduleDateFrom: new MongoOperator('$gte', 'scheduleDate', 'Date'),
                scheduleDateTo: new MongoOperator('$lt', 'scheduleDate', 'Date'),
                createdTimeFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                createdTimeTo: new MongoOperator('$lte', 'createdWhen', 'Date'),
                statuses: new MongoOperator('$in', 'status')
            };
        }
    }

    class InventorySearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                orderIds: new DBOperator('IN', 'orderId'),
                lpIds: new DBOperator('IN', 'lpId')
            };
        }
    }

    return {
        searchItemLevelSplitByShipmentTicket
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
