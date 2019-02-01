const os = require('os');
const XLSX = require('xlsx');

module.exports = (app) => {

    global.jsonCovertToXlsx = async function (json, fileName) {
        fileName = fileName || Math.floor(Math.random() * 10000);
        fileName = _.snakeCase(fileName);

        let time = momentZone().format('YYYY-MM-DD_HHmmssS');
        let tmppath = os.tmpdir();
        let name = `${fileName}_${time}.xlsx`;
        let filePath = `${tmppath}/${name}`;

        let realData = _getReportDataByHeader(json);
        let columnOrder = {header: json.head};
        let ws = XLSX.utils.json_to_sheet(realData, columnOrder);
        let wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "data");
        await app.promisify(XLSX.writeFileAsync)(filePath, wb);

        return {
            path: tmppath,
            filePath: filePath,
            fileName: name
        };
    };

    global.jsonCovertToXlsxMultiSheets = async function (jsonList, fileName) {
        fileName = fileName || Math.floor(Math.random() * 10000);
        fileName = _.replace(fileName, ".", "_");
        fileName = _.replace(fileName, "/", "_");
        fileName = _.replace(fileName, "\\", "_");

        let time = momentZone().format('YYYY-MM-DD_HHmmssS');
        let tmppath = os.tmpdir();
        let name = `${fileName}_${time}.xlsx`;
        let filePath = `${tmppath}/${name}`;

        let wb = XLSX.utils.book_new();
        _.each(jsonList, o => {
            let json = o.results;
            let realData = _getReportDataByHeader(json);
            let columnOrder = {header: json.head};
            let ws = XLSX.utils.json_to_sheet(realData, columnOrder);
            XLSX.utils.book_append_sheet(wb, ws, json.sheetName);
        });
        await app.promisify(XLSX.writeFileAsync)(filePath, wb);

        return {
            path: tmppath,
            filePath: filePath,
            fileName: name
        };
    };

    app.downLoadJsonExcel = async function (ctx, json, fileName) {
        let file = {};
        if (Array.isArray(json)) {
            file = await jsonCovertToXlsxMultiSheets(json, fileName)
        } else {
            file = await jsonCovertToXlsx(json, fileName);
        }
        ctx.attachment(file.fileName);
        await koasend(ctx, file.fileName, {root: file.path});
    };

    function _getReportDataByHeader(originalData) {
        let realData = [];
        if (_.isEmpty(originalData) || _.isEmpty(originalData.head) || _.isEmpty(originalData.data)) {
            return realData;
        }

        _.each(originalData.data, o => {
            let data = {};
            _.each(originalData.head, h => {
                if (o[h] !== undefined && o[h] !== null) {
                    data[h] = o[h]
                }
            });
            realData.push(data);
        });
        return realData;
    }
};