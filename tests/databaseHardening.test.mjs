import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const shipmentMigration = fs.readFileSync(
  new URL("../supabase/migrations/20260731210000_preorder_shipping_safety.sql", import.meta.url),
  "utf8"
);
const emailMigration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260802090000_durable_email_delivery_and_rpc_security.sql",
    import.meta.url
  ),
  "utf8"
);
const stripeTransitionMigration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260731220000_stripe_order_state_transitions.sql",
    import.meta.url
  ),
  "utf8"
);
const paymentRecordingMigration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260802100000_payment_recording_concurrency.sql",
    import.meta.url
  ),
  "utf8"
);
const preorderScannerMigration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260802101000_preorder_email_scanner_bounds.sql",
    import.meta.url
  ),
  "utf8"
);
const stripeFinancialStateMigration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260802102000_stripe_financial_state_ordering.sql",
    import.meta.url
  ),
  "utf8"
);
const testShipmentReportingMigration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260802103000_test_shipment_reporting.sql",
    import.meta.url
  ),
  "utf8"
);
const easyPostTestLabelMigration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260803100000_easypost_test_labels.sql",
    import.meta.url
  ),
  "utf8"
);
const shipmentStatusRepairMigration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260803110000_repair_shipments_status_constraint.sql",
    import.meta.url
  ),
  "utf8"
);
const singleItemShippingCapMigration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260803111000_single_item_shipping_cap.sql",
    import.meta.url
  ),
  "utf8"
);
const schema = fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

test("preorder shipping safety repairs a missing automatic-label column dependency", () => {
  assert.match(
    shipmentMigration,
    /alter table shipments[\s\S]*add column if not exists label_purchase_started_at timestamptz,[\s\S]*add column if not exists label_purchase_error text/u
  );
});

test("shipment label workers can enter and recover from the purchase lease state", () => {
  assert.match(
    shipmentStatusRepairMigration,
    /drop constraint if exists shipments_status_check/u
  );
  assert.match(
    shipmentStatusRepairMigration,
    /check \(status in \([\s\S]*'pending_label',[\s\S]*'purchasing_label',[\s\S]*'label_purchased',[\s\S]*'shipped',[\s\S]*'delivered',[\s\S]*'cancelled'[\s\S]*\)\) not valid/u
  );
  assert.match(
    shipmentStatusRepairMigration,
    /validate constraint shipments_status_check\s*;/u
  );
});

test("single-item shipping subsidies preserve actual costs and exact customer charges", () => {
  assert.match(
    singleItemShippingCapMigration,
    /add column if not exists discount_cents integer not null default 0/u
  );
  assert.match(
    singleItemShippingCapMigration,
    /charged_shipping_cents\s*=\s*unrounded_cents \+ rounding_cents - discount_cents/u
  );
  assert.match(
    singleItemShippingCapMigration,
    /discount_cents <= unrounded_cents \+ rounding_cents/u
  );
});

test("order and item integrity constraints are validated in the shipping safety migration", () => {
  const constraints = [
    "orders_status_check",
    "orders_currency_usd",
    "orders_amounts_nonnegative",
    "orders_total_matches_components",
    "orders_market_has_no_shipping_charge",
    "order_items_preorder_not_above_quantity"
  ];

  for (const constraint of constraints) {
    assert.match(
      shipmentMigration,
      new RegExp(`validate constraint ${constraint}\\s*;`, "u"),
      `${constraint} must be validated`
    );
  }
});

