
let service = (app, ctx) => {
    async function getUserHoursByTask(tasks) {

    }

    return {
        getUserHoursByTask
    };
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};