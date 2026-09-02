import {
  buyEasyPostShipment,
  getEasyPostShipment
} from "@/lib/easypost";
import {
  createEasyPostRatingContext,
  getEasyPostQuotesForParcels
} from "@/lib/shippingQuotes";
import { isShippingQuoteUsable } from "@/lib/shippingOperationsPolicy";
import { getOrCreateCompatibleReleaseQuote } from "@/lib/shipmentReleaseQuoteReuse";
import {
  getShipmentReleaseBlockReason,
  SHIPMENT_RELEASE_LEASE_MS,
  summarizeShipmentReleaseQuote
} from "@/lib/shipmentReleasePolicy";
import { chooseFastestQuote } from "@/lib/shippingRateRanking";
import { buildShippingPlans } from "@/lib/shippingParcels";
import {
  EXPEDITED_SHIPPING_OPTION_ID,
  getShippingTransitWindow,
  NORMAL_SHIPPING_OPTION_ID,
  normalizeShippingOptionId
} from "@/lib/shippingPricing";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const CLAIM_TIMEOUT_MS = SHIPMENT_RELEASE_LEASE_MS;
const QUOTE_LIFETIME_MS = 60 * 60 * 1000;
export const LABEL_PURCHASE_WORKER_BUDGET_MS = 45_000;
export const LABEL_PURCHASE_REQUEST_TIMEOUT_MS = 10_000;

const getPurchaseRequestTimeoutMs = (deadlineAt) => {
  const remainingMs = Math.floor(Number(deadlineAt) - Date.now());
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    throw new Error("The label purchase time budget was exhausted.");
  }
  return Math.min(remainingMs, LABEL_PURCHASE_REQUEST_TIMEOUT_MS);
};

const hasPurchasedPostage = (shipment) =>
  Boolean(shipment?.postage_label?.label_url && shipment?.tracking_code);

const hasShipmentPurchaseEvidence = async (shipment) => {
  if (
    shipment?.label_purchased_at ||
    String(shipment?.label_url || "").trim() ||
    String(shipment?.tracking_number || "").trim()
  ) {
    return true;
  }

  const { count, error } = await supabaseAdmin
    .from("shipment_parcels")
    .select("id", { count: "exact", head: true })
    .eq("shipment_id", shipment.id)
    .in("status", ["label_purchased", "shipped", "delivered"]);
  if (error) throw error;
  return Number(count || 0) > 0;
};

const stopIneligiblePurchase = async (
  shipment,
  errorMessage,
  { keepPending = false } = {}
) => {
  const preservePurchasedWork = await hasShipmentPurchaseEvidence(shipment);
  await supabaseAdmin
    .from("shipments")
    .update({
      status: keepPending || preservePurchasedWork ? "pending_label" : "cancelled",
      label_purchase_started_at: null,
      label_purchase_error: errorMessage,
      updated_at: new Date().toISOString()
    })
    .eq("id", shipment.id)
    .eq("status", "purchasing_label")
    .eq("label_purchase_started_at", shipment.label_purchase_started_at);
};

const quoteUsesOneCarrier = (quote) => {
  const parcels = Array.isArray(quote?.quote_json?.parcels)
    ? quote.quote_json.parcels
    : [];
  const carriers = new Set(
    parcels
      .map((parcel) => String(parcel?.selectedRate?.carrier || "").trim().toLowerCase())
      .filter(Boolean)
  );
  return parcels.length > 0 && carriers.size === 1;
};

const getShipmentServiceLevel = (shipment) => {
  const rawServiceLevel = String(shipment?.shipping_option || "").trim();
  if (!rawServiceLevel) return { serviceLevel: "fastest", transitWindow: null };
  const serviceLevel = normalizeShippingOptionId(rawServiceLevel);
  if (serviceLevel === NORMAL_SHIPPING_OPTION_ID) {
    return {
      serviceLevel,
      transitWindow: getShippingTransitWindow(serviceLevel)
    };
  }
  if (serviceLevel === EXPEDITED_SHIPPING_OPTION_ID) {
    return {
      serviceLevel,
      transitWindow: getShippingTransitWindow(serviceLevel)
    };
  }
  return { serviceLevel: "fastest", transitWindow: null };
};

