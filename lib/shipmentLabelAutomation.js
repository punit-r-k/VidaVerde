import {
  buyEasyPostShipment,
  getEasyPostShipment,
  isEasyPostTestMode
} from "@/lib/easypost";
import { getShippingChargeBreakdown } from "@/lib/shippingCharge";
import { resolveCustomerShippingSelections } from "@/lib/shippingOptionPolicy";
import {
  createEasyPostRatingContext,
  getEasyPostQuotes
} from "@/lib/shippingQuotes";
import { isShippingQuoteUsable } from "@/lib/shippingOperationsPolicy";
import {
  chooseFastestQuote,
  getQuoteTransitDays
} from "@/lib/shippingRateRanking";
import {
  EXPEDITED_SHIPPING_OPTION_ID,
  getShippingOptionsForCart,
  getShippingTransitWindow,
  NORMAL_SHIPPING_OPTION_ID,
  normalizeShippingOptionId
} from "@/lib/shippingPricing";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
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

const getClaimedShipment = async (shipmentId) => {
  const claimedAt = new Date().toISOString();
  const claimPayload = {
    status: "purchasing_label",
    label_purchase_started_at: claimedAt,
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

const saveFastestQuote = async (shipment, ratingContext) => {
  const { serviceLevel, transitWindow } = getShipmentServiceLevel(shipment);
  let quote = null;

  if (serviceLevel === "fastest") {
    const quotes = await getEasyPostQuotes(shipment, {
      serviceLevel,
      transitWindow,
      ratingContext
    });
    quote = chooseFastestQuote(quotes);
  } else {
    const shipping = getShippingOptionsForCart({
      items: Array.isArray(shipment.items_json) ? shipment.items_json : []
    });
    const results = await Promise.allSettled(
      shipping.options.map(async (option) => {
        const quotes = await getEasyPostQuotes(shipment, {
          serviceLevel: option.id,
          transitWindow: getShippingTransitWindow(option.id),
          ratingContext
        });
        const selectedQuote = chooseFastestQuote(quotes);
        if (!selectedQuote) throw new Error("EasyPost returned no shipping rates.");
        return {
          quote: selectedQuote,
          charge: getShippingChargeBreakdown(selectedQuote),
          deliveryDays: getQuoteTransitDays(selectedQuote),
          option
        };
      })
    );
    const selections = new Map();
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        selections.set(shipping.options[index].id, result.value);
      }
    });
    const policy = resolveCustomerShippingSelections({
      normalSelection: selections.get(NORMAL_SHIPPING_OPTION_ID),
      expeditedSelection: selections.get(EXPEDITED_SHIPPING_OPTION_ID),
      normalOption: shipping.normalOption
    });
    const selection = serviceLevel === EXPEDITED_SHIPPING_OPTION_ID &&
      policy.expeditedSelection
      ? policy.expeditedSelection
      : policy.normalSelection;
    quote = selection?.quote || null;
    if (!quote) {
      const firstFailure = results.find((result) => result.status === "rejected");
      throw firstFailure?.reason || new Error("EasyPost returned no shipping rates.");
    }
  }

  if (!quote) throw new Error("EasyPost returned no shipping rates.");

  const expiresAt = new Date(Date.now() + QUOTE_LIFETIME_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from("shipment_quotes")
    .insert({
      shipment_id: shipment.id,
      provider: "easypost",
      plan_key: `AUTO__${quote.planKey}`,
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

const getSavedAutomaticQuote = async (shipmentId) => {
  const { data: quote, error: quoteError } = await supabaseAdmin
    .from("shipment_quotes")
    .select("*")
    .eq("shipment_id", shipmentId)
    .like("plan_key", "AUTO__%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (quoteError) throw quoteError;
  return quoteUsesOneCarrier(quote) && isShippingQuoteUsable(quote) ? quote : null;
};

const getCheckoutQuote = async (shipment) => {
  const { data: savedQuote, error: savedQuoteError } = await supabaseAdmin
    .from("shipment_quotes")
    .select("*")
    .eq("shipment_id", shipment.id)
    .like("plan_key", "CHECKOUT__%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (savedQuoteError) throw savedQuoteError;
  if (quoteUsesOneCarrier(savedQuote) && isShippingQuoteUsable(savedQuote)) {
    return savedQuote;
  }

  const paymentSessionId = String(shipment.payment_session_id || "").trim();
  if (!paymentSessionId) return null;

  const { data: checkoutQuote, error: checkoutQuoteError } = await supabaseAdmin
    .from("checkout_shipping_quotes")
    .select("*")
    .eq("payment_session_id", paymentSessionId)
    .in("status", ["quoted", "label_purchased"])
    .maybeSingle();
  if (checkoutQuoteError) throw checkoutQuoteError;
  if (
    !checkoutQuote?.quote_json ||
    !isShippingQuoteUsable(checkoutQuote) ||
    !quoteUsesOneCarrier({ quote_json: checkoutQuote.quote_json })
  ) return null;

  const { data: shipmentQuote, error: shipmentQuoteError } = await supabaseAdmin
    .from("shipment_quotes")
    .insert({
      shipment_id: shipment.id,
      provider: checkoutQuote.provider || "easypost",
      plan_key: `CHECKOUT__${checkoutQuote.id}`,
      postage_cents: checkoutQuote.postage_cents,
      box_cost_cents: checkoutQuote.packaging_cents,
      total_cost_cents: checkoutQuote.unrounded_cents,
      currency: checkoutQuote.currency || "USD",
      quote_json: checkoutQuote.quote_json,
      expires_at: checkoutQuote.expires_at
    })
    .select("*")
    .single();
  if (shipmentQuoteError) throw shipmentQuoteError;
  return shipmentQuote;
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
      status: "label_purchased",
      updated_at: completedAt
    })
    .eq("payment_session_id", shipment.payment_session_id)
    .eq("status", "quoted");
  if (checkoutQuoteUpdateError) {
    console.error("checkout shipping quote completion failed:", checkoutQuoteUpdateError.message);
  }

  return purchased;
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
    .select("status, fulfillment, is_test_order")
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
    (order?.is_test_order === true && !isEasyPostTestMode()) ||
    await hasOutstandingPreorders(shipment.order_id)
  ) {
    throw new Error("Label purchase eligibility changed before postage was purchased.");
  }
};

export async function autoPurchaseFastestShippingLabels(shipmentId) {
  if (!supabaseAdmin) throw new Error("Shipping data is not connected.");

  const claim = await getClaimedShipment(shipmentId);
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

    if (order.is_test_order === true && !isEasyPostTestMode()) {
      await stopIneligiblePurchase(
        shipment,
        "Automatic label purchase disabled for a financial test order."
      );
      return { ok: true, state: "test_order_skipped", parcels: [] };
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
    const quote =
      partialPurchaseQuote ||
      (await getCheckoutQuote(shipment)) ||
      (await getSavedAutomaticQuote(shipment.id)) ||
      await saveFastestQuote(
        shipment,
        createEasyPostRatingContext({ deadlineAt: workerDeadlineAt })
      );
    if (!isShippingQuoteUsable(quote, {
      hasPurchasedParcels: Boolean(partialPurchaseQuote)
    })) {
      throw new Error("The selected shipping quote expired before label purchase.");
    }
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
