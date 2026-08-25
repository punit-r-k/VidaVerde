import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import test from "node:test";

const loaderSource = `
  import path from "node:path";
  import { pathToFileURL } from "node:url";

  export async function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const relativePath = specifier.slice(2);
      const filePath = path.join(process.cwd(), relativePath) +
        (path.extname(relativePath) ? "" : ".js");
      return { url: pathToFileURL(filePath).href, shortCircuit: true };
    }

    try {
      return await nextResolve(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !path.extname(specifier)
      ) {
        return nextResolve(specifier + ".js", context);
      }
      throw error;
    }
  }

  export async function load(url, context, nextLoad) {
    const result = await nextLoad(url, context);
    const pathname = url.startsWith("file:") ? new URL(url).pathname : "";
    if (pathname.endsWith(".js") && !pathname.includes("/node_modules/")) {
      return { ...result, format: "module" };
    }
    return result;
  }
`;

register(`data:text/javascript,${encodeURIComponent(loaderSource)}`);

const {
  buildEmailContent,
  ORDER_CONFIRMATION_BCC_RECIPIENTS,
  ORDER_CONFIRMATION_TRACKING_STATES,
  resolveOrderConfirmationTrackingState
} = await import("../lib/orderConfirmationEmail.js?email-reliability-test");
const {
  buildOrderConfirmationMessageId,
  getEmailJobDeliveryPolicy
} = await import("../lib/emailJobQueue.js?email-reliability-test");
const { getConsumerShippingDetails } = await import(
  "../lib/consumerShipping.js?email-reliability-test"
);
const { buildReadyEmailContent } = await import(
  "../lib/preorderReadyEmail.js?email-reliability-test"
);
const confirmationDispatchSource = fs.readFileSync(
  new URL("../lib/orderConfirmationDispatch.js", import.meta.url),
  "utf8"
);

const BASE_PREORDER_STATUS = {
  hasPreorderItems: false,
  hasReadyReservationItems: true,
  hasMixedReservationAndPreorderItems: false,
  readyReservationItems: [],
  preorderItems: []
};

const buildShippingEmail = ({
  customer = {},
  trackingState = ORDER_CONFIRMATION_TRACKING_STATES.AVAILABLE,
  trackingNumbers = ["TRACK-123"],
  shipmentTiming = {}
} = {}) => buildEmailContent({
  orderId: "11111111-1111-4111-8111-111111111111",
  fulfillment: "ship",
  currency: "usd",
  subtotal: 1199,
  tax: 99,
  shipping: 500,
  total: 1798,
  placedAt: "2026-08-02T12:00:00.000Z",
  receiptNumber: "receipt-1",
  paymentMethodLabel: "Visa ending in 4242",
  customer: {
    name: "Test Customer",
    email: "customer@example.com",
    address1: "10 Main St",
    city: "Houston",
    state: "TX",
    postal_code: "77002",
    ...customer
  },
  items: [{ sku: "VV1", name: "Red Coral", quantity: 1, price_cents: 1199 }],
  preorderStatus: BASE_PREORDER_STATUS,
  trackingNumbers,
  shipmentTiming,
  trackingState,
  pickupContext: { pickupScenario: "shipping" },
  hasPickupCalendarAttachment: false
});

test("order confirmations always BCC the three required business addresses", () => {
  assert.deepEqual([...ORDER_CONFIRMATION_BCC_RECIPIENTS], [
    "punit@peridotkonda.com",
    "vidaverdemicrogreens@gmail.com",
    "vvsauerkraut@gmail.com"
  ]);
  assert.match(
    fs.readFileSync(new URL("../lib/orderConfirmationEmail.js", import.meta.url), "utf8"),
    /bcc: ORDER_CONFIRMATION_BCC_RECIPIENTS/u
  );
});

test("confirmation emails replace legacy carrier metadata with canonical consumer details", () => {
  const email = buildShippingEmail({
    customer: {
      shipping_option: "normal",
      shipping_option_label: "UPSDAP Ground",
      shipping_estimate: "Estimated 1 business day after carrier receipt"
    }
  });
  const rendered = `${email.text}\n${email.html}`;

  assert.match(email.text, /Method: Shipping/);
  assert.match(email.text, /Expected arrival: Estimated delivery in 3–5 business days/);
  assert.match(email.text, /Shipment tracking:\n- TRACK-123/);
  assert.match(rendered, /Open and inspect the package/);
  assert.match(rendered, /burp each jar to release any existing gas, then refrigerate/i);
  assert.doesNotMatch(rendered, /\bUPSDAP\b|\bGround\b|carrier receipt|EasyPost/i);
});