const getClaimedShipment = async (shipmentId, quoteId) => {
  const claimedAt = new Date().toISOString();
  const claimPayload = {
    status: "purchasing_label",
    label_purchase_started_at: claimedAt,
    active_release_quote_id: quoteId,
    label_purchase_error: null,
    updated_at: claimedAt
  };
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("shipments")
    .update(claimPayload)
    .eq("id", shipmentId)
    .eq("status", "pending_label")
    .select("*")
    .maybeSingle();

  if (claimError) throw claimError;
  if (claimed) return { state: "claimed", shipment: claimed };

  const { data: current, error: currentError } = await supabaseAdmin
    .from("shipments")
    .select("*")
    .eq("id", shipmentId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) return { state: "missing", shipment: null };
  if (["label_purchased", "shipped", "delivered"].includes(current.status)) {
    return { state: "complete", shipment: current };
  }
  if (current.status !== "purchasing_label") {
    return { state: "unavailable", shipment: current };
  }

  const claimStartedAt = new Date(current.label_purchase_started_at || 0).getTime();
  if (Number.isFinite(claimStartedAt) && Date.now() - claimStartedAt < CLAIM_TIMEOUT_MS) {
    return { state: "in_progress", shipment: current };
  }

  let reclaimQuery = supabaseAdmin
    .from("shipments")
    .update(claimPayload)
    .eq("id", shipmentId)
    .eq("status", "purchasing_label");
  reclaimQuery = current.label_purchase_started_at == null
    ? reclaimQuery.is("label_purchase_started_at", null)
    : reclaimQuery.eq("label_purchase_started_at", current.label_purchase_started_at);
  const { data: reclaimed, error: reclaimError } = await reclaimQuery
    .select("*")
    .maybeSingle();
  if (reclaimError) throw reclaimError;

  return reclaimed
    ? { state: "claimed", shipment: reclaimed }
    : { state: "in_progress", shipment: current };
};

const normalizeParcelPlan = (parcels) => (Array.isArray(parcels) ? parcels : [])
  .map((parcel) => ({
    family: parcel?.family,
    packageCode: parcel?.packageCode,
    supplier: parcel?.supplier,
    quantity: parcel?.quantity,
    skus: Array.isArray(parcel?.skus) ? parcel.skus : [],
    length: Number(parcel?.length),
    width: Number(parcel?.width),
    height: Number(parcel?.height),
    weightOz: Number(parcel?.weightOz),
    boxCostCents: Number(parcel?.boxCostCents || 0)
  }))
  .filter((parcel) =>
    parcel.family &&
    parcel.packageCode &&
    parcel.quantity > 0 &&
    parcel.length > 0 &&
    parcel.width > 0 &&
    parcel.height > 0 &&
    parcel.weightOz > 0
  );

