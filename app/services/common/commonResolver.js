let service = (app, ctx) => {
    async function safePrefetchEquipments(subTaskIds) {
        try {
            await _prefetchEquipments(subTaskIds);
        } catch (ignored) {
        }
    }

    async function _prefetchEquipments(subTaskIds) {
        let entryTickets = await entryTicketActivityCollection(ctx).find({
            "subTaskId": {$in: subTaskIds}
        }).toArray();

        if (_.isEmpty(entryTickets)) return;
        let entryIds = _.uniq(_.map(entryTickets, "entryId"));
        if (_.isEmpty(entryIds)) return;
        let [entryTicketCheckRecords, equipments] = await Promise.all([
            entryTicketCheckCollection(ctx).find({"entryId": {$in: entryIds}}).toArray(),
            ymsApp(ctx).post('/yard-equipment/search', {
                "checkInEntries": entryIds
            })
        ]);
        if (_.isEmpty(entryTicketCheckRecords)) return;

        let entryActivitiesGroupByReceiptId = _.groupBy(entryTickets, "subTaskId");
        _.each(subTaskIds, subTaskId => {
            let entryActivities = entryActivitiesGroupByReceiptId[subTaskId];
            if (_.isEmpty(entryActivities)) return;
            let entryIds = _.uniq(_.map(entryActivities, "entryId"));
            let equipmentTypes = _.uniq(_.map(_.filter(entryTicketCheckRecords, e => _.includes(entryIds, e.entryId)), "equipmentType"));
            let equipmentNos = _.map(_.filter(equipments, o => _.includes(entryIds, o.checkInEntry)), "equipmentNo");

            if (!_.isEmpty(equipmentNos)) {
                ctx.cached.equipmentInfoMap[subTaskId] = {
                    equipmentType: _.join(equipmentTypes, ","),
                    equipmentNo: _.join(equipmentNos, ",")
                };
            }
        });
    }

    function _resolveFields(resolverService, raw, reportFields, wiseInternalFields) {
        _.assign(raw, resolverService);

        let result = {};
        for (let field of reportFields) {
            try {
                result[field.customerField] = eval(field.wiseField);
            } catch (err) {
                // you can enable this to facilitate local trouble shooting.
                // app.logger.error(err, "Error when resolving value for " + field.customerField + ". Fetch function: " + field.wiseField);
            }
        }

        for (let field of wiseInternalFields) {
            result[field] = raw[field]
        }
        return result;
    }

    async function fetchAndResolveFields(rawDatas, reportFields, necessayInternalFields, fieldPrefetchPromises, resolver) {
        //fetch and cache field values
        if (_.isEmpty(fieldPrefetchPromises)) return;
        await Promise.all(fieldPrefetchPromises);

        //resolve fields
        let results = [];
        for (let raw of rawDatas) {
            results.push(_resolveFields(resolver(ctx), raw, reportFields, necessayInternalFields));
        }
        return results;
    }

    return {
        safePrefetchEquipments,
        fetchAndResolveFields
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};