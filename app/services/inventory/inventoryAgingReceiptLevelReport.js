const getCustomerGraceDaysApi = "/api/clientworkorder/GetGraceDays";

let service = (app, ctx) => {

    function _validate(param) {
        if (!param.customerId) {
            throw new BadRequestError("CustomerId must not be null.");
        }
        if (!param.date) {
            throw new BadRequestError("Date must not be null.");
        }
        if (momentZone(param.date) > momentZone()) {
            throw new BadRequestError("Date must not greater than " + momentZone().format('YYYY-MM-DD'));
        }
    }

    class InventorySearch extends DBCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new DBOperator('=', 'customerId'),
                itemSpecId: new DBOperator('=', 'itemSpecId'),
                itemSpecIds: new DBOperator('IN', 'itemSpecId'),
                titleId: new DBOperator('=', 'titleId'),
                titleIds: new DBOperator('IN', 'titleId')
            };
        }
    }

    async function getCurInvs(param) {
        let search = new InventorySearch(param);
        let clause = search.buildClause();

        let sql1 = `select itemSpecId,unitId,sum(qty) as qty,receiptId,titleId from inventory 
                    where status<>'SHIPPED' and ${clause} and qty>0 and receiptId is not null
                    group by itemSpecId,unitId,receiptId,titleId`;
        let sql2 = `select itemSpecId,unitId,sum(qty) as qty,originalReceiveLPId,titleId from inventory 
                    where status<>'SHIPPED' and ${clause} and qty>0 and receiptId is null
                    group by itemSpecId,unitId,originalReceiveLPId,titleId`;

        let [invs1, invs2] = await Promise.all([
            wmsMysql(ctx).selectAll(sql1),
            wmsMysql(ctx).selectAll(sql2)
        ]);

        return _.union(invs1, invs2);
    }

    async function getShippedInvs(param) {
        let search = new InventorySearch(param);
        let clause = search.buildClause();

        let sql1 = `select itemSpecId,unitId,sum(qty) as qty,receiptId,titleId,date_format(shippedWhen,'%Y-%m-%d') as date from inventory 
                    where status='SHIPPED' and ${clause} and qty>0 and receiptId is not null and shippedWhen>'${param.date}'
                    group by itemSpecId,unitId,receiptId,titleId,date`;
        let sql2 = `select itemSpecId,unitId,sum(qty) as qty,originalReceiveLPId,titleId,date_format(shippedWhen,'%Y-%m-%d') as date from inventory 
                    where status='SHIPPED' and ${clause} and qty>0 and receiptId is null and shippedWhen>'${param.date}'
                    group by itemSpecId,unitId,originalReceiveLPId,titleId,date`;

        let [invs1, invs2] = await Promise.all([
            wmsMysql(ctx).selectAll(sql1),
            wmsMysql(ctx).selectAll(sql2)
        ]);

        return _.union(invs1, invs2);
    }

    async function _getCustomerGraceDays(customerId) {
        let organizationMap = await organizationService(ctx).getOrganizationMap([customerId]);
        let customer = organizationMap[customerId];
        let data = {
            Program: "WISE",
            Customer: customer ? (customer.customerCode ? customer.customerCode : customer.name) : "",
            Facility: app.systemConf.facility
        };

        let response = await billingService(ctx).postBillingApi(getCustomerGraceDaysApi, data);
        if (response && response.body && response.body.Status) {
            return JSON.parse(response.body.Result);
        } else {
            throw new BadRequestError("Get graceDays fail: " + response.body.ErrorMsg);
        }
    }

    function _isInGraceDay(item, customerGraceDays, receiptedTime, date) {
        if (!customerGraceDays || _.isEmpty(customerGraceDays.ds)) return false;
        if (!receiptedTime || !date) return false;

        if (customerGraceDays.ds.length === 1) {
            let grace = customerGraceDays.ds[0];
            if (grace.GraceDays === 0) return false;
            if (!grace.ItemGrade) {
                let endTime = momentZone(receiptedTime).add(grace.GraceDays, 'days');
                if (momentZone(date) < endTime) return true;
                return false;
            }
        }

        if (!item || !item.grade) return false;
        let graceDay = _.find(customerGraceDays.ds, o => o.ItemGrade === item.grade);
        if (!graceDay) return false;

        let endTime = momentZone(receiptedTime).add(graceDay.GraceDays, 'days');
        if (momentZone(date) < endTime) return true;
        return false;
    }

    async function getReport(param) {
        _validate(param);

        let [invs, shippedInvs, items] = await Promise.all([
            getCurInvs(param),
            getShippedInvs(param),
            await itemSpecCollection(ctx).query({customerId: param.customerId,tags:"PRODUCT"}, {projection: {name: 1, desc: 1, grade: 1}})
        ]);

        let receiveLPIds = _.compact(_.uniq(_.map(_.filter(invs, inv => _.isEmpty(inv.receiptId)), "originalReceiveLPId")));
        let shippedReceiveLPIds = _.compact(_.uniq(_.map(_.filter(shippedInvs, inv => _.isEmpty(inv.receiptId)), "originalReceiveLPId")));
        receiveLPIds = _.uniq(_.union(receiveLPIds, shippedReceiveLPIds));
        let shippedInvMap = _.groupBy(shippedInvs, "date");

        let invTitleIds = _.compact(_.uniq(_.map(invs, "titleId")));
        let shippedTitleIds = _.compact(_.uniq(_.map(invs, "shippedInvs")));
        invTitleIds = _.uniq(_.union(invTitleIds, shippedTitleIds));

        let itemSpecIds = _.map(items, "_id");
        let [uoms, receiptLps, titles, customerGraceDays] = await Promise.all([
            itemUnitCollection(ctx).query({itemSpecId: {$in: itemSpecIds}}, {projection: {name: 1, baseQty: 1}}),
            receiveLpSetupCollection(ctx).query({"lpDetails.lpId": {$in: receiveLPIds}}, {projection: {"lpDetails.lpId": 1,"lpDetails.receiptId": 1}}),
            organizationCollection(ctx).query({_id:{$in:invTitleIds}},{projection:{name:1}}),
            _getCustomerGraceDays(param.customerId)
        ]);
        let titleMap = _.keyBy(titles, "_id");

        let uomMap = _.keyBy(uoms, "_id");
        let itemMap = _.keyBy(items, "_id");
        let lpReceiptMap = {};
        let receiptIds = [];
        _.forEach(receiptLps, o => {
            _.forEach(o.lpDetails, detail => {
                lpReceiptMap[detail.lpId] = detail.receiptId;
                receiptIds.push(detail.receiptId);
            })
        })
        receiptIds = _.uniq(receiptIds);
        let invReceiptIds = _.compact(_.uniq(_.map(invs, "receiptId")));
        receiptIds = _.uniq(_.union(receiptIds, invReceiptIds));
        let receipts = await receiptCollection(ctx).query({_id:{$in:receiptIds}},{projection:{referenceNo:1,devannedTime:1}});
        let receiptMap = _.keyBy(receipts, "_id");

        let receiptLime = {};
        _.forEach(invs, inv => {
            let receiptId = inv.receiptId || lpReceiptMap[inv.originalReceiveLPId] || "";
            receiptLime[receiptId] = receiptLime[receiptId] || {};
            receiptLime[receiptId][inv.titleId] = receiptLime[receiptId][inv.titleId] || {};
            receiptLime[receiptId][inv.titleId][inv.itemSpecId] = receiptLime[receiptId][inv.itemSpecId] || 0;
            receiptLime[receiptId][inv.titleId][inv.itemSpecId] += uomMap[inv.unitId] ? inv.qty * uomMap[inv.unitId].baseQty : inv.qty;
        })

        let reportData = [];
        let time = momentZone();
        let date = time.format('YYYY-MM-DD');
        let dates = [];
        while (time > momentZone(param.date)) {
            dates.push(date);
            let shippedInvs = shippedInvMap[date];
            _addDateLine(reportData, receiptLime, shippedInvs, date, itemMap, uomMap, lpReceiptMap, receiptMap, titleMap, customerGraceDays);
            time = time.add(-1, 'days');
            date = time.format('YYYY-MM-DD');
        }

        _.forEach(reportData, data => {
            _.forEach(dates, date => {
                data[date] = data[date] || 0;
            })
        })

        let header = ["receiptId","referenceNo","title","devannedTime","item","itemDesc"];
        for (let i = dates.length - 1; i >= 0; i--) {
            header.push(dates[i]);
        }
        return {
            results: {
                data: reportData,
                head: header
            },
            paging: {
                totalCount: reportData.length,
                pageNo: 1,
                totalPage: 1,
                startIndex: 1,
                endIndex: reportData.length
            }
        };
    }

    function _addDateLine(reportData, receiptLime, shippedInvs, date, itemMap, uomMap, lpReceiptMap, receiptMap, titleMap, customerGraceDays) {
        _.forEach(receiptLime, (data, receiptId) => {
            let receipt = receiptMap[receiptId] || {};
            _.forEach(data, (receiptData, titleId) => {
                _.forEach(receiptData, (qty, itemSpecId) => {
                    if (receipt.devannedTime && momentZone(receipt.devannedTime).add(-1, 'days') > momentZone(date)) {
                        qty = 0;
                    }
                    if (_isInGraceDay(itemMap[itemSpecId], customerGraceDays, receipt.devannedTime, date)) qty = 0;

                    let line = _.find(reportData, o => o.receiptId === receiptId && o.itemSpecId === itemSpecId && o.titleId === titleId);
                    if (line) {
                        line[date] = qty;
                    } else {
                        let row = {
                            receiptId: receiptId,
                            referenceNo: receipt.referenceNo || "",
                            titleId: titleId || "",
                            title: titleMap[titleId] ? titleMap[titleId].name : "",
                            devannedTime: receipt.devannedTime ? momentZone(receipt.devannedTime).format('YYYY-MM-DD HH:mm:ss') : "",
                            itemSpecId: itemSpecId,
                            item: itemMap[itemSpecId].name,
                            itemDesc: itemMap[itemSpecId].desc
                        };
                        row[date] = qty;
                        reportData.push(row);
                        receiptLime[receiptId][titleId][itemSpecId] = qty;
                    }
                })
            })
        })

        _.forEach(shippedInvs, record => {
            let receiptId = record.receiptId || lpReceiptMap[record.originalReceiveLPId] || "";
            let receipt = receiptMap[receiptId] || {};
            let qty = uomMap[record.unitId] ? record.qty * uomMap[record.unitId].baseQty : record.qty;
            if (_isInGraceDay(itemMap[record.itemSpecId], customerGraceDays, receipt.devannedTime, date)) qty = 0;

            receiptLime[receiptId] = receiptLime[receiptId] || {};
            receiptLime[receiptId][record.titleId] = receiptLime[receiptId][record.titleId] || {};
            let line = _.find(reportData, o => o.receiptId === receiptId && o.itemSpecId === record.itemSpecId && o.titleId === record.titleId);
            if (line) {
                line[date] += qty;
                receiptLime[receiptId][record.titleId][record.itemSpecId] += qty;
            } else {
                let row = {
                    receiptId: receiptId,
                    referenceNo: receipt.referenceNo || "",
                    titleId: record.titleId,
                    title: titleMap[record.titleId] ? titleMap[record.titleId].name : "",
                    devannedTime: receipt.devannedTime ? momentZone(receipt.devannedTime).format('YYYY-MM-DD HH:mm:ss') : "",
                    itemSpecId: record.itemSpecId,
                    item: itemMap[record.itemSpecId].name,
                    itemDesc: itemMap[record.itemSpecId].desc
                };
                row[date] = qty;
                receiptLime[receiptId] = receiptLime[receiptId] || {};
                receiptLime[receiptId][record.titleId] = receiptLime[receiptId][record.titleId] || {};
                receiptLime[receiptId][record.titleId][record.itemSpecId] = qty;
                reportData.push(row)
            }
        })
    }

    return {
        getReport
    };
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};