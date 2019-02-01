
module.exports = function (app) {
    router.get('/download/:filename', async (ctx, next) => {
        //let fileName = "billing-inventory-report.csv";
        let fileName = ctx.params.filename;
        ctx.attachment(fileName);
        await koasend(ctx, fileName, { root: app.baseDir + "/files" });
    });

    router.post('/download/json-to-xlsx', async (ctx, next) => {
        let param = ctx.request.body;
        if (!param || !param.data) {
            throw new BadRequestError('Data must not be null.');
        }

        await app.downLoadJsonExcel(ctx, param);
    });

};