test("expedited confirmation copy uses only the approved method and timing", () => {
  const email = buildShippingEmail({
    customer: {
      shipping_option: "expedited",
      shipping_option_label: "Legacy Express Carrier Service",
      shipping_estimate: "Legacy provider estimate"
    }
  });
  const rendered = `${email.text}\n${email.html}`;

  assert.match(email.text, /Method: Expedited Shipping/);
  assert.match(email.text, /Expected arrival: Estimated delivery in 1–3 business days/);
  assert.doesNotMatch(rendered, /Legacy Express Carrier Service|Legacy provider estimate/i);
});

test("confirmation emails preserve only an authoritative exact expected-arrival date", () => {
  const email = buildShippingEmail({
    customer: {
      shipping_option: "normal",
      shipping_option_label: "UPSDAP Ground",
      shipping_estimate: "Expected arrival: Thursday, August 6, 2026."
    }
  });
  const rendered = `${email.text}\n${email.html}`;

  assert.match(email.text, /Expected arrival: Thursday, August 6, 2026/);
  assert.match(email.html, /Thursday, August 6, 2026/);
  assert.equal(
    getConsumerShippingDetails({
      shipping_option: "normal",
      shipping_estimate: "Estimated 1 business day after carrier receipt"
    }).expectedArrivalText,
    "Estimated delivery in 3–5 business days after the estimated carrier-handoff date."
  );
  assert.doesNotMatch(rendered, /\bUPSDAP\b|\bGround\b|carrier receipt/i);
});

test("confirmation emails use purchased-quote timing instead of stale checkout timing", () => {
  const email = buildShippingEmail({
    customer: {
      shipping_option: "normal",
      shipping_estimate: "Expected arrival: Thursday, August 6, 2026."
    },
    shipmentTiming: {
      estimatedShipDate: "2026-08-12",
      expectedArrivalDate: "2026-08-17"
    }
  });
  const rendered = `${email.text}\n${email.html}`;

  assert.match(rendered, /Estimated carrier-handoff date: Wed, Aug 12/);
  assert.match(rendered, /Expected arrival: Mon, Aug 17/);
  assert.doesNotMatch(rendered, /August 6, 2026/);
});

test("preorder-ready shipping templates show readable timing, handling, and tracking without internals", () => {
  const baseOrder = {
    orderId: "11111111-1111-4111-8111-111111111111",
    fulfillment: "ship",
    customerName: "Test Customer",
    customerEmail: "customer@example.com",
    address1: "10 Main St",
    city: "Houston",
    state: "TX",
    postalCode: "77002",
    shippingOption: "normal",
    emailReferenceTime: "2026-08-02T12:00:00.000Z",
    readyItems: [{ sku: "VV1", name: "Red Coral", quantity: 1 }],
    fullPickupItems: [{ sku: "VV1", name: "Red Coral", quantity: 1 }],
    pendingItems: [],
    trackingNumbers: ["TRACK-123"],
    releaseEventIds: ["22222222-2222-4222-8222-222222222222"]
  };
  const live = buildReadyEmailContent({
    order: baseOrder,
    pickupDetails: {},
    hasRemainingPreorders: false,
    hasPickupCalendarAttachment: false
  });
  const liveRendered = `${live.text}\n${live.html}`;

  assert.match(live.text, /Method: Shipping/);
  assert.match(live.text, /Estimated carrier-handoff date:/);
  assert.match(live.text, /Expected arrival:/);
  assert.match(liveRendered, /Open and inspect the package/);
  assert.match(liveRendered, /TRACK-123/);
  assert.doesNotMatch(liveRendered, /EasyPost|postage|packaging|shipping label|carrier receipt/i);

  const financialTest = buildReadyEmailContent({
    order: {
      ...baseOrder,
      isTestOrder: true,
      trackingNumbers: []
    },
    pickupDetails: {},
    hasRemainingPreorders: false,
    hasPickupCalendarAttachment: false
  });
  const testRendered = `${financialTest.text}\n${financialTest.html}`;
  assert.match(testRendered, /tracking (?:is not|number is not|is) generated for test orders/i);
  assert.doesNotMatch(testRendered, /shipping label|postage|packaging|EasyPost/i);
});

