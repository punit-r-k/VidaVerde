import { stripeRequest } from "./stripe";
import {
  getStripeChargeFinancialState,
  getStripePaymentIntentId
} from "./stripeOrderIntegrity";

const toStripeId = (value, prefix) => {
  const candidate = typeof value === "object" ? value?.id : value;
  const normalized = typeof candidate === "string" ? candidate.trim() : "";
  return new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(normalized)
    ? normalized
    : "";
};

const toIsoTimestamp = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

const fail = (code) => ({ ok: false, code });

export async function resolveStripePaymentIntentFinancialState({
  intent,
  charge,
  paidEffectiveAt
} = {}) {
  const paymentIntentId = getStripePaymentIntentId(intent);
  const chargeId = toStripeId(charge, "ch");
  const normalizedPaidEffectiveAt = toIsoTimestamp(paidEffectiveAt);
  if (!paymentIntentId || !chargeId || !normalizedPaidEffectiveAt) {
    return fail("invalid_payment_state_reference");
  }

  let observedAt = new Date().toISOString();
  let state = getStripeChargeFinancialState({ charge });
  if (!state.ok && state.code !== "dispute_state_missing") {
    return state;
  }

  if (state.code === "dispute_state_missing") {
    let result;
    try {
      result = await stripeRequest(
        `/v1/disputes?charge=${encodeURIComponent(chargeId)}&limit=100`,
        { method: "GET" }
      );
    } catch {
      return fail("dispute_lookup_failed");
    }
    observedAt = new Date().toISOString();

    if (!result.ok) return fail("dispute_lookup_failed");
    const list = result.data;
    const disputes = Array.isArray(list?.data) ? list.data : null;
    if (list?.object !== "list" || !disputes || list?.has_more === true) {
      return fail("invalid_dispute_list");
    }

    const referencesMatch = disputes.every((dispute) => {
      const disputeChargeId = toStripeId(dispute?.charge, "ch");
      const disputePaymentIntentId = getStripePaymentIntentId(dispute);
      const modeMatches =
        typeof dispute?.livemode !== "boolean" ||
        typeof intent?.livemode !== "boolean" ||
        dispute.livemode === intent.livemode;

      return disputeChargeId === chargeId &&
        (!disputePaymentIntentId || disputePaymentIntentId === paymentIntentId) &&
        modeMatches;
    });
    if (!referencesMatch) return fail("dispute_reference_mismatch");

    state = getStripeChargeFinancialState({ charge, disputes });
    if (!state.ok) return state;
  }

  return {
    ...state,
    // Preserve the triggering Stripe event time as the primary version. An
    // older handler can finish its authoritative lookup later than a newer
    // event, so lookup completion time is only a database tie-breaker.
    effectiveAt: normalizedPaidEffectiveAt,
    observedAt
  };
}
