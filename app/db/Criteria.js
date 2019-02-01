'use strict';
const _ = require('lodash'),
    moment = require('moment');

module.exports = function (app) {

    class DBCriteria {
        constructor(criteria) {
            this.definition = {};
            this.criteria = criteria;
        }

        buildClause() {
            let clauses = [];
            for (let key of _.keys(this.criteria)) {
                let value = this.criteria[key];
                if (typeof(value) !== "number" && typeof (value) !== "boolean" && (!value || _.isEmpty(value))) {
                    continue;
                }

                let operator = this.definition[key];
                if (operator) {
                    if (operator.valueType === 'Date') {
                        value = _buildMySqlTime(value);
                    }

                    switch (operator.operator) {
                        case 'IN':
                            clauses.push(`${operator.column} IN (${_buildIN(value)})`);
                            break;
                        case 'NIN':
                            clauses.push(`${operator.column} NOT IN (${_buildIN(value)})`);
                            break;
                        case 'NOTNULL':
                            clauses.push(`${operator.column} IS NOT NULL`);
                            break;
                        default:
                            let valueStr = value;
                            if (operator.valueType !== 'Number') {
                                valueStr = `'${value}'`;
                            }
                            clauses.push(`${operator.column} ${operator.operator} ${valueStr}`)

                    }
                }


            }

            return _.isEmpty(clauses) ? "" : _.join(clauses, ' AND ');
        }
    }

    class MongoCriteria {
        constructor(criteria) {
            this.definition = {};
            this.criteria = criteria;
        }

        buildClause() {
            let clauses = {};

            for (let key of _.keys(this.criteria)) {
                let value = this.criteria[key];
                if (typeof(value) !== "number" && typeof (value) !== "boolean" && (!value || _.isEmpty(value))) {
                    continue;
                }

                let operator = this.definition[key];
                if (operator) {
                    if (operator.valueType === 'Date') {
                        value = new Date(_convertTimeZone(value));
                    }

                    switch (operator.operator) {
                        case '$in':
                            clauses[operator.field] ? (clauses[operator.field].$in = value) : (clauses[operator.field] = {$in: value});
                            break;
                        case '$nin':
                            clauses[operator.field] ? (clauses[operator.field].$nin = value) : (clauses[operator.field] = {$nin: value});
                            break;
                        case '$regex':
                            clauses[operator.field] ? (clauses[operator.field].$regex = value) : (clauses[operator.field] = {$regex: value});
                            break;
                        case '$lt':
                            clauses[operator.field] ? (clauses[operator.field].$lt = value) : (clauses[operator.field] = {$lt: value});
                            break;
                        case '$gt':
                            clauses[operator.field] ? (clauses[operator.field].$gt = value) : (clauses[operator.field] = {$gt: value});
                            break;
                        case '$gte':
                            clauses[operator.field] ? (clauses[operator.field].$gte = value) : (clauses[operator.field] = {$gte: value});
                            break;
                        case '$lte':
                            clauses[operator.field] ? (clauses[operator.field].$lte = value) : (clauses[operator.field] = {$lte: value});
                            break;
                        case '$ne':
                            clauses[operator.field] ? (clauses[operator.field].$ne = value) : (clauses[operator.field] = {$ne: value});
                            break;
                        case '$regex(multiFields)':
                            _buildRegexMultiFields(clauses, operator.field, value);
                            break;
                        case '$eq(ignoreCase)':
                            clauses[operator.field] ? (clauses[operator.field].$regex = value) : (clauses[operator.field] = {$regex: value});
                            clauses[operator.field].$options = "i";
                            break;
                        case "$eq":
                            clauses[operator.field] ? (clauses[operator.field].$eq = value) : (clauses[operator.field] = {$eq: value});
                            break;
                        case "$notnull":
                            !value || clauses[operator.field] ? (clauses[operator.field].$ne = null) : (clauses[operator.field] = {$ne: null});
                            break;
                        default:
                            ;
                    }
                }
            }

            return clauses;
        }
    }

    function _buildRegexMultiFields(clauses, field, value) {
        let fields = field.split(",");
        clauses.$or = clauses.$or || [];
        _.forEach(fields, fd => {
            let orClause = {};
            orClause[fd] = {$regex: value};
            clauses.$or.push(orClause);
        })
    }

    function _buildIN(values) {
        let valuesWithQuote = _.map(values, v => `'${v}'`);
        return _.join(valuesWithQuote, ',')
    }

    function _buildMySqlTime(isoTime) {
        return _.isArray(isoTime) ? _.map(isoTime, _convertTimeZone) : _convertTimeZone(isoTime);
    }

    function _convertTimeZone(isoTime) {
        if (typeof(isoTime) === "string") {
            return moment(isoTime).format();
        } else {
            return momentZone(isoTime).format();
        }
    }

    global.DBCriteria = DBCriteria;
    global.MongoCriteria = MongoCriteria;
};