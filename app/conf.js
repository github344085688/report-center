const fs = require('fs'),
    config = require('config'),
    path = require('path'),
    caCerts = require('ssl-root-cas/latest').rootCas;

module.exports = async (app) => {
    app.conf = config;
    caCerts.push(fs.readFileSync(path.resolve(__dirname, '../app/cacert/AlphaSSLCA.cer')));

    app.baseDir = path.resolve(__dirname, '../app/');
    app.systemConf = {
        company: app.conf.get('system.company'),
        facility: app.conf.get('system.facility'),
        timezone: app.conf.get('system.timezone'),
    };

    app.mailConf = {
        host: app.conf.get('mail.host'),
        port: app.conf.get('mail.port'),
        secure: app.conf.get('mail.secure'),
        ignoreTLS: app.conf.get('mail.ignoreTLS'),
        auth: {
            user: app.conf.get('mail.user'),
            pass: app.conf.get('mail.pass')
        }
    };

    app.appLogin = {
        user: app.conf.get('system.appLoginUser'),
        pwd: app.conf.get('system.appLoginPwd')
    };

    app.defaultValues = {
        containerSize: "40'",  // 20,40,45,53,other size
        trailerSize: "48'",    // 48,53,other size
        volumeUOM: "cubic footage",
        areaUOM: "square footage",
        weightUOM: "pound",
        palletSize: "other size",
        palletQtyPercent: 0.5
    };

    app.enumFieldMap = null;
};