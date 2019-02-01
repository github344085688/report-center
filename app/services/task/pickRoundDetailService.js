const _ = require('lodash');
let service = (app, ctx) => {
    async function searchByPaging(criteria) {
        let head = [
            "Task #",
            "Round #",
            "Planned Weight/Qty",
            "Picked Weight/Qty",
            "Diff Weight/Qty"
        ];
        let shortHead = head;

        let taskSearch = new TaskSearch(criteria);
        let criteriaClause = taskSearch.buildClause();

        if (!criteriaClause.pickRounds) {
            criteriaClause.pickRounds = {$elemMatch: {$ne: null}};
        }


        let taskData = await pickTaskCollection(ctx).findByPaging(criteriaClause);
        if (!taskData.results || taskData.results.length === 0) {
            return {
                results: {
                    data: [],
                    head: head,
                    shortHead: shortHead
                },
                paging: taskData.paging
            }
        }

        let taskIds = _.map(taskData.results, "_id");
        let orderIds = _.uniq(_.flatMap(taskData.results, "orderIds"));
        let orderItemLines = await orderItemLineCollection(ctx).find({orderId: {$in: orderIds}}).toArray();
        let orderItemLineGroup = _.groupBy(orderItemLines, "orderId");
        let inventories = await wmsMysql(ctx).query(`select ${tabelFieldMap.inventoryFields} from inventory where pickRoundNo is not null and pickTaskId in('${taskIds.join("','")}')`);
        let inventoryTaskMap = _.groupBy(inventories, "pickTaskId");


        let data = [];

        _.forEach(taskData.results, function (task) {
            let totalPlanWeight = 0;
            let totalPlanQty = getOrdersQty(task.orderIds, orderItemLineGroup);
            let totalPickWeight = 0;
            let totalPickQty = 0;
            let totalDifWeight = 0;
            let roundNo = 0;
            _.forEach(task.pickRounds, function (pickRound) {
                roundNo++;
                let pickWeight = getInventoryWeight(task._id, roundNo, inventoryTaskMap);
                let pickQty = getInventoryQty(task._id, roundNo, inventoryTaskMap);
                let taskId = roundNo == 1 ? task._id : "";
                let planWeight = convertWeightToPound(pickRound.weight, pickRound.weightUnit);
                totalPlanWeight += planWeight;
                totalPickWeight += pickWeight;
                totalPickQty += pickQty;
                totalDifWeight += (planWeight - pickWeight);

                data.push({
                    "Task #": taskId,
                    "Round #": "Round " + roundNo,
                    "Planned Weight/Qty": planWeight,
                    "Picked Weight/Qty": pickWeight + "/" + pickQty,
                    "Diff Weight/Qty": (planWeight - pickWeight).toFixed(1)
                });
            })
            data.push({
                "Task #": "",
                "Round #": "Total",
                "Planned Weight/Qty": totalPlanWeight + "/" + totalPlanQty,
                "Picked Weight/Qty": totalPickWeight + "/" + totalPickQty,
                "Diff Weight/Qty": totalDifWeight.toFixed(1) + "/" + (totalPlanQty - totalPickQty)
            });

        })


        return {
            results: {
                data: data,
                head: head,
                shortHead: shortHead
            },
            paging: taskData.paging
        }
    };

    function getOrdersQty(orderIds, orderItemLineGroup) {
        let qty = 0;
        _.forEach(orderIds, function (orderId) {
            let orderItemLines = orderItemLineGroup[orderId];
            _.forEach(orderItemLines, function (orderItemLine) {
                if (orderItemLine.qty) {
                    qty += orderItemLine.qty;
                }

            })
        });

        return qty;
    }

    function convertWeightToPound(weight, weightUnit) {
        let KG_TO_POUND = 2.2046;
        let G_TO_POUND = 0.0022046;
        if (weightUnit === "KG") {
            weight = weight * KG_TO_POUND;
        }
        if (weightUnit === "G") {
            weight = weight * G_TO_POUND;
        }

        return weight;

    }

    function getInventoryWeight(taskId, roundNo, inventoryTaskMap) {
        let KG_TO_POUND = 2.2046;
        let G_TO_POUND = 0.0022046;

        let weight = 0;
        let inventories = inventoryTaskMap[taskId];
        _.forEach(inventories, function (inventory) {
            if (inventory.weight && inventory.pickRoundNo == roundNo) {
                let inventoryWeight = inventory.weight;
                if (inventory.weightUnit === "KG") {
                    inventoryWeight = weight * KG_TO_POUND;
                }
                if (inventory.weightUnit === "G") {
                    inventoryWeight = weight * G_TO_POUND;
                }
                weight += inventoryWeight;
            }
        })
        return weight;

    }

    function getInventoryQty(taskId, roundNo, inventoryTaskMap) {
        let qty = 0;
        let inventories = inventoryTaskMap[taskId];
        _.forEach(inventories, function (inventory) {
            if (inventory.qty && inventory.pickRoundNo == roundNo) {
                qty += inventory.qty;
            }
        });
        return qty;
    }


    class TaskSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                taskId: new MongoOperator('$eq', '_id'),
                orderIds: new MongoOperator('$in', 'orderIds')

            };
        }
    }

    return {
        searchByPaging
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};