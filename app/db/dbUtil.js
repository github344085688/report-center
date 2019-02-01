const _ = require('lodash');
const mongo = require('mongodb');
const MongoClient = mongo.MongoClient;
const mysql = require('promise-mysql');


module.exports = (app) => {
    async function buildMongoDB(connectOptions) {
        try {
            let connection = await MongoClient.connect(connectOptions.url, {poolSize: connectOptions.maxPoolSize});
            let mongoDB = connection.db(connectOptions.database);

            mongoDB.rawCollection = mongoDB.collection;
            mongoDB.collection = (collectionName, options) => {
                return (ctx) => {
                    let mongoCollection = mongoDB.rawCollection(collectionName, options);

                    mongoCollection.query = async (query, queryOptions) => {
                        let totalCount = await mongoCollection.count(query);
                        let limit = 1000;
                        let pageCount = parseInt((totalCount / limit).toFixed(0)) + (totalCount % limit > 0 ? 1 : 0);
                        let results = [];
                        for (let i = 0; i < pageCount; i++) {
                            queryOptions = queryOptions || {};
                            queryOptions.skip = limit * i;
                            queryOptions.limit = limit;

                            let res = await mongoCollection.find(query, queryOptions).toArray();
                            results = _.union(results, res);
                        }
                        return results;
                    };

                    // find by paging
                    mongoCollection.findByPaging = async (query, queryOptions) => {
                        if ((!queryOptions || !queryOptions.skip) && (!ctx.request || !ctx.request.body || !ctx.request.body.paging)) {
                            ctx.request.body.paging = {"pageNo": 1, "limit": 10000};
                        }

                        let paging = ctx.request.body.paging;
                        if (!queryOptions || !queryOptions.skip) {
                            queryOptions = queryOptions || {};
                            queryOptions.skip = paging.limit * (paging.pageNo - 1);
                            queryOptions.limit = paging.limit;
                        }

                        let [totalCount, results] = await Promise.all([
                            mongoCollection.count(query),
                            mongoCollection.find(query, queryOptions).toArray()
                        ]);
                        return {
                            results,
                            paging: _buildPagingResponse(paging, totalCount)
                        }
                    };

                    // aggregate by paging
                    let rawAggregate = mongoCollection.aggregate;
                    mongoCollection.aggregate = app.promisify(rawAggregate, mongoCollection);

                    mongoCollection.aggregateByPaging = async (pipelines, queryOptions) => {
                        if ((!queryOptions || !queryOptions.skip) && (!ctx.request || !ctx.request.body || !ctx.request.body.paging)) {
                            ctx.request.body.paging = {"pageNo": 1, "limit": 10000};
                        }

                        let countPipelines = _buildAggregateCountPipelines(pipelines);

                        let paging = ctx.request.body.paging;
                        pipelines.push({$skip: paging.limit * (paging.pageNo - 1)});
                        pipelines.push({$limit: paging.limit});
                        let [totalCountPromise, resultsPromise] = await Promise.all([
                            mongoCollection.aggregate(countPipelines),
                            mongoCollection.aggregate(pipelines)
                        ]);

                        let [totalCount, results] = await Promise.all([
                            app.promisify(totalCountPromise.toArray, totalCountPromise)(),
                            app.promisify(resultsPromise.toArray, resultsPromise)()
                        ]);

                        return {
                            results,
                            paging: _buildPagingResponse(paging, _.isEmpty(totalCount) ? 0 : totalCount[0].count)
                        }

                    };

                    return mongoCollection;
                }
            };

            return mongoDB;
        } catch (err) {
            app.logger.error("error happen while init mongodb", err.stack || err);
            return null;
        }
    }

    function _buildAggregateCountPipelines(pipelines) {
        let countPipelines = [];
        _.each(pipelines, pipeline => countPipelines.push(pipeline));
        countPipelines.push({$count: "count"});
        return countPipelines;
    }

    async function buildMySql(connectOptions) {
        let pool = mysql.createPool(connectOptions);

        return (ctx) => {
            pool.count = async (sql) => {
                sql = _.replace(sql, /\r?\n|\r/g, '');
                let countSql = _.replace(sql, /^SELECT.*?FROM/, 'SELECT 1 FROM');
                countSql = `SELECT count(*) as total FROM (${countSql}) t`;
                return pool.query(countSql);
            };

            // Add paging support
            pool.queryByPaging = async (sql) => {
                if (!_.get(ctx.request.body, "paging")) {
                    ctx.request.body.paging = {"pageNo": 1, "limit": 10000};
                }

                let paging = ctx.request.body.paging;
                let skip = paging.limit * (paging.pageNo - 1);
                let limit = paging.limit;

                let [totalCount, results] = await Promise.all([
                    pool.count(sql),
                    pool.query(`${sql} limit ${skip},${limit}`)
                ]);

                return {
                    results,
                    paging: _buildPagingResponse(paging, totalCount[0]["total"])
                }
            };

            pool.selectAll = async (sql) => {
                let totalCount = await pool.count(sql);
                totalCount = totalCount[0]["total"];

                let limit = 1000;
                let pageCount = parseInt((totalCount / limit).toFixed(0)) + (totalCount % limit > 0 ? 1 : 0);

                let results = [];
                for (let i = 0; i < pageCount; i++) {
                    let skip = limit * i;
                    let res = await pool.query(`${sql} limit ${skip},${limit}`);
                    results = _.union(results, res);
                }
                return results;
            };

            return pool;
        }
    }

    function _buildPagingResponse(pagingRequest, totalCount) {
        let totalPage = totalCount / pagingRequest.limit;
        if (totalCount % pagingRequest.limit > 0) {
            totalPage = totalPage + 1;
        }
        let startIndex = (pagingRequest.pageNo - 1) * pagingRequest.limit;

        return {
            totalCount: totalCount,
            pageNo: pagingRequest.pageNo,
            totalPage: Math.floor(totalPage),
            startIndex: startIndex + 1,
            endIndex: _.min([startIndex + pagingRequest.limit, totalCount]),
            limit: pagingRequest.limit
        }
    }

    return {
        buildMongoDB,
        buildMySql
    };
};
