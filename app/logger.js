const path = require('path'),
    winston = require('winston');

module.exports = (app) => {
    let transports = [];
    transports.push(new (winston.transports.Console)({
        colorize: true,
        level: 'info',
        prettyPrint: _jsonPrettyPrint
    }));

    let workerIdSuffix = process.env.workerId ? ("." + process.env.workerId) : "";
    transports.push(new (winston.transports.File)({
        filename: path.join(app.conf.get('log.path'), 'server.log' + workerIdSuffix),
        json: false,
        level: 'info',
        prettyPrint: _jsonPrettyPrint
    }));

    app.logger = new (winston.Logger)({
        transports: transports,
        exceptionHandlers: [
            new (winston.transports.File)({
                filename: path.join(app.conf.get('log.path'), 'error.log' + workerIdSuffix),
                json: false,
                prettyPrint: _jsonPrettyPrint
            }),
            new (winston.transports.Console)({
                colorize: true,
                prettyPrint: _jsonPrettyPrint
            })
        ]
    });

    let accessLogger = new (winston.Logger)({
        transports: [new (winston.transports.File)({
            filename: path.join(app.conf.get('log.path'), 'access.log'),
            json: false,
            level: 'info',
            formatter: (options) => options.message
        })]

    });

    app.accessLogger = {
        log: function () {
            this.request._endTime = this.request._endTime || new Date;

            let request = this.request,
                response = this.response,
                elapsed = request._endTime - request._startTime,
                startTime = momentZone(request._startTime).format('DD/MMM/YYYY HH:mm:ss ZZ'),
                instanceId = process.env.workerId ? `instance.${process.env.workerId}` : '';

            accessLogger.info(`"${request.ip}" [${startTime}] "${request.method} ${request.url}" "${request.header['user-agent']}" ${response.status} ${elapsed}ms "${instanceId}"`);
        }
    };

    app.use(async (ctx, next) => {
        ctx.request._startTime = new Date();
        await next();
        ctx.request._endTime = new Date();
        app.accessLogger.log.call(ctx);
    });

    app.use(async (ctx, next) => {
        try {
            await next();
        } catch (err) {
            if (err instanceof BadRequestError) {
                _handleBadRequestError(ctx, err)
            } else {
                _handleError(ctx, err);
            }
            ctx.app.emit('error', err, ctx);
        }
    });

    app.cachedKeys = [
        "hashMap",
        "receiptMap",
        "orderMap",
        "orgBasicMap",
        "orgMap",
        "carrierMap",
        "customerMap",
        "receiptDynTxtPropertyMap",
        "itemSpecMap",
        "unitMap",
        "csUnitMap",
        "lpMap",
        "receiptEquipmentInfoMap",
        "qtyPerPalletMap",
        "loadTaskMap",
        "loadMap",
        "entryCarrierMapByLoad",
        "receivedSNMap",
        "receivedDamagedMap",
        "equipmentInfoMap",
        "trackingNoMap",
        "incommingItemQtyMap",
        "openOrderItemQtyMap",
        "unitPerPkgMap",
        "statusReportItemSnMap",
        "itemDynTxtPropertyGroup"
    ];

    app.use(async (ctx, next) => {
        // request level cache
        ctx.cached = {};
        _.map(app.cachedKeys, key => ctx.cached[key] = {});
        await next();
    });
};

function _handleBadRequestError(context, err) {
    context.status = 400;
    context.body = {
        error: err.message
    }
}

function _handleError(context, err) {
    context.status = err.status || 500;

    if (err.response && err.response.body && err.response.body.error) {
        context.body = err.response.body;
    } else {
        let cause = err.response && err.response.error ? err.response.error : err;
        context.body = {
            error: cause.message,
            stack: cause.stack ? cause.stack : cause
        };
    }
}

function _jsonPrettyPrint(obj) {
    return JSON.stringify(obj);
}