const ftp = require('ftp'),
    fs = require('fs');

module.exports = (app) => {
    app.FtpUtil = {
        connect: async function (connection) {
            let ftpClient = new ftp();
            ftpClient.connect({
                host: connection.host,
                port: connection.port,
                user: connection.user,
                password: connection.password
            });

            await app.promisify(ftpClient.on, ftpClient)('ready');
            return ftpClient;
        },
        list: async function (ftpClient, path) {
            return await app.promisify(ftpClient.list, ftpClient)(path)
        },
        download: async function (ftpClient, src, dest) {
            let stream = await app.promisify(ftpClient.get, ftpClient)(src);
            stream.pipe(fs.createWriteStream(dest));
            await app.promisify(stream.once, stream)('close');
        },
        upload: async function (ftpClient, input, dest) {
            let path = dest.substr(0,dest.lastIndexOf('/')+1);
            await app.promisify(ftpClient.mkdir, ftpClient)(path, true);
            await app.promisify(ftpClient.put, ftpClient)(input, dest);
        },
        rename: (ftpClient, oldPath, newPath) => {
            return app.promisify(ftpClient.rename, ftpClient)(oldPath, newPath)
        },
        end: async function (ftpClient) {
            await ftpClient.end()
        }
    };
};