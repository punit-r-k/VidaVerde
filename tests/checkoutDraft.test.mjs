import assert from "node:assert/strict";
import test from "node:test";
import {
  CHECKOUT_DRAFT_TTL_MS,
  getStoredShippingPreviewExpiration,
  sanitizeCheckoutDraft,
  sanitizeStoredShippingPreview
} from "../lib/checkoutDraft.js";

const NOW = Date.parse("2026-09-02T18:00:00.000Z");
const EXPIRES_AT = "2026-09-02T18:45:00.000Z";
const QUOTE_TOKEN = "123e4567-e89b-42d3-a456-426614174000";
const SESSION_TOKEN = "123e4567-e89b-42d3-b456-426614174001";

const preview = {
  requestFingerprint: "address-and-cart-fingerprint",
  options: [{
    quoteToken: QUOTE_TOKEN,
    expiresAt: EXPIRES_AT,
    id: "normal",
    label: "Shipping",
    amountCents: 1200,
    transitLabel: "Expected arrival: Tuesday.",
    deliveryEstimate: {
      minimum: { unit: "business_day", value: 3 },
      maximum: { unit: "business_day", value: 5 }
    },
    estimatedShipDate: "2026-09-05",
    estimatedShipDateLabel: "Saturday, September 5",
    expectedArrivalDate: "2026-09-08",
    expectedArrivalLabel: "Tuesday, September 8"
  }]
};

test("checkout drafts restore customer fields and an unexpired calculated quote", () => {
  const draft = sanitizeCheckoutDraft({
    version: 1,
    savedAt: NOW - 1_000,
    checkoutSessionToken: SESSION_TOKEN,
    formValues: {
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+1 (555) 123-4567",
      address1: "123 Main Street",
      address2: "Apt 4",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      note: "Leave by the front desk"
    },
    fulfillment: "ship",
    shippingOptionId: "normal",
    shippingPreview: preview
  }, { now: NOW });

  assert.equal(draft.formValues.name, "Ada Lovelace");
  assert.equal(draft.formValues.email, "ada@example.com");
  assert.equal(draft.formValues.address1, "123 Main Street");
  assert.equal(draft.fulfillment, "ship");
  assert.equal(draft.shippingOptionId, "normal");
  assert.equal(draft.checkoutSessionToken, SESSION_TOKEN);
  assert.equal(draft.shippingPreview.options[0].quoteToken, QUOTE_TOKEN);
  assert.equal(
    getStoredShippingPreviewExpiration(draft.shippingPreview),
    Date.parse(EXPIRES_AT)
  );
});

test("an expired calculated quote is dropped without losing entered checkout fields", () => {
  const draft = sanitizeCheckoutDraft({
    version: 1,
    savedAt: NOW - 1_000,
    checkoutSessionToken: SESSION_TOKEN,
    formValues: { name: "Ada Lovelace", email: "ada@example.com" },
    fulfillment: "ship",
    shippingOptionId: "normal",
    shippingPreview: preview
  }, { now: Date.parse("2026-09-02T19:00:00.000Z") });

  assert.equal(draft.formValues.name, "Ada Lovelace");
  assert.equal(draft.shippingPreview, null);
});

test("stale checkout drafts and inconsistent quote options fail closed", () => {
  assert.equal(sanitizeCheckoutDraft({
    version: 1,
    savedAt: NOW - CHECKOUT_DRAFT_TTL_MS - 1,
    formValues: {}
  }, { now: NOW }), null);

  assert.equal(sanitizeStoredShippingPreview({
    ...preview,
    options: [
      preview.options[0],
      {
        ...preview.options[0],
        id: "expedited",
        quoteToken: "123e4567-e89b-42d3-a456-426614174099"
      }
    ]
  }, { now: NOW }), null);
});
