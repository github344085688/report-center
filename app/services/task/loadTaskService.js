let service = (app, ctx) => {

    async function getLoadTaskMapByOrderId(orderIds, status) {
        if (!orderIds || orderIds.length === 0) return {};

        let loads = await loadOrderLineCollection(ctx).find({orderId: {$in: orderIds}}).toArray();
        let loadIds = _.uniq(_.map(loads, "loadId"));

        let loadTasks = await loadTaskCollection(ctx).find({loadIds: {$in: loadIds}}).toArray();
        let taskIds = _.map(loadTasks, "_id");

        let loadSteps = await loadingStepCollection(ctx).find({taskId: {$in: taskIds}}).toArray();
        let stepMap = _.keyBy(loadSteps, "taskId");
        let slpIds = [];
        _.forEach(loadSteps, step => {
            _.forEach(step.loadResults, loadRes => {
                slpIds = _.union(slpIds, loadRes.loadedSlpIds);
            })
        })
        let innerLps = await lpService(ctx).getInnerLps(slpIds);

        let query = {_id: {$in: taskIds}};
        if (status) query.status = {$in: status};
        let generalTasks = await generalTaskCollection(ctx).find(query).toArray();
        let taskMap = _.keyBy(generalTasks, "_id");

        let loadTaskOrderMap = {};
        _.forEach(loadTasks, task => {
            let gTask = taskMap[task._id];
            if (!gTask) return;

            let startTime = gTask.startTime ? momentZone(gTask.startTime).format('YYYY-MM-DD HH:mm:ss') : "";
            let endTime = gTask.startTime ? momentZone(gTask.endTime).format('YYYY-MM-DD HH:mm:ss') : "";

            let orderSlpMap = {};
            let step = stepMap[task._id];
            _.forEach(step.loadResults, loadRes => {
                orderSlpMap[loadRes.orderId] = orderSlpMap[loadRes.orderId] || [];
                orderSlpMap[loadRes.orderId] = _.union(orderSlpMap[loadRes.orderId], loadRes.loadedSlpIds);
            })

            _.forEach(orderSlpMap, (slps, orderId) => {
                let loadTask = {
                    startTime: startTime,
                    endTime: endTime,
                    status: gTask.status ? gTask.status : "",
                    entryId: task.entryId,
                    loadSlpIds: slps,
                    innerLps: _.filter(innerLps, lp => _.includes(slps, lp.outerLp))
                };

                if (loadTaskOrderMap[orderId]) {
                    loadTaskOrderMap[orderId].push(loadTask);
                } else {
                    loadTaskOrderMap[orderId] = [loadTask];
                }
            })
        });

        return loadTaskOrderMap;
    }

    async function getLoadTaskMap(loadTaskIds) {
        return await app.util.getMapFromCache(ctx.cached.loadTaskMap, loadTaskIds, _getLoadTaskMap);
    }

    async function _getLoadTaskMap(taskIds) {
        if (_.isEmpty(taskIds)) return {};
        let loadTasks = await loadTaskCollection(ctx).find({_id: {$in: taskIds}}, {
            projection: {
                _id: 1,
                "seal.sealNo": 1
            }
        }).toArray();


        return _.keyBy(loadTasks, "_id");
    }



    return {
        getLoadTaskMapByOrderId,
        getLoadTaskMap
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};