const getReleaseParcelPlan = async (shipment) => {
  const paymentSessionId = String(shipment?.payment_session_id || "").trim();
  if (paymentSessionId) {
    const { data: checkoutQuote, error } = await supabaseAdmin
      .from("checkout_shipping_quotes")
      .select("id, quote_json")
      .eq("payment_session_id", paymentSessionId)
      .neq("status", "cancelled")
      .maybeSingle();
    if (error) throw error;
    const parcels = normalizeParcelPlan(checkoutQuote?.quote_json?.parcels);
    if (parcels.length > 0) {
      return {
        planKey: String(checkoutQuote.quote_json?.planKey || checkoutQuote.id),
        parcels
      };
    }
  }

  const { data: savedQuote, error: savedQuoteError } = await supabaseAdmin
    .from("shipment_quotes")
    .select("plan_key, quote_json")
    .eq("shipment_id", shipment.id)
    .not("plan_key", "like", "RELEASE__%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (savedQuoteError) throw savedQuoteError;
  const savedParcels = normalizeParcelPlan(savedQuote?.quote_json?.parcels);
  if (savedParcels.length > 0) {
    return {
      planKey: String(savedQuote.quote_json?.planKey || savedQuote.plan_key || "saved"),
      parcels: savedParcels
    };
  }

  const fallback = buildShippingPlans(shipment.items_json)[0];
  const fallbackParcels = normalizeParcelPlan(fallback?.parcels);
  if (fallbackParcels.length === 0) {
    throw new Error("This shipment has no parcel plan to release.");
  }
  return { planKey: fallback.key, parcels: fallbackParcels };
};

const loadReleaseQuoteCandidates = async (shipment) => {
  const { data: candidates, error } = await supabaseAdmin
    .from("shipment_quotes")
    .select("*")
    .eq("shipment_id", shipment.id)
    .like("plan_key", "RELEASE__%")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return candidates || [];
};

const releaseQuoteHasPurchases = async (shipment, quote) => {
  const { count, error } = await supabaseAdmin
    .from("shipment_parcels")
    .select("id", { count: "exact", head: true })
    .eq("shipment_id", shipment.id)
    .eq("quote_id", quote.id);
  if (error) throw error;
  return Number(count || 0) > 0;
};

const saveReleaseQuote = async (shipment, parcelPlan, ratingContext) => {
  const { serviceLevel, transitWindow } = getShipmentServiceLevel(shipment);
  const quotes = await getEasyPostQuotesForParcels(shipment, {
    parcels: parcelPlan.parcels,
    planKey: parcelPlan.planKey,
    serviceLevel,
    transitWindow,
    ratingContext
  });
  const selectedQuote = chooseFastestQuote(quotes);
  if (!selectedQuote) throw new Error("EasyPost returned no shipping rates.");
  const quote = {
    ...selectedQuote,
    releaseShippingOption: String(shipment.shipping_option || ""),
    releaseShippingTier: String(shipment.shipping_tier || "")
  };

  const expiresAt = new Date(Date.now() + QUOTE_LIFETIME_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("shipment_quotes")
    .insert({
      shipment_id: shipment.id,
      provider: "easypost",
      plan_key: `RELEASE__${quote.planKey}`,
      postage_cents: quote.postageCents,
      box_cost_cents: quote.boxCostCents,
      total_cost_cents: quote.totalCostCents,
      currency: "USD",
      quote_json: quote,
      expires_at: expiresAt
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
};

const getCheckoutReleaseQuote = async (shipment) => {
  const paymentSessionId = String(shipment?.payment_session_id || "").trim();
  if (!paymentSessionId) return null;
  const { data: checkoutQuote, error } = await supabaseAdmin
    .from("checkout_shipping_quotes")
    .select("*")
    .eq("payment_session_id", paymentSessionId)
    .in("status", ["attached", "purchased"])
    .maybeSingle();
  if (error) throw error;
  if (!checkoutQuote || !isShippingQuoteUsable(checkoutQuote)) return null;

  const planKey = `CHECKOUT__${checkoutQuote.id}`;
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("shipment_quotes")
    .select("*")
    .eq("shipment_id", shipment.id)
    .eq("plan_key", planKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;

  const { data, error: insertError } = await supabaseAdmin
    .from("shipment_quotes")
    .insert({
      shipment_id: shipment.id,
      provider: "easypost",
      plan_key: planKey,
      postage_cents: checkoutQuote.postage_cents,
      box_cost_cents: checkoutQuote.packaging_cents,
      total_cost_cents: checkoutQuote.postage_cents + checkoutQuote.packaging_cents,
      currency: "USD",
      quote_json: {
        ...checkoutQuote.quote_json,
        checkoutQuoteId: checkoutQuote.id,
        releaseShippingOption: String(shipment.shipping_option || ""),
        releaseShippingTier: String(shipment.shipping_tier || "")
      },
      expires_at: checkoutQuote.expires_at
    })
    .select("*")
    .single();
  if (insertError) throw insertError;
  return data;
};

const getPartialPurchaseQuote = async (shipmentId) => {
  const { data: parcels, error: parcelsError } = await supabaseAdmin
    .from("shipment_parcels")
    .select("quote_id")
    .eq("shipment_id", shipmentId)
    .order("parcel_index", { ascending: true });
  if (parcelsError) throw parcelsError;

  const quoteId = (parcels || []).find((parcel) => parcel.quote_id)?.quote_id;
  if (!quoteId) return null;

  const { data: quote, error: quoteError } = await supabaseAdmin
    .from("shipment_quotes")
    .select("*")
    .eq("shipment_id", shipmentId)
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError) throw quoteError;
  // A partially purchased quote must be resumed to avoid buying duplicate labels.
  return quote;
};

const getRecoveryQuote = async (shipment) => {
  const activeQuoteId = String(shipment?.active_release_quote_id || "").trim();
  if (activeQuoteId) {
    const { data, error } = await supabaseAdmin
      .from("shipment_quotes")
      .select("*")
      .eq("id", activeQuoteId)
      .eq("shipment_id", shipment.id)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  return getPartialPurchaseQuote(shipment.id);
};

const getPurchasedShipment = async (parcel, assertEligible, deadlineAt) => {
  const existing = await getEasyPostShipment(parcel.easyPostShipmentId, {
    timeoutMs: getPurchaseRequestTimeoutMs(deadlineAt)
  });
  if (hasPurchasedPostage(existing)) return existing;

  try {
    await assertEligible();
    return await buyEasyPostShipment(
      parcel.easyPostShipmentId,
      parcel.selectedRate.id,
      { timeoutMs: getPurchaseRequestTimeoutMs(deadlineAt) }
    );
  } catch (error) {
    try {
      const recovered = await getEasyPostShipment(parcel.easyPostShipmentId, {
        timeoutMs: getPurchaseRequestTimeoutMs(deadlineAt)
      });
      if (hasPurchasedPostage(recovered)) return recovered;
    } catch {
      // A later lease retries the same EasyPost shipment and recovers a buy
      // that completed at the provider after our local deadline.
    }
    throw error;
  }
};

const purchaseQuote = async (shipment, quote, assertEligible, deadlineAt) => {
  const parcels = Array.isArray(quote?.quote_json?.parcels)
    ? quote.quote_json.parcels
    : [];
  if (parcels.length === 0) throw new Error("The selected EasyPost quote has no parcels.");

  const purchased = [];
  for (let index = 0; index < parcels.length; index += 1) {
    await assertEligible();
    const parcel = parcels[index];
    const parcelIndex = index + 1;
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("shipment_parcels")
      .select("*")
      .eq("shipment_id", shipment.id)
      .eq("parcel_index", parcelIndex)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      purchased.push(existing);
      continue;
    }

    const bought = await getPurchasedShipment(parcel, assertEligible, deadlineAt);
    const label = bought.postage_label || {};
    const actualPostageCents = Math.round(Number(bought.selected_rate?.rate || 0) * 100);
    const record = {
      shipment_id: shipment.id,
      quote_id: quote.id,
      parcel_index: parcelIndex,
      product_family: parcel.family,
      package_code: parcel.packageCode,
      supplier: parcel.supplier,
      item_quantity: parcel.quantity,
      length: parcel.length,
      width: parcel.width,
      height: parcel.height,
      weight_oz: parcel.weightOz,
      box_cost_cents: parcel.boxCostCents,
      easypost_shipment_id: bought.id,
      easypost_rate_id: parcel.selectedRate.id,
      postage_cents: actualPostageCents > 0
        ? actualPostageCents
        : parcel.selectedRate.amountCents,
      carrier: bought.selected_rate?.carrier || parcel.selectedRate.carrier,
      service: bought.selected_rate?.service || parcel.selectedRate.service,
      tracking_number: bought.tracking_code || "",
      label_url: label.label_url || "",
      label_pdf_url: label.label_pdf_url || "",
      status: "label_purchased",
      purchased_at: new Date().toISOString()
    };
    const { data: saved, error: parcelError } = await supabaseAdmin
      .from("shipment_parcels")
      .upsert(record, { onConflict: "shipment_id,parcel_index" })
      .select("*")
      .single();
    if (parcelError) throw parcelError;
    purchased.push(saved);
  }

  const first = purchased[0];
  const completedAt = new Date().toISOString();
  await assertEligible();
  const { data: completedShipment, error: updateError } = await supabaseAdmin
    .from("shipments")
    .update({
      status: "label_purchased",
      label_provider: "easypost",
      label_url: first?.label_pdf_url || first?.label_url || "",
      tracking_number: purchased
        .map((parcel) => parcel.tracking_number)
        .filter(Boolean)
        .join(", "),
      carrier: [...new Set(purchased.map((parcel) => parcel.carrier).filter(Boolean))].join(", "),
      service: [...new Set(purchased.map((parcel) => parcel.service).filter(Boolean))].join(", "),
      label_purchased_at: completedAt,
      label_purchase_started_at: null,
      label_purchase_error: null,
      updated_at: completedAt
    })
    .eq("id", shipment.id)
    .eq("status", "purchasing_label")
    .eq("label_purchase_started_at", shipment.label_purchase_started_at)
    .select("id")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!completedShipment) {
    throw new Error(
      "Label purchase eligibility changed after postage was purchased. Operator review is required."
    );
  }

  const { error: checkoutQuoteUpdateError } = await supabaseAdmin
    .from("checkout_shipping_quotes")
    .update({
      status: "purchased",
      updated_at: completedAt
    })
    .eq("payment_session_id", shipment.payment_session_id)
    .eq("status", "attached");
  if (checkoutQuoteUpdateError) {
    console.error("checkout shipping quote completion failed:", checkoutQuoteUpdateError.message);
  }

  return purchased;
};

const reserveLabelPurchaseUsage = async (quote) => {
  const checkoutQuoteId = String(quote?.quote_json?.checkoutQuoteId || "").trim();
  if (!checkoutQuoteId) return;
  const { count, error: readError } = await supabaseAdmin
    .from("easypost_usage_ledger")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "label_purchased")
    .eq("quote_id", checkoutQuoteId);
  if (readError) throw new Error("EasyPost label usage could not be recorded.", { cause: readError });
  if (Number(count || 0) > 0) return;
  const parcelCount = Array.isArray(quote?.quote_json?.parcels)
    ? quote.quote_json.parcels.length
    : 0;
  const { error } = await supabaseAdmin.from("easypost_usage_ledger").insert({
    event_type: "label_purchased",
    quote_id: checkoutQuoteId,
    labels_purchased: parcelCount
  });
  if (error) throw new Error("EasyPost label usage could not be recorded.", { cause: error });
};

const recordPurchaseFailure = async (shipment, error) => {
  const failedAt = new Date().toISOString();
  await supabaseAdmin
    .from("shipments")
    .update({
      status: "pending_label",
      label_purchase_started_at: null,
      label_purchase_error: String(error?.message || error || "EasyPost label purchase failed.").slice(0, 500),
      updated_at: failedAt
    })
    .eq("id", shipment.id)
    .eq("status", "purchasing_label")
    .eq("label_purchase_started_at", shipment.label_purchase_started_at);
};

const getShipmentOrderState = async (shipment) => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("status, fulfillment, is_test_order, amount_shipping")
    .eq("id", shipment.order_id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

const hasOutstandingPreorders = async (orderId) => {
  const { count, error } = await supabaseAdmin
    .from("preorder_queue")
    .select("id", { count: "exact", head: true })
    .eq("order_id", orderId)
    .gt("remaining", 0);
  if (error) throw error;
  return Number(count || 0) > 0;
};

const assertPurchaseLeaseEligible = async (shipment) => {
  const { data: currentShipment, error } = await supabaseAdmin
    .from("shipments")
    .select(
      "id, status, label_purchase_started_at, orders!inner(status, fulfillment, is_test_order)"
    )
    .eq("id", shipment.id)
    .maybeSingle();
  if (error) throw error;

  const order = Array.isArray(currentShipment?.orders)
    ? currentShipment.orders[0]
    : currentShipment?.orders;
  const leaseMatches =
    currentShipment?.status === "purchasing_label" &&
    String(currentShipment?.label_purchase_started_at || "") ===
      String(shipment.label_purchase_started_at || "");
  if (
    !leaseMatches ||
    order?.status !== "paid" ||
    order?.fulfillment !== "ship" ||
    order?.is_test_order === true ||
    await hasOutstandingPreorders(shipment.order_id)
  ) {
    throw new Error("Label purchase eligibility changed before postage was purchased.");
  }
};

const getShipmentForRelease = async (shipmentId) => {
  const { data, error } = await supabaseAdmin
    .from("shipments")
    .select("*")
    .eq("id", shipmentId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
};

const getReleaseBlockReason = async (shipment) => {
  const order = shipment ? await getShipmentOrderState(shipment) : null;
  const outstandingPreorders = shipment
    ? await hasOutstandingPreorders(shipment.order_id)
    : false;
  return getShipmentReleaseBlockReason({
    shipment,
    order,
    hasOutstandingPreorders: outstandingPreorders
  });
};

export async function getShippingLabelReleaseEligibility(shipmentId) {
  if (!supabaseAdmin) throw new Error("Shipping data is not connected.");
  const shipment = await getShipmentForRelease(shipmentId);
  const blockReason = await getReleaseBlockReason(shipment);
  return {
    shipment,
    eligible: Boolean(shipment) && !blockReason,
    blockReason
  };
}

export async function createShippingLabelReleaseQuote(shipmentId) {
  if (!supabaseAdmin) throw new Error("Shipping data is not connected.");

  const shipment = await getShipmentForRelease(shipmentId);
  const blockReason = await getReleaseBlockReason(shipment);
  if (!shipment) return { ok: false, state: "missing", error: blockReason };
  if (blockReason) return { ok: false, state: "unavailable", error: blockReason };

  const order = await getShipmentOrderState(shipment);
  const recoveryQuote = await getRecoveryQuote(shipment);
  if (recoveryQuote) {
    if (!quoteUsesOneCarrier(recoveryQuote)) {
      throw new Error("The partial label purchase needs operator review.");
    }
    return {
      ok: true,
      state: "quoted",
      resumed: true,
      quote: recoveryQuote,
      summary: summarizeShipmentReleaseQuote({ shipment, quote: recoveryQuote, order })
    };
  }

  const checkoutQuote = await getCheckoutReleaseQuote(shipment);
  if (checkoutQuote) {
    return {
      ok: true,
      state: "quoted",
      resumed: false,
      providerCalls: 0,
      quote: checkoutQuote,
      summary: summarizeShipmentReleaseQuote({ shipment, quote: checkoutQuote, order })
    };
  }

  const parcelPlan = await getReleaseParcelPlan(shipment);
  const { quote, reused } = await getOrCreateCompatibleReleaseQuote({
    shipment,
    parcelPlan,
    loadCandidates: () => loadReleaseQuoteCandidates(shipment),
    hasPurchases: (candidate) => releaseQuoteHasPurchases(shipment, candidate),
    createQuote: () => saveReleaseQuote(
      shipment,
      parcelPlan,
      createEasyPostRatingContext({ deadlineAt: Date.now() + LABEL_PURCHASE_WORKER_BUDGET_MS })
    )
  });
  return {
    ok: true,
    state: "quoted",
    resumed: false,
    providerCalls: reused ? 0 : 1 + parcelPlan.parcels.length,
    quote,
    summary: summarizeShipmentReleaseQuote({ shipment, quote, order })
  };
}

const getConfirmedReleaseQuote = async (shipment, quoteId) => {
  const { data: quote, error } = await supabaseAdmin
    .from("shipment_quotes")
    .select("*")
    .eq("id", quoteId)
    .eq("shipment_id", shipment.id)
    .maybeSingle();
  if (error) throw error;
  if (!quote) throw new Error("The confirmed release quote was not found.");

  const recoveryQuote = await getRecoveryQuote(shipment);
  const isRecovery = recoveryQuote?.id === quote.id;
  if (shipment.active_release_quote_id && !isRecovery) {
    throw new Error("This shipment must resume its original release quote.");
  }
  if (
    !String(quote.plan_key || "").startsWith("RELEASE__") &&
    !String(quote.plan_key || "").startsWith("CHECKOUT__") &&
    !isRecovery
  ) {
    throw new Error("Only an explicitly previewed release quote can purchase labels.");
  }
  if (!quoteUsesOneCarrier(quote)) {
    throw new Error("The confirmed release quote must use one carrier for every parcel.");
  }
  if (!isRecovery && (
    String(quote?.quote_json?.releaseShippingOption || "") !==
      String(shipment.shipping_option || "") ||
    String(quote?.quote_json?.releaseShippingTier || "") !==
      String(shipment.shipping_tier || "")
  )) {
    throw new Error("The shipment method changed after preview. Preview it again before purchasing.");
  }
  if (!isShippingQuoteUsable(quote, { hasPurchasedParcels: isRecovery })) {
    throw new Error("The release quote expired. Preview the shipment again before purchasing.");
  }
  return quote;
};

export async function purchaseReleasedShippingLabels(shipmentId, { quoteId } = {}) {
  if (!supabaseAdmin) throw new Error("Shipping data is not connected.");
  if (!String(quoteId || "").trim()) {
    throw new Error("Confirm a release quote before purchasing labels.");
  }

  const candidate = await getShipmentForRelease(shipmentId);
  if (!candidate) return { ok: false, state: "missing", parcels: [] };
  if (["label_purchased", "shipped", "delivered"].includes(candidate.status)) {
    const releasedWithQuote = String(candidate.active_release_quote_id || "") === String(quoteId);
    return releasedWithQuote
      ? { ok: true, state: "complete", parcels: [] }
      : { ok: false, state: "unavailable", parcels: [] };
  }
  const blockReason = await getReleaseBlockReason(candidate);
  if (blockReason) {
    return { ok: false, state: "unavailable", error: blockReason, parcels: [] };
  }
  const confirmedQuote = await getConfirmedReleaseQuote(candidate, String(quoteId).trim());

  const claim = await getClaimedShipment(shipmentId, confirmedQuote.id);
  if (claim.state !== "claimed") {
    return {
      ok: claim.state === "complete" || claim.state === "in_progress",
      state: claim.state,
      parcels: []
    };
  }

  const shipment = claim.shipment;
  const workerDeadlineAt = Date.now() + LABEL_PURCHASE_WORKER_BUDGET_MS;
  try {
    const assertEligible = () => assertPurchaseLeaseEligible(shipment);
    const order = await getShipmentOrderState(shipment);
    if (!order || order.status !== "paid" || order.fulfillment !== "ship") {
      const disputeIsOpen = order?.status === "disputed" && order?.fulfillment === "ship";
      await stopIneligiblePurchase(
        shipment,
        disputeIsOpen
          ? "Label purchase paused while the payment dispute is open."
          : "Label purchase stopped because the order is not an active paid shipping order.",
        { keepPending: disputeIsOpen }
      );
      return { ok: true, state: "unavailable", parcels: [] };
    }

    if (order.is_test_order === true) {
      await stopIneligiblePurchase(
        shipment,
        "Financial test orders cannot be released for production labels."
      );
      return { ok: true, state: "test_order_skipped", parcels: [] };
    }

    const quotedShippingCostCents = Number(confirmedQuote.postage_cents || 0) +
      Number(confirmedQuote.box_cost_cents || 0);
    if (Number(order.amount_shipping || 0) < quotedShippingCostCents) {
      throw new Error(
        "The confirmed label cost exceeds customer shipping revenue. Record an explicit subsidy before purchasing."
      );
    }

    if (await hasOutstandingPreorders(shipment.order_id)) {
      await supabaseAdmin
        .from("shipments")
        .update({
          status: "pending_label",
          label_purchase_started_at: null,
          label_purchase_error: "Label purchase paused until all preorder items are ready.",
          updated_at: new Date().toISOString()
        })
        .eq("id", shipment.id)
        .eq("status", "purchasing_label")
        .eq("label_purchase_started_at", shipment.label_purchase_started_at);
      return { ok: true, state: "preorder_pending", parcels: [] };
    }

    await assertEligible();
    const partialPurchaseQuote = await getPartialPurchaseQuote(shipment.id);
    const quote = partialPurchaseQuote || confirmedQuote;
    if (quote.id !== confirmedQuote.id) {
      throw new Error("A partial label purchase must be resumed with its original release quote.");
    }
    if (!isShippingQuoteUsable(quote, {
      hasPurchasedParcels: Boolean(partialPurchaseQuote)
    })) {
      throw new Error("The release quote expired. Preview the shipment again before purchasing.");
    }
    await reserveLabelPurchaseUsage(quote);
    const parcels = await purchaseQuote(
      shipment,
      quote,
      assertEligible,
      workerDeadlineAt
    );
    return { ok: true, state: "label_purchased", quote, parcels };
  } catch (error) {
    await recordPurchaseFailure(shipment, error);
    throw error;
  }
}
