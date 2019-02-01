const _ = require('lodash'),
    urlParser = require('url'),
    superagent = require('superagent'),
    caCerts = require('ssl-root-cas/latest').rootCas,
    crypto = require('crypto');

module.exports = async (app) => {
    let wiseBaseUrl = app.conf.get('targets.wise.baseUrl');
    let bamBaseUrl = app.conf.get('targets.bam.baseUrl');
    let fdAppBaseUrl = app.conf.get('targets.fdApp.baseUrl');
    let ymsAppBaseUrl = app.conf.get('targets.ymsApp.baseUrl');
    let wmsAppBaseUrl = app.conf.get('targets.wmsApp.baseUrl');
    let idmAppBaseUrl = app.conf.get('targets.idmApp.baseUrl');
    let baseAppBaseUrl = app.conf.get('targets.baseApp.baseUrl');
    let fileAppBaseUrl = app.conf.get('targets.fileApp.baseUrl');
    let printAppBaseUrl = app.conf.get('targets.printApp.baseUrl');

    global.wise = _buildUpstreamApp(wiseBaseUrl);
    global.bam = _buildUpstreamApp(bamBaseUrl);
    global.fdApp = _buildUpstreamApp(fdAppBaseUrl);
    global.ymsApp = _buildUpstreamApp(ymsAppBaseUrl);
    global.wmsApp = _buildUpstreamApp(wmsAppBaseUrl);
    global.idmApp = _buildUpstreamApp(idmAppBaseUrl);
    global.baseApp = _buildUpstreamApp(baseAppBaseUrl);
    global.fileApp = _buildUpstreamApp(fileAppBaseUrl);
    global.printApp = _buildUpstreamApp(printAppBaseUrl);

    app.getWiseAuthToken = async () => {
        let loginRes = await superagent.post(idmAppBaseUrl + '/user/login')
            .set('Content-Type', 'application/json;charset=UTF-8')
            .send({
                "username": app.appLogin.user,
                "password": app.appLogin.pwd,
                "returnUserPermissions": ["WEB"]
            });
        if (loginRes.status === 200) {
            return loginRes.body.oAuthToken;
        } else {
            console.log("Failed to get auth token!");
            return null;
        }
    };
    app.createCtx = async () => {
        let authToken = await app.getWiseAuthToken();

        let ctx = {
            request: {
                header: {
                    authorization: authToken,
                    "wise-company-id": "ORG-1",
                    "login-user-name": app.appLogin.user,
                },
                body: {}
            }
        };
        ctx.cached = {};
        _.map(app.cachedKeys, key => ctx.cached[key] = {});

        return ctx;
    };
    app.setCtxPaging = (ctx, paging) => {
        if (!paging) return;

        ctx = ctx || {};
        ctx.request = ctx.request || {};
        ctx.request.body = ctx.request.body || {};
        ctx.request.body.paging = paging;
    };

    function _buildUpstreamApp(baseUrl) {
        let upstreamApp = (ctx) => {
            // ctx is the koa context(See: http://koajs.com/#context)
            let httpClient = {};
            ['get', 'post', 'delete', 'put'].forEach((method) => {
                let methodFn = superagent[method];
                httpClient[method] = async function (url, data, fn) {
                    let requestUrl = baseUrl + url;
                    let responsePromise = methodFn.call(null, requestUrl, data, fn).ca(caCerts);
                    _setHeaders(responsePromise, ctx, data);
                    if (_.includes(requestUrl, '/yms/')) {
                        _useHmacAuthorization(responsePromise, urlParser.parse(requestUrl).pathname);
                    }

                    let response = await responsePromise;
                    return response.body;
                };
            });
            httpClient["download"] = async function (url, data, fn) {
                let methodFn = superagent['post'];
                let responsePromise = methodFn.call(null, baseUrl + url, data, fn)
                    .responseType('application/octet-stream')
                    .ca(caCerts);
                _setHeaders(responsePromise, ctx, data);
                let response = await responsePromise;
                return response.body;
            };

            httpClient.raw = () => {
                let rawHttpClient = {};
                ['get', 'post', 'delete', 'put'].forEach((method) => {
                    let methodFn = superagent[method];
                    rawHttpClient[method] = function (url, data, fn) {
                        let responsePromise = methodFn.call(null, baseUrl + url, data, fn).ca(caCerts);
                        _setHeaders(responsePromise, ctx, data);
                        return responsePromise;
                    };
                });

                return rawHttpClient;
            };

            return httpClient;
        };

        return upstreamApp;
    }

    function _setHeaders(responsePromise, ctx, reqData) {
        let [trace, oAuthToken, companyId, facilityId, loginUserName, xRequestID] = _extractTransmitHeaders(ctx);
        if (reqData && reqData.wiseCompanyId) {
            companyId = reqData.wiseCompanyId;
        }
        let headers = {
            "trace": trace,
            "Authorization": oAuthToken,
            "login-user-name": loginUserName,
            "X-Request-ID": xRequestID,
            "WISE-Company-Id": companyId,
            "WISE-Facility-Id": facilityId
        };

        for (let key of _.keys(headers)) {
            responsePromise.set(key, headers[key])
        }
    }

    function _useHmacAuthorization(responsePromise, path) {
        let timestamp = momentZone().format('YYYY-MM-DDTHH:mm:ss');
        responsePromise.set("timestamp", timestamp);

        let hmacProduct = app.conf.get('system.hmac.product');
        responsePromise.set("Authorization", `HMAC ${hmacProduct} ${_buildHmacHash(timestamp, path)}`);
    }

    function _buildHmacHash(timestamp, path) {
        let hmac = crypto.createHmac('sha256', app.conf.get('system.hmac.secret'));
        hmac.update(`${timestamp}:${path}`);
        return hmac.digest('base64');
    }

    function _extractTransmitHeaders(ctx) {
        if (!ctx.request) {
            return ['', '', '', '', '', ''];
        } else {
            return [
                _.get(ctx.request.header, "trace") || '',
                _.get(ctx.request.header, "authorization") || '',
                _.get(ctx.request.header, "wise-company-id") || '',
                _.get(ctx.request.header, "wise-facility-id") || '',
                _.get(ctx.request.header, "login-user-name") || '',
                _.get(ctx.request.header, "x-request-id") || ''
            ];
        }
    }
};