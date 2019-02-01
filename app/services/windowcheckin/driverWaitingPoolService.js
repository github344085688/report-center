let service = (app, ctx) => {


    async function searchByPaging(criteria) {
        let head = ["Entry ID", "Entry Time", "Driver Name", "Driver Phone #", "REF # / Tractor #", "Time In Yard"];
        let entryTicketWaitings = await getEntryTicketWaitingData();
        let entryTicketIds = _.map(entryTicketWaitings, "_id");
        let entryTicketWaitingMap = _.keyBy(entryTicketWaitings, "_id");
        if (_.isEmpty(entryTicketIds)) {
            entryTicketIds = ["-1"];
        }
        criteria.ids = entryTicketIds;
        let entryTickets = await getEntryTickets(criteria);
        let entryTicketMap = _.keyBy(entryTickets, "_id");

        let entryTicketCheckIns = await entryTicketCheckCollection(ctx).find({
            entryId: {$in: entryTicketIds},
            checkType: "CHECKIN"
        }).toArray();
        let entryTicketCheckInMap = _.keyBy(entryTicketCheckIns, "entryId");

        if (_.isEmpty(entryTickets.results)) {
            entryTickets.results = {
                data: [],
                head: head,
                shortHead: head
            }
            return entryTickets;
        }

        let entryIds = _.map(entryTickets.results, "_id");
        let entryTicketActivities = await entryTicketActivityCollection(ctx).find({entryId: {$in: entryIds}}).toArray();
        let entryTicketActivityMap = _.keyBy(entryTicketActivities, "entryId");
        let receiveRefNoMap = await getReceiveMap(entryTicketActivities);
        let loadRefNoMap = await  getLoadReferenceNoMap(entryTicketActivities);

        let data = [];
        _.forEach(entryTickets.results, function (item) {
            let entryTicketActivity = entryTicketActivityMap[item._id];
            let refNo = getRefNo(entryTicketActivity, receiveRefNoMap, loadRefNoMap);
            data.push({
                "Entry ID": item._id,
                "Entry Time": item.checkInStartTime ? momentZone(item.checkInStartTime).format('YYYY-MM-DD HH:mm:ss') : "",
                "Driver Name": entryTicketCheckInMap[item._id] ? entryTicketCheckInMap[item._id].driverName : "",
                "Driver Phone #": entryTicketWaitingMap[item._id] ? entryTicketWaitingMap[item._id].contactInfo : "",
                "REF # / Tractor #": entryTicketCheckInMap[item._id] ? refNo + "/" + entryTicketCheckInMap[item._id].tractor : refNo,
                "Time In Yard": commonService(ctx).calculateDuration(item.checkInStartTime, momentZone())

            })
        })

        entryTickets.results = {
            data: data,
            head: head,
            shortHead: head
        }

        return entryTickets;
    }

    async function getEntryTickets(criteria) {
        criteria.statuses = ["WAITING"];
        let entryTicketSearch = new EntryTicketSearch(criteria);
        let criteriaClause = entryTicketSearch.buildClause();
        let entryTickets = await entryTicketCollection(ctx).findByPaging(criteriaClause);
        return entryTickets;
    }

    async function getReceiveMap(entryTicketActivities) {
        let receiveEntryTicketActivities = _.filter(entryTicketActivities, function (item) {
            return item.taskType === "RECEIVE";
        });

        let receiveIds = _.map(receiveEntryTicketActivities, "subTaskId");
        let receives = await receiptCollection(ctx).find({_id: {$in: receiveIds}}).toArray();
        let receiveMap = _.keyBy(receives, "_id");
        return receiveMap;

    }

    async function getLoadReferenceNoMap(entryTicketActivities) {
        let loadEntryTicketActivities = _.filter(entryTicketActivities, function (item) {
            return item.taskType === "LOAD";
        });

        let loadIds = _.map(loadEntryTicketActivities, "subTaskId");
        let loadOrderLines = await loadOrderLineCollection(ctx).find({loadId: {$in: loadIds}}).toArray();
        let loadOrderLineGroup = _.groupBy(loadOrderLines, "loadId");
        let orderIds = _.uniq(_.map(loadOrderLines, "orderId"));
        let orders = await orderCollection(ctx).find({_id: {$in: orderIds}}).toArray();
        let orderMap = _.groupBy(orders, "_id");

        let shipmentDetails = await shipmentDetailCollection(ctx).find({"itemLineDetails.orderId": {$in: orderIds}}).toArray();
        let data = {};
        _.forEach(loadIds, function (loadId) {
            let orderLines = loadOrderLineGroup[loadId];
            let refNos = [];
            let pickUpNo = "";
            _.forEach(orderLines, function (orderLine) {
                let orders = orderMap[orderLine.orderId];
                if (!_.isEmpty(orders)) {
                    refNos.push(getOrdersRefNo(orders));
                    pickUpNo = getOrderPickupNo(orderLine.orderId, shipmentDetails);
                }

            })
            if (!_.isEmpty(refNos) && pickUpNo !== "") {
                data[loadId] = {_id: loadId, referenceNo: refNos.join(",") + " / " + pickUpNo};
            } else if (!_.isEmpty(refNos) && pickUpNo === "") {
                data[loadId] = {_id: loadId, referenceNo: refNos.join(",")};
            } else if (_.isEmpty(refNos) && pickUpNo !== "") {
                data[loadId] = {_id: loadId, referenceNo: " / " + pickUpNo};
            }

        })
        return data;
    }

    function getOrdersRefNo(orders) {
        if (!_.isEmpty(orders)) {
            let trackingNos = _.uniq(_.map(orders, "referenceNo"));
            return trackingNos.join(",")
        }
        return "";
    }

    function getOrderPickupNo(orderId, shipmentDetails) {
        if (!_.isEmpty(shipmentDetails)) {
            let details = _.filter(shipmentDetails, function (detail) {
                let itemLineDetails = detail.itemLineDetails;
                let orderIds = _.map(itemLineDetails, "orderId");
                if (_.includes(orderIds, orderId)) {
                    return true;
                }
            })
            if (!_.isEmpty(details)) {
                let trackingNos = _.uniq(_.map(details, "trackingNo"));
                return trackingNos.join(",")
            }
        }
        return "";


    }

    function getRefNo(entryTicketActivity, receiveRefNoMap, loadRefNoMap) {
        if (entryTicketActivity) {
            if (entryTicketActivity.taskType === "RECEIVE") {
                let receiveId = entryTicketActivity.subTaskId;
                if (receiveRefNoMap[receiveId]) {
                    return receiveRefNoMap[receiveId].referenceNo ? receiveRefNoMap[receiveId].referenceNo : "";
                }
            }
            if (entryTicketActivity.taskType === "LOAD") {
                let loadId = entryTicketActivity.subTaskId;
                if (loadRefNoMap[loadId]) {
                    return loadRefNoMap[loadId].referenceNo ? loadRefNoMap[loadId].referenceNo : "";
                }
            }

        }
        return "";
    }


    async function getEntryTicketWaitingData(criteria) {
        let entryTicketWaitingData = await entryTicketWaitingCollection(ctx).find().toArray();
        return entryTicketWaitingData;
    }

    class EntryTicketSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                ids: new MongoOperator('$in', '_id'),
                statuses: new MongoOperator('$in', 'status')
            };
        }
    }

    return {
        searchByPaging
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};