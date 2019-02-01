
let service = (app, ctx) => {
    async function getReceiptTaskMapByReceiptId(receiptIds) {
        if (!receiptIds || receiptIds.length === 0) return {};

        let receiveTasks = await receiveTaskCollection(ctx).find({receiptIds:{$in:receiptIds}}).toArray();
        if (!receiveTasks || receiveTasks.length === 0) return {};

        let taskIds = _.map(receiveTasks, "_id");
        let [receiveOffloadSteps,receiveSns] = await Promise.all([
            receiveOffloadCollection(ctx).find({taskId:{$in:taskIds}},{projection:{taskId:1,offloadType:1,trailerSize:1,shippingMethod:1}}).toArray(),
            receiveSnScanCollection(ctx).find({taskId:{$in:taskIds}}).toArray()
        ]);
        let receiveOffloadStepMap = _.keyBy(receiveOffloadSteps, "taskId");

        let taskSnMap = {};
        _.forEach(receiveSns, sn => {
            _.forEach(sn.scanDetails, detail => {
                if (!taskSnMap[sn.taskId]) {
                    taskSnMap[sn.taskId] = {snScan:0,lpScan:0};
                }
                if (detail.lpId) {
                    taskSnMap[sn.taskId].lpScan++;
                }
                _.forEach(detail.itemSNs, item => {
                    if (item.snList && item.snList.length > 0) {
                        taskSnMap[sn.taskId].snScan += item.snList.length;
                    }
                })
            })
        })

        let taskMap = {};
        _.forEach(receiveTasks, task => {
            let offload = receiveOffloadStepMap[task._id];
            _.forEach(task.receiptIds, receiptId => {
                taskMap[receiptId] = {
                    id: task._id,
                    entryId: task.entryId,
                    offloadType: offload ? offload.offloadType : "",
                    shippingMethod: offload ? offload.shippingMethod : "",
                    trailerSize: offload ? offload.trailerSize : "",
                    containerSize: offload ? offload.containerSize : "",
                    snScan: taskSnMap[task._id] ? taskSnMap[task._id].snScan : 0
                };
            })
        })

        return taskMap;
    }

    return {
        getReceiptTaskMapByReceiptId
    };
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};