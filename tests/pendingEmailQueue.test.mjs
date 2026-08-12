import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const { buildPendingEmailQueueRows } = await import(
  "../lib/pendingEmailQueue.js?pending-email-queue-test"
);

const NOW = "2026-08-11T18:00:00.000Z";

test("pending confirmation rows explain the email purpose and immediate delivery", () => {
  const rows = buildPendingEmailQueueRows({
    now: NOW,
    confirmationJobs: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        status: "pending",
        order_id: "22222222-2222-4222-8222-222222222222",
        created_at: "2026-08-11T17:59:58.000Z",
        available_at: "2026-08-11T17:59:58.000Z",
        orders: {
          customer_email: "Customer@Example.com",
          is_test_order: false
        }
      }
    ]
  });

  assert.deepEqual(rows, [
    {
      id: "confirmation:11111111-1111-4111-8111-111111111111",
      queued_at: "2026-08-11T17:59:58.000Z",
      recipient: "customer@example.com",
      email_for: "Order confirmation",
      status: "Pending",
      pending_for: "Waiting for the immediate automatic send attempt.",
      order_id: "22222222-2222-4222-8222-222222222222"
    }
  ]);
});

test("confirmation retries and terminal failures have actionable pending reasons", () => {
  const rows = buildPendingEmailQueueRows({
    now: NOW,
    confirmationJobs: [
      {
        id: "retry-job",
        status: "pending",
        order_id: "retry-order",
        created_at: "2026-08-11T17:30:00.000Z",
        available_at: "2026-08-11T18:15:00.000Z",
        last_error_code: "smtp_failed",
        orders: { customer_email: "retry@example.com" }
      },
      {
        id: "failed-job",
        status: "failed",
        order_id: "failed-order",
        created_at: "2026-08-11T17:31:00.000Z",
        last_error_code: "configuration_unavailable",
        orders: { customer_email: "failed@example.com" }
      }
    ]
  });

  assert.equal(rows[0].status, "Retry scheduled");
  assert.match(rows[0].pending_for, /mail server did not accept/u);
  assert.equal(rows[1].status, "Needs attention");
  assert.match(rows[1].pending_for, /email service is not configured/u);
  assert.match(rows[1].pending_for, /Retry Failed Confirmations/u);
});

test("pre-order release events consolidate into one queue row per order", () => {
  const order = {
    id: "33333333-3333-4333-8333-333333333333",
    status: "paid",
    fulfillment: "market",
    customer_email: "pickup@example.com",
    is_test_order: false
  };
  const rows = buildPendingEmailQueueRows({
    now: NOW,
    preorderReleaseEvents: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        order_id: order.id,
        created_at: "2026-08-11T17:58:00.000Z",
        orders: order
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        order_id: order.id,
        created_at: "2026-08-11T17:59:00.000Z",
        orders: order
      }
    ]
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].email_for, "Pre-order ready-for-pickup update");
  assert.equal(rows[0].status, "Consolidating");
  assert.match(rows[0].pending_for, /5-minute consolidation window/u);
  assert.equal(rows[0].queued_at, "2026-08-11T17:58:00.000Z");
});

test("the Email List sheet renders a separate queue panel without changing marketing rows", () => {
  const appsScript = fs.readFileSync(
    new URL("../apps-script/inventory-sync.gs", import.meta.url),
    "utf8"
  );
  const route = fs.readFileSync(
    new URL("../app/api/admin/email-signups/route.js", import.meta.url),
    "utf8"
  );

  assert.match(appsScript, /const pendingEmails = Array\.isArray\(response\?\.pending_emails\)/u);
  assert.match(
    appsScript,
    /"Queued At",\s*"Recipient",\s*"Email For",\s*"Status",\s*"Pending For",\s*"Order ID"/u
  );
  assert.match(appsScript, /getRange\(CONFIG\.EMAIL_SIGNUPS\.START_ROW, 13, pendingEmailRows\.length, 6\)/u);
  assert.match(route, /\.from\("email_jobs"\)/u);
  assert.match(route, /\.from\("preorder_release_events"\)/u);
  assert.match(route, /pending_emails: buildPendingEmailQueueRows/u);
});
