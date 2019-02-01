const fs = require('fs'),
    path = require('path');

module.exports = (app) => {

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
                try {
                    require(filePath)(app);
                    app.logger.info('loaded service: ' + filePath);

                } catch (err) {
                    app.logger.error('Error loading service: ' + filePath, err);
                    process.exit(1);
                }

            }
        }
    })(__dirname);

};