test("tracking states produce explicit preorder, test, and available behavior", () => {
  assert.equal(
    resolveOrderConfirmationTrackingState({
      fulfillment: "ship",
      trackingNumbers: ["TRACK-1"]
    }),
    ORDER_CONFIRMATION_TRACKING_STATES.AVAILABLE
  );
  assert.equal(
    resolveOrderConfirmationTrackingState({
      fulfillment: "ship",
      hasPreorderItems: true
    }),
    ORDER_CONFIRMATION_TRACKING_STATES.PREORDER_PENDING
  );
  assert.equal(
    resolveOrderConfirmationTrackingState({
      fulfillment: "ship",
      isTestOrder: true
    }),
    ORDER_CONFIRMATION_TRACKING_STATES.TEST_NOT_APPLICABLE
  );
  assert.equal(
    resolveOrderConfirmationTrackingState({
      fulfillment: "ship",
      isTestOrder: true,
      allowTestShipping: true,
      trackingNumbers: ["TEST-TRACKING-1"]
    }),
    ORDER_CONFIRMATION_TRACKING_STATES.AVAILABLE
  );
  assert.equal(
    resolveOrderConfirmationTrackingState({
      fulfillment: "ship",
      isTestOrder: true,
      allowTestShipping: true
    }),
    ORDER_CONFIRMATION_TRACKING_STATES.PENDING
  );
  assert.equal(
    resolveOrderConfirmationTrackingState({ fulfillment: "ship" }),
    ORDER_CONFIRMATION_TRACKING_STATES.PENDING
  );
  assert.equal(
    resolveOrderConfirmationTrackingState({ fulfillment: "market" }),
    null
  );

  const preorderEmail = buildShippingEmail({
    trackingState: ORDER_CONFIRMATION_TRACKING_STATES.PREORDER_PENDING,
    trackingNumbers: []
  });
  assert.match(preorderEmail.text, /Pending until your pre-order is ready/);

  const pendingEmail = buildShippingEmail({
    trackingState: ORDER_CONFIRMATION_TRACKING_STATES.PENDING,
    trackingNumbers: []
  });
  assert.match(pendingEmail.text, /email the tracking number when the shipment is prepared/i);
  assert.doesNotMatch(pendingEmail.text, /until your pre-order is ready/i);

  const testEmail = buildShippingEmail({
    trackingState: ORDER_CONFIRMATION_TRACKING_STATES.TEST_NOT_APPLICABLE,
    trackingNumbers: []
  });
  assert.match(testEmail.text, /Tracking is not generated for financial test orders/);
  assert.match(testEmail.html, /Not applicable/);
});

test("confirmation delivery is attempted immediately after its durable job is created", () => {
  const dispatch = confirmationDispatchSource.slice(
    confirmationDispatchSource.indexOf("export async function maybeSendCustomerConfirmationEmail"),
    confirmationDispatchSource.length
  );
  const enqueueIndex = dispatch.indexOf("await enqueueOrderConfirmationEmail(emailPayload)");
  const processIndex = dispatch.indexOf("await processOrderConfirmationEmailJob(queueResult.jobId)");

  assert.ok(enqueueIndex >= 0, "confirmation delivery must retain a durable job");
  assert.ok(processIndex > enqueueIndex, "the durable job must be processed immediately");
  assert.doesNotMatch(dispatch, /ORDER_CONFIRMATION_EMAIL_MODE|shouldQueueOrderConfirmationEmail/u);
});

test("message identity is deterministic and scoped to the configured sender domain", () => {
  const previous = process.env.ORDER_EMAIL_FROM;
  process.env.ORDER_EMAIL_FROM = "Vida Verde Orders <orders@example.com>";
  try {
    const first = buildOrderConfirmationMessageId(
      "11111111-1111-4111-8111-111111111111"
    );
    const second = buildOrderConfirmationMessageId(
      "11111111-1111-4111-8111-111111111111"
    );
    assert.equal(first, second);
    assert.equal(
      first,
      "<order-confirmation.11111111111141118111111111111111@example.com>"
    );
  } finally {
    if (previous === undefined) delete process.env.ORDER_EMAIL_FROM;
    else process.env.ORDER_EMAIL_FROM = previous;
  }
});

test("only actual SMTP failures consume the five-attempt delivery budget", () => {
  const previous = process.env.EMAIL_JOB_RETRY_DELAY_MS;
  delete process.env.EMAIL_JOB_RETRY_DELAY_MS;
  try {
    assert.deepEqual(getEmailJobDeliveryPolicy({
      ok: false,
      code: "smtp_failed"
    }), {
      outcome: "failed",
      code: "smtp_failed",
      consumeAttempt: true,
      terminal: false,
      retryDelayMs: 15 * 60 * 1000
    });

    assert.deepEqual(getEmailJobDeliveryPolicy({
      ok: false,
      code: "invalid_payload"
    }), {
      outcome: "failed",
      code: "invalid_payload",
      consumeAttempt: false,
      terminal: true,
      retryDelayMs: 0
    });

    const dependencyFailure = getEmailJobDeliveryPolicy({
      ok: false,
      code: "dependency_unavailable"
    });
    assert.equal(dependencyFailure.outcome, "deferred");
    assert.equal(dependencyFailure.consumeAttempt, false);
    assert.equal(dependencyFailure.retryDelayMs, 15 * 60 * 1000);
  } finally {
    if (previous === undefined) delete process.env.EMAIL_JOB_RETRY_DELAY_MS;
    else process.env.EMAIL_JOB_RETRY_DELAY_MS = previous;
  }
});
