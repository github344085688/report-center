const fs = require('fs'),
    path = require('path'),
    bodyParser = require('koa-bodyparser')();

module.exports = (app) => {
    app.use(bodyParser);
    app.use(async (ctx, next) => {
        ctx.response.set({
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache'
        });
        await next();
    });

    router.get('/health-check', async (ctx, next) => {
        ctx.body = '';
    });

    (function _loadRoutes(dirname) {
        fs.readdirSync(dirname).forEach(function (file) {
            let filePath = path.join(dirname, file);

            if (fs.statSync(filePath).isDirectory()) {
                _loadRoutes(filePath);
            } else {
                _loadRouteFile(filePath);
            }
        });

        function _loadRouteFile(filePath) {
            if (!filePath.endsWith("index.js") && path.extname(filePath) === '.js') {
                try {
                    require(filePath)(app);
                    app.logger.info('loaded route from ' + filePath);

                } catch (err) {
                    app.logger.error('Error loading route from ' + filePath, err);
                }
            }
        }
    })(__dirname);

};