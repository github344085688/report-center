const _ = require('lodash');

let service = (app, ctx) => {

    async function searchByPaging(criteria) {
        let orderSearch = new OrderSearch(criteria);
        let criteriaClause = orderSearch.buildClause();
        if (!criteriaClause) {
            throw new BadRequestError('Please select at least 1 criterion.');
        }

        let head = [
            "CompanyID",
            "CustomerID",
            "VendorID",
            "PONo",
            "ReferenceNo",
            "CustomerSONo",
            "ReferenceNo01",
            "ReferenceNo02",
            "ScheduledDate",
            "SoldToName",
            "MABD",
            "ShipToName",
            "ShipToAddress1",
            "ShipToAddress2",
            "ShipToCity",
            "ShipToState",
            "ShipToZipCode",
            "ShipToCountry",
            "ShipToStoreNo",
            "BillToName",
            "BillToAddress1",
            "BillToAddress2",
            "BillToCity",
            "BillToState",
            "BillToZipCode",
            "BillToCountry",
            "BillToContact",
            "BillToPhone",
            "BillToExtension",
            "BillToFax",
            "BillToEmail",
            "BillToStoreNo",
            "FreightTerm",
            "ShipMethod",
            "SCACCode",
            "CarrierName",
            "ShippingAccountNo",
            "TotalWeight",
            "TotalCbft",
            "Note",
            "BOLNote",
            "LabelNote",
            "CartonNo",
            "LineNo",
            "ItemID",
            "BuyerItemID",
            "CommodityDescription",
            "NMFC",
            "FreightClass",
            "LotNo",
            "OrderedQty",
            "PoundPerPackage",
            "Pallets",
            "CustomerPallets",
            "PalletWeight",
            "ItemNote",
            "UPCCode"
        ];


        let orders = await orderCollection(ctx).findByPaging(criteriaClause);
        if (!orders.results || orders.results.length === 0) {
            return {
                results: {
                    data: [],
                    head: head
                },
                paging: orders.paging
            }
        }

        let ordersMap = _.keyBy(orders.results, "_id");
        let orderIds = _.map(orders.results, "_id");
        let carrierIds = _.uniq(_.map(_.filter(orders.results, order => !_.isEmpty(order.carrierId)), "carrierId"));
        let carriers = await carrierCollection(ctx).find({_id: {$in: carrierIds}}).toArray();
        let carrierMap = _.keyBy(carriers, "_id");

        let orderItemLines = await orderItemLineCollection(ctx).find({orderId: {$in: orderIds}}).toArray();
        let itemSpecIds = _.uniq(_.map(orderItemLines, "itemSpecId"));
        let items = await itemSpecCollection(ctx).find({_id: {$in: itemSpecIds}}).toArray();
        let itemMap = _.keyBy(items, "_id");


        let data = [];
        _.forEach(orderItemLines, itemLine => {
            let order = ordersMap[itemLine.orderId];
            data.push({
                "CompanyID": "W17",
                "CustomerID": "NZXT0001",
                "VendorID": "NZXT0001",
                "PONo": order.poNo,
                "ReferenceNo": order.referenceNo,
                "CustomerSONo": _.join(order.soNos, ","),
                "ReferenceNo01": "",
                "ReferenceNo02": "",
                "ScheduledDate": order.scheduleDate ? momentZone(order.scheduleDate).format('M/D/YYYY') : "",
                "SoldToName": order.soldToAddress ? order.soldToAddress.name : "",
                "MABD": order.mabd ? momentZone(order.mabd).format('M/D/YYYY') : "",
                "ShipToName": order.shipToAddress ? order.shipToAddress.name : "",
                "ShipToAddress1": order.shipToAddress ? order.shipToAddress.address1 : "",
                "ShipToAddress2": order.shipToAddress ? order.shipToAddress.address2 : "",
                "ShipToCity": order.shipToAddress ? order.shipToAddress.city : "",
                "ShipToState": order.shipToAddress ? order.shipToAddress.state : "",
                "ShipToZipCode": order.shipToAddress ? order.shipToAddress.zipCode : "",
                "ShipToCountry": order.shipToAddress ? order.shipToAddress.country : "",
                "ShipToStoreNo": order.shipToAddress ? order.shipToAddress.storeNo : "",
                "BillToName": order.billToAddress ? order.billToAddress.name : "",
                "BillToAddress1": order.billToAddress ? order.billToAddress.address1 : "",
                "BillToAddress2": order.billToAddress ? order.billToAddress.address2 : "",
                "BillToCity": order.billToAddress ? order.billToAddress.city : "",
                "BillToState": order.billToAddress ? order.billToAddress.state : "",
                "BillToZipCode": order.billToAddress ? order.billToAddress.zipCode : "",
                "BillToCountry": order.billToAddress ? order.billToAddress.country : "",
                "BillToContact": order.billToAddress ? order.billToAddress.contact : "",
                "BillToPhone": order.billToAddress ? order.billToAddress.phone : "",
                "BillToExtension": order.billToAddress ? order.billToAddress.extension : "",
                "BillToFax": order.billToAddress ? order.billToAddress.fax : "",
                "BillToEmail": order.billToAddress ? order.billToAddress.email : "",
                "BillToStoreNo": order.billToAddress ? order.billToAddress.storeNo : "",
                "FreightTerm": _translateFreightTerm(order.freightTerm),
                "ShipMethod": order.shipMethod,
                "SCACCode": carrierMap[order.carrierId] ? carrierMap[order.carrierId].scac : "",
                "CarrierName": carrierMap[order.carrierId] ? carrierMap[order.carrierId].name : "",
                "ShippingAccountNo": "",
                "TotalWeight": "",
                "TotalCbft": "",
                "Note": order.orderNote,
                "BOLNote": order.bolNote,
                "LabelNote": order.labelNote,
                "CartonNo": order.cartonNo,
                "LineNo": "",
                "ItemID": itemMap[itemLine.itemSpecId].name,
                "BuyerItemID": itemLine.buyerItemId,
                "CommodityDescription": itemLine.commodityDescription,
                "NMFC": itemMap[itemLine.itemSpecId].nmfc,
                "FreightClass": itemMap[itemLine.itemSpecId].freightClass,
                "LotNo": itemLine.lotNo,
                "OrderedQty": itemLine.qty,
                "PoundPerPackage": "",
                "Pallets": "",
                "CustomerPallets": "",
                "PalletWeight": "",
                "ItemNote": "",
                "UPCCode": itemMap[itemLine.itemSpecId].upcCode
            });

        });

        return {
            results: {
                data: data,
                head: head,
                shortHead: head
            },
            paging: orders.paging
        }

    }

    function _translateFreightTerm(freightTerm) {
        let map = {
            "THIRD_PARTY": "TP",
            "PREPAID": "PP",
            "COLLECT": "CC"
        };

        return map[freightTerm];
    }


    class OrderSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                customerId: new MongoOperator('$eq', 'customerId'),
                statuses: new MongoOperator('$in', 'status')
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
