'use strict';

module.exports = function (app) {

    // ================ SHARED Mongo Collection Declaration ================
    // Item
    global.itemSpecCollection = sharedMongo.collection('item_spec');
    global.itemUnitCollection = sharedMongo.collection('item_unit');
    global.itemUnitPickTypeCollection = sharedMongo.collection('item_unit_pick_type');
    global.itemPropertyCollection = sharedMongo.collection('item_property');
    global.itemSpecFieldCollection = sharedMongo.collection('item_spec_field');
    global.itemGroupCollection = sharedMongo.collection('item_group');
    global.itemAkaCollection = sharedMongo.collection('item_aka');

    // Organization
    global.organizationCollection = sharedMongo.collection('organization');
    global.organizationExtendCollection = sharedMongo.collection('organization_extend');
    global.customerCollection = sharedMongo.collection('customer');
    global.carrierCollection = sharedMongo.collection('carrier');

    // LP Template
    global.singleLpTemplateCollection = sharedMongo.collection('single_lp_template');
    global.singleItemLpConfigurationCollection = sharedMongo.collection('single_item_lp_configuration');

    //Report center
    global.reportFieldMappingCollection = sharedMongo.collection('report_field_mapping');
    global.reportFieldMappingCustomizationCollection = sharedMongo.collection('report_field_mapping_customization');
    global.reportConfigCollection = sharedMongo.collection('report_config');
    global.importMappingCollection = sharedMongo.collection('import_mapping');

    global.pickStrategyUnitGroupCollection = sharedMongo.collection('pick_strategy_unit_group');
    //long_haul
    global.longHaulCollection = sharedMongo.collection('long_haul');

    // ================ WMS Mongo Collection Declaration ================
    // EDI
    global.ediCollection = wmsMongo.collection('edi');

    // Facility
    global.locationCollection = wmsMongo.collection('location');
    global.locationGroupCollection = sharedMongo.collection('location_group');
    global.itemLocationCollection = wmsMongo.collection('item_location');

    global.facilityCollection = sharedMongo.collection('facility');

    global.initBillingOrgRecordCollection = sharedMongo.collection('init_billing_org_record');
    // Inbound Receipt
    global.receiptCollection = wmsMongo.collection('receipt');
    global.receiptItemLineCollection = wmsMongo.collection('receipt_itemline');
    global.lpSNCollection = wmsMongo.collection('lp_sn_collection');
    global.preAlertSnCollection = wmsMongo.collection('pre_alert_sn');
    global.receiptLpSetupCollection = wmsMongo.collection('receive_lp_setup');
    // Inbound Task
    global.receiveTaskCollection = wmsMongo.collection('receive_task');
    global.loadTaskCollection = wmsMongo.collection('load_task');
    global.loadingStepCollection = wmsMongo.collection('loading_step');

    global.receiveOffloadCollection = wmsMongo.collection('receive_offload');
    global.receiveLpSetupCollection = wmsMongo.collection('receive_lp_setup');
    global.receiveLpVerifyCollection = wmsMongo.collection('receive_lp_verify');
    global.receiveSnScanCollection = wmsMongo.collection('receive_sn_scan');


    // Outbound Receipt
    global.orderCollection = wmsMongo.collection('order');
    global.orderItemLineCollection = wmsMongo.collection('order_itemline');
    global.shipmentTicketCollection = wmsMongo.collection('shipment_ticket');
    global.loadCollection = wmsMongo.collection('load');
    global.loadOrderLineCollection = wmsMongo.collection('load_order_line');

    // Outbound Task
    global.loadTaskCollection = wmsMongo.collection("load_task");


    // Small Parcel Shipment
    global.smallParcelShipmentCollection = wmsMongo.collection('small_parcel_shipment');
    global.shipmentDetailCollection = wmsMongo.collection('shipment_detail');


    // Window Checkin
    global.entryTicketCollection = wmsMongo.collection('entry_ticket');
    global.entryTicketActivityCollection = wmsMongo.collection('entry_ticket_activity');
    global.entryTicketCheckCollection = wmsMongo.collection('entry_ticket_check');
    global.entryTicketTimeLineCollection = wmsMongo.collection('entry_ticket_time_line');
    global.entryTicketWaitingCollection = wmsMongo.collection('entry_ticket_waiting');

    global.configurationCollection = wmsMongo.collection('configuration');

    // Material
    global.materialLineCollection = wmsMongo.collection('material_line');

    // Task
    global.generalTaskCollection = wmsMongo.collection('general_task');
    global.genericStepCollection = wmsMongo.collection('generic_step');

    global.parcelPackHistoryCollection = wmsMongo.collection('parcel_pack_history');

    // Pick Task
    global.pickTaskCollection = wmsMongo.collection('pick_task');

    global.qcTaskCollection = wmsMongo.collection('qc_task');
    global.packTaskCollection = wmsMongo.collection('pack_task');
    global.packHistoryCollection = wmsMongo.collection('pack_history');
    global.putBackTaskCollection = wmsMongo.collection('put_back_task');
    global.putBackStepCollection = wmsMongo.collection('put_back_step');
    global.putBackHistoryCollection = wmsMongo.collection('put_back_history');

    // Transload Task
    global.transloadReceivingCollection = wmsMongo.collection('transload_receiving');
    global.transloadLpnCollection = wmsMongo.collection('transload_lpn');
    global.transloadOffloadCollection = wmsMongo.collection('transload_offload');


    // Inventory
    global.adjustmentCollection = wmsMongo.collection('adjustment');

    // Billing
    global.billingManualCollection = wmsMongo.collection('billing_manual');
    global.billingInvoiceCollection = wmsMongo.collection('billing_invoice');
    global.billingRecordCollection = wmsMongo.collection('billing_record');
    global.invoicedRecordCollection = wmsMongo.collection('invoiced_record');

    //location
    global.locationItemCollection = wmsMongo.collection("location_item");

    //replenishment
    global.replenishmentStepProcess = wmsMongo.collection("replenishment_step_process");

    global.conveyorLineCollection = wmsMongo.collection("conveyor_line");
    global.conveyorBranchCollection = wmsMongo.collection("conveyor_branch");

};
