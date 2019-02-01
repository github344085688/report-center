const ObjectID = require('mongodb-core').BSON.ObjectID;
const os = require('os');

/*
* {
*       reportService: "sendPackingListAfterDCService",
*       reportFunction: "sendPackingListToOperation",
*       reportServiceUrl: "/walnut/wms-app/inbound/receipt/export",
*       fileType: "xlsx",
*       isFileService: true,
*       isTxtService: true
* }
* */

let service = (app, ctx) => {
    let weekDay = {
        SUNDAY: 0,
        MONDAY: 1,
        TUESDAY: 2,
        WEDNESDAY: 3,
        THURSDAY: 4,
        FRIDAY: 5,
        SATURDAY: 6
    };

    function _isTimeToExecuteJob(conf) {
        if (!conf) return false;

        conf.scheduleDay = conf.scheduleDay || 1;
        conf.scheduleHour = conf.scheduleHour || 0;
        conf.scheduleMinute = conf.scheduleMinute || 0;

        let nextExecuteTime = null;
        if (conf.scheduleType === "EVERY_20_MINUTES") {
            nextExecuteTime = conf.lastExecuteTime ? momentZone(conf.lastExecuteTime).add(20, "minutes") : momentZone();

        } else if (conf.scheduleType === "EVERY_30_MINUTES") {
            nextExecuteTime = conf.lastExecuteTime ? momentZone(conf.lastExecuteTime).add(20, "minutes") : momentZone();

        } else if (conf.scheduleType === "HOURLY_REPORT") {
            nextExecuteTime = momentZone().minute(conf.scheduleMinute);

        } else if (conf.scheduleType === "DAILY_REPORT") {
            nextExecuteTime = momentZone().hour(conf.scheduleHour).minute(conf.scheduleMinute);
            if (conf.lastExecuteTime) {
                let date = nextExecuteTime.format('YYYY-MM-DD');
                let executeDate = momentZone(conf.lastExecuteTime).format('YYYY-MM-DD');
                if (date === executeDate) return false;
            }

        } else if (conf.scheduleType === "WEEKLY_REPORT") {
            let weekIndex = weekDay[conf.scheduleWeekDay] || 1;
            nextExecuteTime = momentZone().day(weekIndex).hour(conf.scheduleHour).minute(conf.scheduleMinute);

        } else if (conf.scheduleType === "MONTHLY_REPORT") {
            nextExecuteTime = momentZone().date(conf.scheduleDay).hour(conf.scheduleHour).minute(conf.scheduleMinute);

        } else if (conf.scheduleType === "BIMONTHLY_REPORT") {
            let nowDay = momentZone().date();
            if (nowDay === 1) {
                nextExecuteTime = momentZone().date(1).hour(0).minute(0);
            } else if (nowDay === 16) {
                nextExecuteTime = momentZone().date(16).hour(0).minute(0);
            }
        }

        let lastExecuteTime = conf.lastExecuteTime ? momentZone(conf.lastExecuteTime) : null;
        let timeNow = momentZone();

        if (nextExecuteTime > timeNow) {
            if (conf.scheduleType === "HOURLY_REPORT") {
                nextExecuteTime = nextExecuteTime.add(-1, 'hours');
                if (!lastExecuteTime) {
                    if (timeNow > nextExecuteTime) return true;
                }
                if (nextExecuteTime > lastExecuteTime) return true;
            }
            return false;
        }
        if (lastExecuteTime && nextExecuteTime <= lastExecuteTime) return false;

        return true;
    }

    async function _updateJobLastExecuteTime(conf) {
        await fdApp(ctx).put(`/report-config/execute/${conf._id}`);
    }

    async function _setJobErrorMesg(conf, error) {
        let errorMesg = `${error.message} ${error.stack}`;
        await fdApp(ctx).put(`/report-config/error/${conf._id}`, {errorMesg: errorMesg});
    }

    async function _pendingReport(conf) {
        await fdApp(ctx).put(`/report-config/pending/${conf._id}`);
    }

    function _getTimeSpan(param, conf) {
        let timeFrom = null;
        let endOfDay = " 00:00:00";
        if (conf.scheduleType === "DAILY_REPORT" && conf.endOfDay && conf.endOfDay > 0 && conf.endOfDay < 24) {
            endOfDay = ` ${_.padStart(conf.endOfDay, 2, "0")}:00:00`;
        }

        switch (conf.timeSpanOfData) {
            case "LAST_DAY":
                timeFrom = momentZone().add(-1, 'days').startOf('day').format('YYYY-MM-DD') + endOfDay;
                break;
            case "LAST_TWO_DAYS":
                timeFrom = momentZone().add(-2, 'days').startOf('day').format('YYYY-MM-DD') + endOfDay;
                break;
            case "LAST_THREE_DAYS":
                timeFrom = momentZone().add(-3, 'days').startOf('day').format('YYYY-MM-DD') + endOfDay;
                break;
            case "LAST_WEEK":
                timeFrom = momentZone().add(-7, 'days').startOf('day').format('YYYY-MM-DD') + endOfDay;
                break;
            case "LAST_HALF_MONTH":
                timeFrom = momentZone().add(-15, 'days').startOf('day').format('YYYY-MM-DD') + endOfDay;
                break;
            case "LAST_MONTH":
                timeFrom = momentZone().add(-30, 'days').startOf('day').format('YYYY-MM-DD') + endOfDay;
                break;
            case "LAST_THREE_MONTH":
                timeFrom = momentZone().add(-90, 'days').startOf('day').format('YYYY-MM-DD') + endOfDay;
                break;
            case "LAST_HALF_YEAR":
                timeFrom = momentZone().add(-180, 'days').startOf('day').format('YYYY-MM-DD') + endOfDay;
                break;
            case "LAST_YEAR":
                timeFrom = momentZone().add(-365, 'days').startOf('day').format('YYYY-MM-DD') + endOfDay;
                break;
        }
        let timeTo = momentZone().startOf('day').format('YYYY-MM-DD') + endOfDay;

        if (param.timeFrom) {
            timeFrom = param.timeFrom;
        }
        if (param.timeTo) {
            timeTo = param.timeTo;
        }
        if (conf.reportType === "INBOUND_SCHEDULE" || conf.reportType === "INBOUND_ALL") {
            param.createdTimeFrom = timeFrom;
            param.createdTimeTo = timeTo;
        } else if (conf.reportType === "INBOUND_FINISHED") {
            param.startTime = timeFrom;
            param.endTime = timeTo;
        } else if (conf.reportType === "OUTBOUND_SCHEDULE" || conf.reportType === "OUTBOUND_ALL") {
            param.createdTimeFrom = timeFrom;
            param.createdTimeTo = timeTo;
        } else if (conf.reportType === "OUTBOUND_FINISHED") {
            param.shippedTimeFrom = timeFrom;
            param.shippedTimeTo = timeTo;
        } else {
            param.timeFrom = timeFrom;
            param.timeTo = timeTo;
            param.startTime = timeFrom;
            param.endTime = timeTo;
        }
    }

    function _getReportParam(conf) {
        let param = {
            customerId: conf.customerId,
            reportType: conf.reportType,
            ftpHost: conf.ftpHost,
            ftpPort: conf.ftpPort || 21,
            ftpUser: conf.ftpUser,
            ftpPassword: conf.ftpPassword,
            ftpFilePath: conf.ftpFilePath
        };
        if (conf.reportParam) {
            let reportParam = JSON.parse(conf.reportParam);
            if (reportParam) {
                param = _.merge(param, reportParam);
            }
        }

        switch (conf.reportType) {
            case "INBOUND_SCHEDULE":
                param.receiptStatuses = param.receiptStatuses || ["IMPORTED","OPEN","APPOINTMENT_MADE"];
                break;
            case "INBOUND_FINISHED":
                param.receiptStatuses = param.receiptStatuses || ["CLOSED","FORCE_CLOSED","TASK_COMPLETED","EXCEPTION"];
                break;
            case "OUTBOUND_SCHEDULE":
                param.statuses = param.statuses || ["IMPORTED","OPEN","COMMITTED","PARTIAL_COMMITTED","COMMIT_BLOCKED",
                    "COMMIT_FAILED","PENDING","ON_HOLD","PLANNING","PLANNED","PICKING","PICKED","PACKING","PACKED",
                    "STAGED","LOADING","LOADED","REOPEN","CANCELLED"];
                break;
            case "OUTBOUND_FINISHED":
                param.statuses = param.statuses || ["PARTIAL_SHIPPED","SHORT_SHIPPED","SHIPPED","CLOSED"];
                break;
        }

        _getTimeSpan(param, conf);

        return param;
    }
    
    async function _downLoadFileFromUrl(param, conf) {
        if (!param.fileType) {
            throw new BadRequestError("fileType of Report Param must not be null.");
        }

        let fileName = conf.reportTitle || conf.reportType;
        fileName = _.snakeCase(fileName);

        let time = momentZone().format('YYYY-MM-DD_HHmmssS');
        let tmppath = os.tmpdir();
        let name = `${fileName}_${time}.${param.fileType}`;
        let filePath = `${tmppath}/${name}`;

        let stream = fs.createWriteStream(filePath);

        await new Promise((resolve, reject) => {
            wise(ctx).raw().post(param.reportServiceUrl, param).pipe(stream).on('close', resolve);
        });

        return {
            path: tmppath,
            filePath: filePath,
            fileName: name
        };

    }

    async function _triggerReportJob(service, param) {
        if (param.reportServiceUrl) {
            await wise(ctx).post(param.reportServiceUrl, param);

        } else {
            await service(param);
        }
    }

    async function getReportResult(service, param, conf) {
        let reportTitle = conf.reportTitle || conf.reportType;
        let reportBody = conf.reportBody || "";

        if (param.justTriggerJob) {
            param.reportTitle = reportTitle;
            param.reportBody = reportBody;
            param.consigneeTo = conf.consigneeTo;
            param.consigneeCC = conf.consigneeCC;
            _triggerReportJob(service, param);
            return;
        }

        let files = [];
        if (param.reportServiceUrl) {
            if (param.isTxtService) {
                let res = await wise(ctx).post(param.reportServiceUrl, param);
                reportBody += "<br/>" + (res ? (res.reportBody || res || "") : "");

            } else {
                let file = await _downLoadFileFromUrl(param, conf);
                files.push(file);
            }

        } else if (param.isFileService) {
            let res = await service(param);
            if (!res) {
                throw new BadRequestError("Not data return.");
            }

            if (res.filePath) {
                files.push(res);
            } else if (res.files) {
                if (_.isEmpty(res.files)) {
                    throw new BadRequestError("Not file return.");
                }
                files = res.files;
            } else if (res.length > 0) {
                files = res;
            }
            if (res.reportBody) {
                reportBody += "<br/>" + res.reportBody;
            }

        } else if (param.isTxtService) {
            let res = await service(param);
            reportBody += "<br/>" + (res ? (res.reportBody || res || "") : "");

        } else {
            let report = await commonService(ctx).getAllPages(service, param);
            let file = await jsonCovertToXlsx(report.results, reportTitle);
            files.push(file);
        }

        return {
            reportBody,
            files
        }
    }

    async function _sendReportEmail(service, conf) {
        let param = _getReportParam(conf);
        let result = await getReportResult(service, param, conf);
        if (param.justTriggerJob) return;

        if (conf.reportMedia === "FTP") {
            let ftpClient = await app.FtpUtil.connect({
                host: conf.ftpHost,
                port: conf.ftpPort || 21,
                user: conf.ftpUser,
                password: conf.ftpPassword
            });
            for (let file of result.files) {
                await app.FtpUtil.upload(ftpClient, file.filePath, conf.ftpFilePath + "/" + file.fileName);
            }
            await app.FtpUtil.end(ftpClient);

        } else {
            let files = _.isEmpty(result.files) ? [] : _.map(result.files, "filePath");
            let reportBody = result.reportBody;
            let reportTitle = conf.reportTitle || conf.reportType;
            reportTitle += " (" + momentZone().format('YYYY-MM-DD') + ")";
            app.sendMail(reportTitle, reportBody, files, conf.consigneeTo, conf.consigneeCC);
        }
    }

    function _getReportService(conf) {
        switch (conf.reportType) {
            case "INVENTORY_BALANCE":
                return inventoryBalanceReportService(ctx).searchByPaging;
            case "INVENTORY":
                return inventoryStatusReportService(ctx).searchByPaging;
            case "INVENTORY_SUMMARY":
                return inventorySummaryReport(ctx).searchByPaging;
            case "INBOUND_SCHEDULE":
                return inboundReportService(ctx).searchByPagingForReceiptLevel;
            case "INBOUND_FINISHED":
                return inboundReportService(ctx).searchByPagingForItemLevel;
            case "INBOUND_ALL":
                return inboundReportService(ctx).searchByPagingForItemLevel;
            case "OUTBOUND_SCHEDULE":
                return outboundScheduleReportService(ctx).orderLevelSearchByPaging;
            case "OUTBOUND_FINISHED":
                return outboundShippingReportService(ctx).itemlineLevelSearchByPaging;
            case "OUTBOUND_ALL":
                return outboundShippingReportService(ctx).itemlineLevelSearchByPaging;
            case "OTHER_REPORT":
                let param = _getReportParam(conf);
                if (!param.reportService || !param.reportFunction) return;
                let reportService = global[param.reportService];
                if (!reportService(ctx)[param.reportFunction]) return;

                return reportService(ctx)[param.reportFunction];
            case "INVENTORY_TURNS":
                return inventoryTurnsReportService(ctx).searchByPaging;
        }
    }

    async function _sendReport(conf) {
        try {
            if (conf.reportMedia !== "FTP" && !conf.consigneeTo) return;

            await _pendingReport(conf);
            let reportService = _getReportService(conf);
            if (conf.reportLevel === "FACILITY_LEVEL") {
                let reportParam = _getReportParam(conf);
                await scheduleFacilityReport(ctx).sendReport(conf, reportService, reportParam);
            } else {
                if (!conf.customerId) return;
                await _sendReportEmail(reportService, conf);
            }
            await _updateJobLastExecuteTime(conf);

        } catch (e) {
            app.logger.info(conf);
            app.logger.info(e);
            await _setJobErrorMesg(conf, e);
        }
    }

    async function jobExecute() {
        let reportConfigs = await reportConfigCollection(ctx).query({status: "ENABLE"});
        if (!reportConfigs || reportConfigs.length === 0) return;

        let configuration = await configurationCollection(ctx).findOne({propertyGroup: "Facility"});
        if (!configuration) return;
        let facilityId = configuration.propertyValue;

        await Promise.all(_.map(reportConfigs, conf => {
            if (!_isTimeToExecuteJob(conf)) return;
            if (conf.facilityId !== facilityId) return;
            _sendReport(conf);
        }));
    }

    async function _getReportConfig(param) {
        let configuration = await configurationCollection(ctx).findOne({propertyGroup: "Facility"});
        if (!configuration) {
            throw new BadRequestError("Please set up a facility in configuration mongo!");
        }
        let facilityId = configuration.propertyValue;

        let conf = await reportConfigCollection(ctx).findOne({
            _id: new ObjectID(param.confId),
            status: "ENABLE",
            customerId: param.customerId,
            reportType: param.reportType,
            facilityId: facilityId
        });
        if (!conf) {
            throw new BadRequestError("This customer no set a report configuration or the config is not available!");
        }
        return conf;
    }

    async function sendReport(param) {
        let conf = await _getReportConfig(param);
        await _sendReport(conf);
    }

    async function downloadReport(param) {
        let conf = await _getReportConfig(param);
        let reportService = _getReportService(conf);
        let reportParam = _getReportParam(conf);

        if (conf.reportLevel === "FACILITY_LEVEL") {
            await scheduleFacilityReport(ctx).downloadReport(conf, reportService, reportParam);
            return;
        }
        let report = await commonService(ctx).getAllPages(reportService, reportParam);
        await app.downLoadJsonExcel(ctx, report.results);
    }

    return {
        jobExecute,
        sendReport,
        downloadReport,
        getReportResult
    };
}

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};