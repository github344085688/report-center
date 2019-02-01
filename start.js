const cluster = require('cluster'),
    moment = require('moment'),
    app = require('./app/app.js');

app.logger.info("NODE_ENV: ", process.env.NODE_ENV);

let alphabet = "abcdefghijklmnopqrstuvwxyz".split(""),
    port = process.env.PORT || app.conf.get('server.port'),
    processNumber = app.conf.get('system.nodeProcessNumber');

if (cluster.isMaster && processNumber > 1) {
    for (let i = 0; i < processNumber; i++) {
        cluster.fork({workerId: alphabet[i]});
    }

    cluster.on('exit', function (worker) {
        let now = moment().format("YYYY-MM-DD H:m:s");
        app.logger.info(now.toString() + ' - [worker] ' + worker.process.pid + ' exit.');
    });
} else {
    let server = app.listen(port);

    // Node.js has a default socket timeout of 120s.
    // https://nodejs.org/api/http.html#http_server_settimeout_msecs_callback
    // Updated to 600 second to match nginx read timeout
    server.setTimeout(600 * 1000);
}