let service = (app, ctx) => {

    class smallParcelShipmentSearch extends MongoCriteria {
        constructor(criteria) {
            super(criteria);
            this.definition = {
                shipmentInfoIds: new MongoOperator('$in', 'shipmentInfoId'),
                carrierIds: new MongoOperator('$in', 'carrierId'),
                createdWhenFrom: new MongoOperator('$gte', 'createdWhen', 'Date'),
                createdWhenTo: new MongoOperator('$lte', 'createdWhen', 'Date'),
                isShippingLabelPrinted: new MongoOperator('$eq', 'isShippingLabelPrinted')
            };
        }
    }

    async function smallParcelShipmentSearchByPaging(criteria) {
        let search = new smallParcelShipmentSearch(criteria);
        let smallParcelShipments = await smallParcelShipmentCollection(ctx).findByPaging(search.buildClause());
        let head = [
            "Id",
            "PackageItem",
            "PackageItemDesc",
            "PackageType",
            "TrackingNo",
            "LookupId",
            "ShipmentInfoId",
            "Printer",
            "CreatedBy",
            "CreatedWhen",
            "UpdatedBy",
            "UpdatedWhen",
            "IsShipmentDeleted",
            "IsTrackingNoDeleted",
            "IsShippingLabelPrinted"
        ];

        if (!smallParcelShipments.results || smallParcelShipments.results.length === 0) {
            return {
                results: {
                    data: [],
                    head: head
                },
                paging: smallParcelShipments.paging
            }
        }

        let packageTypeItemSpecIds = _.uniq(_.map(smallParcelShipments.results, "packageTypeItemSpecId"));

        let [itemSpecs] = await Promise.all([itemSpecCollection(ctx).query({_id: {$in: packageTypeItemSpecIds}}, {
            projection: {
                name: 1,
                desc: 1
            }
        })]);

        let itemSpecMap = _.keyBy(itemSpecs, "_id");

        let data = [];
        _.forEach(smallParcelShipments.results, smallParcelShipment => {
            data.push({
                "Id": smallParcelShipment._id.toString(),
                "PackageItem": itemSpecMap[smallParcelShipment.packageTypeItemSpecId] ? itemSpecMap[smallParcelShipment.packageTypeItemSpecId].name : "",
                "PackageItemDesc": itemSpecMap[smallParcelShipment.packageTypeItemSpecId] ? itemSpecMap[smallParcelShipment.packageTypeItemSpecId].desc : "",
                "PackageType": smallParcelShipment.packageType ? smallParcelShipment.packageType : "",
                "TrackingNo": smallParcelShipment.trackingNo ? smallParcelShipment.trackingNo : "",
                "LookupId": smallParcelShipment.lookupId ? smallParcelShipment.lookupId : "",
                "ShipmentInfoId": smallParcelShipment.shipmentInfoId ? smallParcelShipment.shipmentInfoId : "",
                "Printer": smallParcelShipment.printer ? smallParcelShipment.printer : "",
                "CreatedBy": smallParcelShipment.createdBy ? smallParcelShipment.createdBy : "",
                "CreatedWhen": smallParcelShipment.createdWhen ? momentZone(smallParcelShipment.createdWhen).format('YYYY-MM-DD HH:mm:ss') : "",
                "UpdatedBy": smallParcelShipment.updatedBy ? smallParcelShipment.updatedBy : "",
                "UpdatedWhen": smallParcelShipment.updatedWhen ? momentZone(smallParcelShipment.updatedWhen).format('YYYY-MM-DD HH:mm:ss') : "",
                "IsShipmentDeleted": commonService(ctx).convertToYN(smallParcelShipment.isShipmentDeleted),
                "IsTrackingNoDeleted": commonService(ctx).convertToYN(smallParcelShipment.isTrackingNoDeleted),
                "IsShippingLabelPrinted": commonService(ctx).convertToYN(smallParcelShipment.isShippingLabelPrinted)
            });
        });

        return {
            results: {
                data: data,
                head: head
            },
            paging: smallParcelShipments.paging
        }
    }

    return {
        smallParcelShipmentSearchByPaging
    }
};

module.exports = function (app) {
    return (ctx) => service(app, ctx);
};