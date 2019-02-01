const fs = require('fs'),
    path = require('path');

module.exports = (app) => {
    app.services = app.services || {};

    (function _loadServiceDir(dirname) {
        fs.readdirSync(dirname).forEach(function (file) {
            let filePath = path.join(dirname, file);

            if (fs.statSync(filePath).isDirectory()) {
                _loadServiceDir(filePath);
            } else {
                _loadServiceFile(filePath);
            }
        });

        function _loadServiceFile(filePath) {
            if (!filePath.endsWith("index.js") && path.extname(filePath) === '.js') {
                let serviceName = path.basename(filePath, '.js');
                try {
                    global[serviceName] = require(filePath)(app);
                    app.logger.info('loaded service: ' + filePath);

                } catch (err) {
                    app.logger.error('Error loading service: ' + filePath, err);
                    process.exit(1);
                }

            }
        }
    })(__dirname);

};
