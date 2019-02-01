let service = (app, ctx) => {

    async function getUserMapByCreatedByAndUpdatedBy(data) {
        if (!data || data.length === 0) return {};

        let createdBys = _.compact(_.uniq(_.map(data, "createdBy")));
        let updatedBys = _.compact(_.uniq(_.map(data, "updatedBy")));

        let userNames = _.uniq(_.union(createdBys, updatedBys));
        if (!userNames || userNames.length === 0) return {};

        return await getUserMapByUserName(userNames);
    }

    async function getUserMap(userIds) {
        userIds = Array.from(userIds);
        if (_.isEmpty(userIds)) return {};

        return (await idmApp(ctx).post("/user/search", {"idmUserIds": userIds})).reduce((map, obj) => {
            map[obj.idmUserId] = obj;
            return map;
        }, {});
    }

    async function getUserMapByUserName(userNames) {
        let users = await sharedMySql(ctx).query(`select username,firstName,lastName from idm_user where username in('${userNames.join("','")}')`);

        let userMap = {};
        _.forEach(users, user => {
            user.firstName = user.firstName ? user.firstName : "";
            user.lastName = user.lastName ? user.lastName : "";
            user.name = user.firstName + " " + user.lastName;
            userMap[user.username] = user;
        });
        return userMap;
    }

    async function fillTaskAssignee(task) {
        let assigneeUserIds = getAssigneeUserIdsByTasks([task]);
        let userMap = await getUserMap(assigneeUserIds);
        fillTaskAssigneeWithUserMap(task, userMap);
    }

    async function fillTasksAssignee(tasks) {
        let assigneeUserIds = getAssigneeUserIdsByTasks(tasks);
        let userMap = await getUserMap(assigneeUserIds);
        let len = tasks.length;
        for (let i = 0; i < len; i++) {
            let task = tasks[i];
            fillTaskAssigneeWithUserMap(task, userMap);
        }
    }

    function fillTaskAssigneeWithUserMap(task, userMap) {
        if (task.assigneeUserId) {
            task.assignee = userMap[task.assigneeUserId];
        }
        if (task.plannedAssigneeUserId) {
            task.plannedAssignee = userMap[task.plannedAssigneeUserId];
        }
        if (_.isEmpty(task.steps)) return;
        task.steps.forEach(step => {
            if (_.isNotEmpty(step.assigneeUserIds)) {
                let stepAssignees = [];
                step.assigneeUserIds.forEach(assigneeUserId => stepAssignees.push(userMap[assigneeUserId]));
                step.assignees = stepAssignees;
            }
        });
    }

    function getAssigneeUserIdsByTasks(tasks) {
        let assigneeUserIds = [];
        tasks.forEach(task => {
            if (task.assigneeUserId) {
                assigneeUserIds.push(task.assigneeUserId);
            }
            if (task.plannedAssigneeUserId) {
                assigneeUserIds.push(task.plannedAssigneeUserId);
            }
            assigneeUserIds = _.union(assigneeUserIds, _.flatMap(task.steps, "assigneeUserIds"));
        });
        return assigneeUserIds;
    }

    return {
        getUserMapByCreatedByAndUpdatedBy,
        getUserMap,
        getUserMapByUserName,
        fillTaskAssignee,
        fillTasksAssignee
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};