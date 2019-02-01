
let service = (app, ctx) => {
    async function getTransloadTaskMapByReceiptId(receiptIds) {
        if (!receiptIds || receiptIds.length === 0) return {};

        let [transloadTasks,transloadOffloads] = await Promise.all([
            transloadReceivingCollection(ctx).find({receiptId:{$in:receiptIds}}).toArray(),
            transloadOffloadCollection(ctx).find({receiptId:{$in:receiptIds}}).toArray()
        ]);
        let transloadOffloadMap = _.keyBy(transloadOffloads, "taskId");

        let transloadTaskMap = {};
        _.forEach(transloadTasks, transload => {
            if (!transload.receiptId) return;
            let offload = transloadOffloadMap[transload.taskId];

            transloadTaskMap[transload.receiptId] = {
                id: transload.taskId,
                entryId: transload.entryId,
                offloadType: offload ? offload.offloadType : "",
                trailerSize: offload ? offload.trailerSize : "",
                containerSize: offload ? offload.containerSize : "",
                lpScan: transload.cartons ? transload.cartons.length : 0,
                cartons: transload.cartons
            };
        })
        return transloadTaskMap;
    }

    return {
        getTransloadTaskMapByReceiptId
    };
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};