test("financial test orders cannot create or reactivate unpurchased postage", () => {
  const testBranch = shipmentMigration.indexOf("if coalesce(v_order.is_test_order, false) then");
  const normalShippingBranch = shipmentMigration.indexOf(
    "if v_order.fulfillment <> 'ship' or v_order.status <> 'paid' then"
  );

  assert.ok(testBranch >= 0 && normalShippingBranch > testBranch);
  const branchSource = shipmentMigration.slice(testBranch, normalShippingBranch);
  assert.match(branchSource, /status = 'cancelled'/u);
  assert.match(branchSource, /label_purchased_at is null/u);
  assert.match(branchSource, /label_url/u);
  assert.match(branchSource, /tracking_number/u);
  assert.match(branchSource, /shipment_parcels/u);
  assert.match(branchSource, /return null\s*;/u);
  assert.doesNotMatch(branchSource, /insert into shipments/iu);

  assert.match(
    shipmentMigration,
    /sync_all_shipments\(\)[\s\S]*and not coalesce\(o\.is_test_order, false\)/u
  );
  assert.match(
    shipmentMigration,
    /sync_all_shipments\(\)[\s\S]*not exists \([\s\S]*from shipments s[\s\S]*s\.status = 'cancelled'[\s\S]*limit 100/u
  );
  assert.match(
    shipmentMigration,
    /Automatic label purchase disabled for a financial test order\./u
  );

  const nonpaidBranch = shipmentMigration.slice(normalShippingBranch);
  assert.match(
    nonpaidBranch,
    /s\.status in \('pending_label', 'purchasing_label'\)[\s\S]*s\.label_purchased_at is null[\s\S]*s\.tracking_number[\s\S]*shipment_parcels/u
  );
  assert.match(
    nonpaidBranch,
    /delete from shipments s[\s\S]*s\.status = 'pending_label'[\s\S]*s\.label_purchased_at is null[\s\S]*s\.tracking_number/u
  );
});

test("financial test orders remain visible as cancelled shipment reporting rows", () => {
  const normalOrderLoop = testShipmentReportingMigration.indexOf("for v_order_id in");
  const testReportingInsert = testShipmentReportingMigration.slice(0, normalOrderLoop);
  assert.match(testReportingInsert, /and coalesce\(o\.is_test_order, false\)/u);
  assert.match(testReportingInsert, /o\.payment_reference,[\s\S]*'cancelled'/u);
  assert.match(testReportingInsert, /visible for reporting only/u);
  assert.match(testReportingInsert, /label purchase and tracking are disabled/u);
  assert.match(
    testShipmentReportingMigration,
    /not coalesce\(o\.is_test_order, false\)[\s\S]*sync_shipment_for_order/u
  );
  assert.doesNotMatch(
    testReportingInsert,
    /'pending_label'/u
  );
});

test("EasyPost test labels use isolated service-role-only shipment RPCs", () => {
  assert.match(easyPostTestLabelMigration, /sync_shipment_for_order_with_test_labels/u);
  assert.match(easyPostTestLabelMigration, /sync_test_shipments_for_labels/u);
  assert.match(easyPostTestLabelMigration, /coalesce\(v_order\.is_test_order, false\)/u);
  assert.match(easyPostTestLabelMigration, /status = 'pending_label'/u);
  assert.match(easyPostTestLabelMigration, /label_purchase_error = null/u);
  assert.match(
    easyPostTestLabelMigration,
    /revoke all on function public\.sync_shipment_for_order_with_test_labels\(uuid\)[\s\S]*from public, anon, authenticated/u
  );
  assert.match(
    easyPostTestLabelMigration,
    /grant execute on function public\.sync_test_shipments_for_labels\(\)[\s\S]*to service_role/u
  );
});

test("durable email RPCs require lease tokens and atomic exact-batch completion", () => {
  const requiredColumns = [
    "customer_confirmation_email_claim_token uuid",
    "claim_token uuid",
    "message_id text",
    "last_error_code text",
    "ready_pickup_email_claim_token uuid",
    "ready_pickup_email_claimed_at timestamptz"
  ];
  for (const column of requiredColumns) {
    assert.match(emailMigration, new RegExp(column, "u"));
    assert.match(schema, new RegExp(column, "u"));
  }

  assert.match(emailMigration, /claim_email_job\(\s*p_job_id uuid,\s*p_stale_before timestamptz,\s*p_claim_token uuid/u);
  assert.match(emailMigration, /complete_email_job\(\s*p_job_id uuid,\s*p_claim_token uuid,/u);
  assert.match(emailMigration, /v_requested_ids is distinct from v_unsent_ids/u);
  assert.match(emailMigration, /v_matching_ids is distinct from v_requested_ids/u);
  assert.match(emailMigration, /for update/u);
});

test("preorder scanning selects bounded whole-order batches and quarantines poison batches", () => {
  for (const source of [preorderScannerMigration, schema]) {
    assert.match(source, /get_preorder_ready_email_candidate_orders/u);
    assert.match(source, /group by pre\.order_id[\s\S]*having max\(pre\.created_at\) <= p_cutoff/u);
    assert.match(source, /count\(\*\) <= least\(greatest\(coalesce\(p_max_events_per_order/u);
    assert.match(source, /get_preorder_ready_email_backlog_health/u);
  }

  for (const signature of [
    "get_preorder_ready_email_candidate_orders",
    "get_preorder_ready_email_backlog_health"
  ]) {
    assert.match(
      preorderScannerMigration,
      new RegExp(`revoke all on function public\\.${signature}`, "u")
    );
    assert.match(
      preorderScannerMigration,
      new RegExp(`grant execute on function public\\.${signature}`, "u")
    );
  }
});

test("financial-test classification is committed in the paid-order transaction", () => {
  assert.match(
    emailMigration,
    /record_paid_order\([\s\S]*p_is_test_order boolean[\s\S]*v_order_id := record_paid_order\([\s\S]*set is_test_order = true[\s\S]*return v_order_id/u
  );
  assert.match(
    schema,
    /record_paid_order\([\s\S]*p_is_test_order boolean[\s\S]*set is_test_order = true/u
  );
});

test("paid-order replay is serialized and inventory locks use deterministic SKU order", () => {
  for (const source of [paymentRecordingMigration, schema]) {
    assert.match(source, /pg_advisory_xact_lock\(hashtextextended\(p_session_id, 0\)\)/u);
    assert.match(
      source,
      /from jsonb_array_elements\(p_items\) as item\(value\)[\s\S]*order by trim\(both from coalesce\(item\.value->>'sku', ''\)\)/u
    );
  }

  assert.match(
    paymentRecordingMigration,
    /revoke all on function public\.record_paid_order\([\s\S]*from public, anon, authenticated/u
  );
  assert.match(
    paymentRecordingMigration,
    /grant execute on function public\.record_paid_order\([\s\S]*to service_role/u
  );
});

test("Stripe replay, refund, and dispute transitions are monotonic", () => {
  assert.match(
    stripeTransitionMigration,
    /v_current_status = 'refunded' and v_target_status in \('paid', 'disputed'\)/u
  );
  assert.match(
    stripeTransitionMigration,
    /v_target_status = 'paid' and v_current_status not in \('paid', 'disputed'\)/u
  );
  assert.match(
    stripeTransitionMigration,
    /v_target_status = 'cancelled' and v_current_status not in \('pending', 'cancelled'\)/u
  );
  assert.match(stripeTransitionMigration, /not coalesce\(p_retire_work, true\)/u);
});

test("Stripe financial snapshots are atomic, event-ordered, and retire fulfillment safely", () => {
  for (const source of [stripeFinancialStateMigration, schema]) {
    assert.match(source, /stripe_state_effective_at timestamptz/u);
    assert.match(source, /stripe_state_observed_at timestamptz/u);
    assert.match(source, /stripe_state_retire_work boolean not null default false/u);
    assert.match(source, /stripe_fulfillment_retired_at timestamptz/u);
    assert.match(
      source,
      /v_effective_at < v_current_effective_at[\s\S]*v_effective_at = v_current_effective_at[\s\S]*v_observed_at < v_current_observed_at/u
    );
    assert.match(source, /when v_target_status = 'refunded' then 50/u);
    assert.match(source, /when v_target_status = 'disputed'.*p_retire_work.*then 40/u);
    assert.match(
      source,
      /stripe_fulfillment_retired_at = case[\s\S]*v_target_status in \('cancelled', 'refunded'\)[\s\S]*coalesce\(stripe_fulfillment_retired_at, v_effective_at\)/u
    );
    assert.match(
      source,
      /guard_retired_stripe_fulfillment\(\)[\s\S]*new\.status not in \('pending_label', 'purchasing_label'\)[\s\S]*operator reconciliation is required/u
    );
    assert.match(source, /shipments_guard_retired_stripe_fulfillment/u);
    assert.match(
      source,
      /status = 'pending_label'[\s\S]*label_purchase_started_at = null[\s\S]*payment is disputed/u
    );
    assert.match(
      source,
      /status = 'cancelled'[\s\S]*label_purchase_started_at = null[\s\S]*payment dispute was lost/u
    );
  }

  assert.match(
    stripeFinancialStateMigration,
    /record_stripe_order_state\([\s\S]*record_paid_order\([\s\S]*transition_stripe_order_state\([\s\S]*'fulfillment_retired'/u
  );
  assert.match(
    stripeFinancialStateMigration,
    /enqueue_order_confirmation_email\([\s\S]*stripe_fulfillment_retired_at is not null[\s\S]*last_error_code = 'order_ineligible'[\s\S]*status = 'pending'/u
  );
  assert.match(
    schema,
    /enqueue_order_confirmation_email\([\s\S]*stripe_fulfillment_retired_at is not null[\s\S]*last_error_code = 'order_ineligible'[\s\S]*status = 'pending'/u
  );
  for (const functionName of ["claim_email_job", "retry_failed_email_job"]) {
    assert.match(
      stripeFinancialStateMigration,
      new RegExp(
        `${functionName}\\([\\s\\S]*stripe_fulfillment_retired_at is not null`,
        "u"
      )
    );
    assert.match(
      schema,
      new RegExp(
        `${functionName}\\([\\s\\S]*stripe_fulfillment_retired_at is not null`,
        "u"
      )
    );
  }
  assert.match(
    stripeFinancialStateMigration,
    /revoke all on function public\.record_stripe_order_state\([\s\S]*from public, anon, authenticated/u
  );
  assert.match(
    stripeFinancialStateMigration,
    /grant execute on function public\.record_stripe_order_state\([\s\S]*to service_role/u
  );
});

test("every server-only application RPC is revoked from public roles", () => {
  const signatures = [
    "consume_api_rate_limit(text,text,integer,integer)",
    "record_paid_order(text,text,text,text,text,integer,integer,integer,integer,jsonb,jsonb)",
    "record_paid_order(text,text,text,text,text,integer,integer,integer,integer,jsonb,jsonb,boolean)",
    "transition_stripe_order_state(uuid,text,timestamptz)",
    "transition_stripe_order_state(uuid,text,timestamptz,boolean)",
    "sync_shipment_for_order(uuid)",
    "sync_all_shipments()",
    "get_admin_prep_data(date,timestamptz,timestamptz)",
    "apply_restock(text,integer)",
    "set_expected_restock_date(text,date)",
    "get_non_test_units_sold()",
    "unsubscribe_email_addresses(text[],text,text)",
    "subscribe_email_address(text,text,text,text)",
    "apply_email_list_changes(text[],text[])",
    "enqueue_order_confirmation_email(uuid,jsonb,uuid,text)",
    "claim_email_job(uuid,timestamptz,uuid)",
    "reschedule_or_fail_email_job(uuid,uuid,text,text,boolean,timestamptz)",
    "complete_email_job(uuid,uuid,timestamptz)",
    "retry_failed_email_job(uuid,timestamptz)",
    "claim_preorder_ready_email_events(uuid,uuid[],uuid,timestamptz,timestamptz)",
    "release_preorder_ready_email_events(uuid[],uuid)",
    "complete_preorder_ready_email_events(uuid[],uuid,timestamptz)"
  ];

  for (const signature of signatures) {
    assert.ok(
      emailMigration.includes(`'public.${signature}'`),
      `${signature} must be included in the least-privilege RPC list`
    );
  }

  assert.match(emailMigration, /revoke all on function %s from public, anon, authenticated/iu);
  assert.match(emailMigration, /grant execute on function %s to service_role/iu);
  assert.match(
    emailMigration,
    /revoke create on schema public from public, anon, authenticated/iu
  );
  assert.doesNotMatch(emailMigration, /information_schema\.routines|pg_proc/iu);
});
