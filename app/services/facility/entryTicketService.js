const _ = require('lodash');

let service = (app, ctx) => {

    async function getEntryTicketMapBySubTaskId(subTaskIds) {
        if (!subTaskIds || subTaskIds.length === 0) return [];

        let entryTickets = await entryTicketActivityCollection(ctx).find({subTaskId: {$in: subTaskIds}}).toArray();
        let entryTicketIds = _.uniq(_.map(entryTickets, "entryId"));
        let entryTicketChecks = await entryTicketCheckCollection(ctx).find({entryId: {$in: entryTicketIds}}).toArray();
        let entryTicketCheckMap = _.keyBy(entryTicketChecks, "entryId");

        let data = [];
        _.forEach(entryTickets, ticket => {
            let ticketCheck = entryTicketCheckMap[ticket.entryId];
            data.push({
                entryId: ticket.entryId,
                subTaskId: ticket.subTaskId,
                tractor: ticketCheck && ticketCheck.tractor ? ticketCheck.tractor : "",
                trailers: ticketCheck && ticketCheck.trailers ? ticketCheck.trailers : [],
                containerNOs: ticketCheck && ticketCheck.containerNOs ? ticketCheck.containerNOs : [],
                equipmentType: ticketCheck && ticketCheck.equipmentType ? ticketCheck.equipmentType : ""
            })
        });

        return _.groupBy(data, "subTaskId");
    }

    return {
        getEntryTicketMapBySubTaskId
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};


