const os = require('os'),
    packer = require('zip-stream'),
    fs = require('fs');

let service = (app, ctx) => {

    async function _creteCustomerFile(conf, reportService, reportParam, customer, archive) {
        let paramCopy = _.cloneDeep(reportParam);
        paramCopy.customerId = customer._id;

        let confCopy = _.cloneDeep(conf);
        confCopy.reportTitle = customer.name + " " + (confCopy.reportTitle || "");
        let result = await scheduleService(ctx).getReportResult(reportService, paramCopy, confCopy);
        if (!result) return;

        var date = new Date();
        _.forEach(result.files, file => {
            archive.entry(fs.createReadStream(file.filePath), {name: file.fileName, date: date, store: true});
        })
    }

    async function _getReportData(conf, reportService, reportParam) {
        let customers = await customerCollection(ctx).find({activatedFacilityIds: conf.facilityId}, {projection:{orgId: 1}}).toArray();
        let customerIds = _.map(customers, "orgId");
        customers = await organizationCollection(ctx).find({_id: {$in: customerIds}}).toArray();
        reportParam = reportParam || {};

        let configuration = await configurationCollection(ctx).findOne({propertyGroup: "Facility"});
        let time = momentZone().format('YYYY-MM-DD_HHmmssS');
        let tmppath = os.tmpdir();
        let name = `${configuration.propertyName}_${conf.reportType}_${time}.zip`;
        let filePath = `${tmppath}/${name}`;

        let archive = new packer();
        archive.pipe(fs.createWriteStream(filePath));

        for (let customer of customers) {
            await _creteCustomerFile(conf, reportService, reportParam, customer, archive);
        }
        archive.finalize();
        await app.waitBySeconds(0.5);

        return {
            path: tmppath,
            filePath: filePath,
            fileName: name
        };
    }

    async function sendReport(conf, reportService, reportParam) {
        let file = await _getReportData(conf, reportService, reportParam);
        if (reportParam.justTriggerJob) return;

        if (conf.reportMedia === "FTP") {
            let ftpClient = await app.FtpUtil.connect({
                host: conf.ftpHost,
                port: conf.ftpPort || 21,
                user: conf.ftpUser,
                password: conf.ftpPassword
            });
            await app.FtpUtil.upload(ftpClient, file.filePath, conf.ftpFilePath + "/" + file.fileName);
            await app.FtpUtil.end(ftpClient);

        } else {
            let reportTitle = conf.reportTitle || conf.reportType;
            reportTitle += "_" + momentZone().format('YYYY-MM-DD');
            let reportBody = conf.reportBody || "";
            let consigneeTo = conf.consigneeTo;
            let consigneeCC = conf.consigneeCC;

            app.sendMail(reportTitle, reportBody, [file.filePath], consigneeTo, consigneeCC);
        }
    }

    async function downloadReport(conf, reportService, reportParam) {
        let file = await _getReportData(conf, reportService, reportParam);
        ctx.attachment(file.fileName);
        await koasend(ctx, file.fileName, {root: file.path});
    }

    return {
        sendReport,
        downloadReport
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};