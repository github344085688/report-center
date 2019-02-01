const _ = require('lodash'),
    moment = require('moment-timezone'),
    fs = require('fs'),
    router = require('koa-router')(),
    koasend = require('koa-send'),
    nodemailer = require('nodemailer'),
    hash = require('object-hash');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

module.exports = (app) => {

    global._ = _;
    global.fs = fs;
    global.router = router;
    global.koasend = koasend;
    global.momentZone = function (time) {
        if (time) return moment(time).tz(app.systemConf.timezone);
        return moment().tz(app.systemConf.timezone);
    };

    class BadRequestError extends Error {
        constructor(message) {
            super(message);
            this.name = this.constructor.name;
            this.message = message;
            if (typeof Error.captureStackTrace === 'function') {
                Error.captureStackTrace(this, this.constructor);
            } else {
                this.stack = (new Error(message)).stack;
            }
        }
    }

    global.BadRequestError = BadRequestError;

    app.sendMail = async (subject, content, files, to, cc) => {
        let transporter = nodemailer.createTransport(app.mailConf);

        let attachments = null;
        if (files) {
            attachments = files.map((file) => {
                return {
                    filename: file.split("/").pop(),
                    content: fs.readFileSync(file)
                };
            });
        }

        let nevStr = _.upperFirst(_.split(app.conf.get('targets.idmApp.baseUrl'), '//')[1]);
        let nev = _.upperFirst(_.split(nevStr, '.')[0]);

        let options = {
            from: app.mailConf.auth.user,
            to: to,
            cc: cc,
            subject: subject,
            html: `${content}<br/>From: ${nev}, ${app.systemConf.company}, ${app.systemConf.facility}`,
            attachments: attachments
        };

        await transporter.sendMail(options);
    };

    app.splitDataToPaging = (paging, data, head) => {
        paging = paging || {};
        paging.pageNo = paging.pageNo || 1;
        paging.limit = paging.limit || 100;
        paging.totalCount = data.length;

        let fromIndex = (paging.pageNo - 1) * paging.limit;
        let toIndex = paging.pageNo * paging.limit > data.length ? data.length : paging.pageNo * paging.limit;
        paging.startIndex = fromIndex + 1;
        paging.endIndex = toIndex;

        return {
            results: {
                data: data.slice(fromIndex, toIndex),
                head: head,
            },
            paging: paging
        };
    };

    app.promisify = (func, thisArg) => {
        return (...args) => {
            return new Promise((resolve, reject) => {
                let callback = (...args) => {
                    let err = args[0];
                    if (err) {
                        reject(err)
                    } else {
                        resolve.apply(thisArg ? thisArg : null, _.tail(args))
                    }
                };

                args.push(callback);
                func.apply(thisArg ? thisArg : null, args)
            })
        }
    };

    app.waitBySeconds = (seconds) => {
        return new Promise((resolve, reject) => {
            setTimeout(resolve, seconds * 1000)
        });
    };

    app.util = {
        hash,
        ratainByKeys: (srcMap, retainedKeys) => {
            let retainedMap = {};
            for (let retainedkey of retainedKeys) {
                retainedMap[retainedkey] = srcMap[retainedkey];
            }

            return retainedMap;
        },

        getMapFromCache: async (cachedMap, keys, pullFunction) => {
            keys = _.compact(_.uniq(keys));
            let uncachedKeys = _.difference(keys, _.keys(cachedMap));
            if (!_.isEmpty(uncachedKeys)) {
                let newPulledMap = await pullFunction(uncachedKeys);
                _.assign(cachedMap, newPulledMap);
            }

            return app.util.ratainByKeys(cachedMap, keys);
        },

        unwind: function (objects, unwindBy, unwindToName) {
            let results = [];

            _.each(objects, obj => {
                let array = obj[unwindBy];
                delete obj[unwindBy];

                _.each(array, x => {
                    let target = {};
                    _.assign(target, obj);

                    if (_.isObject(x)) {
                        _.assign(target, x);
                    } else {
                        target[unwindToName] = x;
                    }
                    results.push(target);
                });

            });

            return results;
        }
    };

    _.mapUniq = (array, value) => _.compact(_.uniq(_.map(array, value)));

};
