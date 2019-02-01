const schedule = require("node-schedule");

module.exports = (app) => {

    // 每分钟的第30秒触发： '30 * * * * *'
    // 每小时的1分30秒触发：'30 1 * * * *'
    // 每天的凌晨1点1分30秒触发：'30 1 1 * * *'
    // 每月的1日1点1分30秒触发：'30 1 1 1 * *'
    // 2016年的1月1日1点1分30秒触发：'30 1 1 1 2016 *'
    // 每周1的1点1分30秒触发：'30 1 1 * * 1'

    schedule.scheduleJob("0 10 0 * * *", async () => {
        app.logger.info("Execute a cron job every day");
        let ctx = await app.createCtx();
        await billingService(ctx).sendReport();
        app.logger.info(new Date());
    });

    schedule.scheduleJob("0 0 12 * * *", async () => {
        app.logger.info("Execute a cron job every day");
        let ctx = await app.createCtx();
        await billingService(ctx).sendReport();
        app.logger.info(new Date());
    });

    schedule.scheduleJob("0 50 23 * * *", async () => {
        app.logger.info("Execute a cron job every day");
        let ctx = await app.createCtx();
        await syncItemUnitService(ctx).syncItemUnitFromMongoToMysql();
        app.logger.info(new Date());
    });

    schedule.scheduleJob("00 50 23 * * *", async () => {
        let ctx = await app.createCtx();
        let configurations = await configurationCollection(ctx).find({propertyGroup: "BillingConfiguration"}).toArray();
        let conf = _.find(configurations, conf => conf.propertyName === "ExecuteJob");
        let execute = conf ? conf.propertyValue : null;
        if (execute) {
            app.logger.info("Execute a cron job every day");
            await billingSyncDataService(ctx).syncFacilities();
            await billingSyncDataService(ctx).syncCustomers();
            await billingSyncDataService(ctx).syncMaterials();
            app.logger.info(new Date());
        }
    });

    let hourRule = new schedule.RecurrenceRule();
    hourRule.minute = 0;
    schedule.scheduleJob(hourRule, async () => {
        app.logger.info("Execute a cron job every hour");
        let ctx = await app.createCtx();
        await transferTypeFromCrossDockService(ctx).transferTypeFromCrossDock();
        app.logger.info(new Date());
    });

    schedule.scheduleJob("*/10 * * * *", async () => {
        app.logger.info("Execute a cron job every 10 minutes");
        let ctx = await app.createCtx();
        await scheduleService(ctx).jobExecute();
        app.logger.info(new Date());
    });

    schedule.scheduleJob("*/10 * * * *", async () => {
        let ctx = await app.createCtx();
        let configurations = await configurationCollection(ctx).find({propertyGroup: "BillingConfiguration"}).toArray();
        let conf = _.find(configurations, conf => conf.propertyName === "ExecuteJob");
        let execute = conf ? conf.propertyValue : null;
        if (execute) {
            app.logger.info("Execute a cron job every 10 minutes");
            let ctx = await app.createCtx();
            await billingSyncDataService(ctx).syncItems();
            app.logger.info(new Date());
        }
    });

};
