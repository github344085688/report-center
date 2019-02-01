module.exports = async (app) => {
    let sharedMySqlURI = {
        host: app.conf.get('mySqlURI.shared.host'),
        port: app.conf.get('mySqlURI.shared.port'),
        user: app.conf.get('mySqlURI.shared.user'),
        password: app.conf.get('mySqlURI.shared.password'),
        database: app.conf.get('mySqlURI.shared.database'),
        connectionLimit: app.conf.get('mySqlURI.shared.maxPoolSize')
    };
    let wmsMySqlURI = {
        host: app.conf.get('mySqlURI.wms.host'),
        port: app.conf.get('mySqlURI.wms.port'),
        user: app.conf.get('mySqlURI.wms.user'),
        password: app.conf.get('mySqlURI.wms.password'),
        database: app.conf.get('mySqlURI.wms.database'),
        connectionLimit: app.conf.get('mySqlURI.wms.maxPoolSize')
    };
    let sharedMongoURI = {
        url: app.conf.get('mongoURI.shared.url'),
        database: app.conf.get('mongoURI.shared.database'),
        maxPoolSize: app.conf.get('mongoURI.shared.maxPoolSize')
    };
    let wmsMongoURI = {
        url: app.conf.get('mongoURI.wms.url'),
        database: app.conf.get('mongoURI.wms.database'),
        maxPoolSize: app.conf.get('mongoURI.wms.maxPoolSize')
    };

    const dbUtil = require('./db/dbUtil.js')(app);
    global.wmsMysql = await dbUtil.buildMySql(wmsMySqlURI);
    global.sharedMySql = await dbUtil.buildMySql(sharedMySqlURI);
    global.wmsMongo = await dbUtil.buildMongoDB(wmsMongoURI);
    global.sharedMongo = await dbUtil.buildMongoDB(sharedMongoURI);
    require('./db/mongoCollectionInit.js')(app);
};