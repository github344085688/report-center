'use strict';

module.exports = function (app) {

    class DBOperator {
        constructor(operator, column, valueType) {
            this.operator = operator;
            this.column = column;
            this.valueType = valueType;
        }
    }

    class MongoOperator {
        constructor(operator, field, valueType) {
            this.operator = operator;
            this.field = field;
            this.valueType = valueType;
        }
    }

    global.DBOperator = DBOperator;
    global.MongoOperator = MongoOperator;
};