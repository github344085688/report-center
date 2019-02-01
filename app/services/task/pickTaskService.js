const _ = require('lodash');

let service = (app, ctx) => {

    async function getPickTaskMapByOrderId(orderIds, status) {
        if (!orderIds || orderIds.length === 0) return {};

        let pickTasks = await pickTaskCollection(ctx).find({orderIds: {$in: orderIds}}).toArray();
        let taskIds = _.map(pickTasks, "_id");

        let query = {_id: {$in: taskIds}};
        if (status) query.status = {$in:status};
        let generalTasks = await generalTaskCollection(ctx).find(query).toArray();
        let taskMap = _.keyBy(generalTasks, "_id");

        let pickTaskOrderMap = {};
        _.forEach(pickTasks, task => {
            let gTask = taskMap[task._id];
            if (!gTask) return;
            task.startTime = gTask.startTime ? momentZone(gTask.startTime).format('YYYY-MM-DD HH:mm:ss') : "";
            task.endTime = gTask.startTime ? momentZone(gTask.endTime).format('YYYY-MM-DD HH:mm:ss') : "";
            task.status = gTask.status ? gTask.status : "";
            _.forEach(task.orderIds, orderId => {
                if (pickTaskOrderMap[orderId]) {
                    pickTaskOrderMap[orderId].push(task);
                } else {
                    pickTaskOrderMap[orderId] = [task];
                }
            })
        });

        return pickTaskOrderMap;
    }

    return {
        getPickTaskMapByOrderId
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};