const koa = require('koa');

let app = new koa();

require('./conf.js')(app);
require('./logger.js')(app);
require('./db.js')(app);
require('./httpClient.js')(app);
require('./common')(app);
require('./services')(app);
require('./routes')(app);
require('./db/Criteria')(app);
require('./db/Operator')(app);
require('./job/scheduleJob.js')(app);

app.use(router.routes());

app.on('error', (err, ctx) => {
    let requestMethod = ctx && ctx.request && ctx.request.method ? ctx.request.method : "";
    let requestUrl = ctx && ctx.request && ctx.request.url ? ctx.request.url : "";
    let requestId = _.get(ctx.request.header, "x-request-id") || "";
    let errorMsg = `${requestUrl} ${requestMethod} x-request-id:${requestId}`;

    if (err.response && err.response.error) {
        app.logger.error(errorMsg, err.response.error, _extractRequestDetail(ctx));
    } else {
        app.logger.error(errorMsg, err.stack || err, _extractRequestDetail(ctx));
    }
});

function _extractRequestDetail(ctx) {
    if (!ctx || !ctx.request) return "";

    let reqDetail = {};
    reqDetail.requestUrl = ctx.request.url;
    reqDetail.method = ctx.request.method;
    reqDetail.headers = ctx.request.headers;
    reqDetail.body = ctx.request.body;
    return JSON.stringify(reqDetail, null, 2)
}

module.exports = app;
