module.exports = function (app) {
    router.post('/dashboard/equipment-in-yard/search-by-paging', async (ctx, next) => {
        ctx.body = await equipmentReportService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/dashboard/equipment-in-yard/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(equipmentReportService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/dashboard/empty-container-in-yard/search-by-paging', async (ctx, next) => {
        ctx.body = await emptyContainerInYardReportService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/dashboard/empty-container-in-yard/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(emptyContainerInYardReportService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/dashboard/task/unassigned/search-by-paging', async (ctx, next) => {
        ctx.body = await unassignedTaskService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/dashboard/task/unassigned/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(unassignedTaskService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/dashboard/task/in-progress/search-by-paging', async (ctx, next) => {
        ctx.body = await inProgressTaskService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/dashboard/task/in-progress/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(inProgressTaskService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });


    router.post('/dashboard/in-progress-loading/search-by-paging', async (ctx, next) => {
        ctx.body = await loadingReportService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/dashboard/in-progress-loading/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(loadingReportService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/dashboard/in-progress-offloading/search-by-paging', async (ctx, next) => {
        ctx.body = await offloadingReportService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/dashboard/in-progress-offloading/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(offloadingReportService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/dashboard/dock-door-status/search-by-paging', async (ctx, next) => {
        ctx.body = await dockDoorStatusService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/dashboard/dock-door-status/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(dockDoorStatusService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/dashboard/labor-assignment/search-by-paging', async (ctx, next) => {
        ctx.body = await laborAssignmentService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/dashboard/labor-assignment/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(laborAssignmentService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.post('/dashboard/driver-waiting-pool/search-by-paging', async (ctx, next) => {
        ctx.body = await driverWaitingPoolService(ctx).searchByPaging(ctx.request.body);
    });

    router.post('/dashboard/driver-waiting-pool/download', async (ctx, next) => {
        let reportData = await commonService(ctx).getAllPages(driverWaitingPoolService(ctx).searchByPaging, ctx.request.body);
        await app.downLoadJsonExcel(ctx, reportData.results);
    });

    router.get('/dashboard/conveyor/:lineId/picking-report', async (ctx, next) => {
        let lineId = ctx.params.lineId;
        if (!lineId) {
            throw new BadRequestError("LineId must not be null");
        }
        ctx.body = await conveyorPickingReportService(ctx).getReport(lineId);
    })
};
