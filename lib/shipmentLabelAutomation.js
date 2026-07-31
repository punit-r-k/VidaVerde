import {
  buyEasyPostShipment,
  getEasyPostShipment
} from "@/lib/easypost";
import { getEasyPostQuotes } from "@/lib/shippingQuotes";
import { chooseFastestQuote } from "@/lib/shippingRateRanking";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;
const QUOTE_LIFETIME_MS = 60 * 60 * 1000;

const hasPurchasedPostage = (shipment) =>
  Boolean(shipment?.postage_label?.label_url && shipment?.tracking_code);

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

  const { data: reclaimed, error: reclaimError } = await supabaseAdmin
    .from("shipments")
    .update(claimPayload)
    .eq("id", shipmentId)
    .eq("status", "purchasing_label")
    .eq("label_purchase_started_at", current.label_purchase_started_at)
    .select("*")
    .maybeSingle();
  if (reclaimError) throw reclaimError;

  return reclaimed
    ? { state: "claimed", shipment: reclaimed }
    : { state: "in_progress", shipment: current };
};

const saveFastestQuote = async (shipment) => {
  const quotes = await getEasyPostQuotes(shipment);
  const quote = chooseFastestQuote(quotes);
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
  return quote;
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
  if (savedQuote) return savedQuote;

  const paymentSessionId = String(shipment.payment_session_id || "").trim();
  if (!paymentSessionId) return null;

  const { data: checkoutQuote, error: checkoutQuoteError } = await supabaseAdmin
    .from("checkout_shipping_quotes")
    .select("*")
    .eq("payment_session_id", paymentSessionId)
    .in("status", ["quoted", "label_purchased"])
    .maybeSingle();
  if (checkoutQuoteError) throw checkoutQuoteError;
  if (!checkoutQuote?.quote_json) return null;

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

const getPurchasedShipment = async (parcel) => {
  const existing = await getEasyPostShipment(parcel.easyPostShipmentId);
  if (hasPurchasedPostage(existing)) return existing;

  try {
    return await buyEasyPostShipment(
      parcel.easyPostShipmentId,
      parcel.selectedRate.id
    );
  } catch (error) {
    const recovered = await getEasyPostShipment(parcel.easyPostShipmentId);
    if (hasPurchasedPostage(recovered)) return recovered;
    throw error;
  }
};

const purchaseQuote = async (shipment, quote) => {
  const parcels = Array.isArray(quote?.quote_json?.parcels)
    ? quote.quote_json.parcels
    : [];
  if (parcels.length === 0) throw new Error("The selected EasyPost quote has no parcels.");

  const purchased = [];
  for (let index = 0; index < parcels.length; index += 1) {
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

    const bought = await getPurchasedShipment(parcel);
    const label = bought.postage_label || {};
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
      postage_cents: parcel.selectedRate.amountCents,
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
  const { error: updateError } = await supabaseAdmin
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
    .eq("id", shipment.id);
  if (updateError) throw updateError;

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

const recordPurchaseFailure = async (shipmentId, error) => {
  const failedAt = new Date().toISOString();
  await supabaseAdmin
    .from("shipments")
    .update({
      status: "pending_label",
      label_purchase_started_at: null,
      label_purchase_error: String(error?.message || error || "EasyPost label purchase failed.").slice(0, 500),
      updated_at: failedAt
    })
    .eq("id", shipmentId)
    .eq("status", "purchasing_label");
};

const isFinancialTestShipment = async (shipment) => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("is_test_order")
    .eq("id", shipment.order_id)
    .maybeSingle();
  if (error) throw error;
  return data?.is_test_order === true;
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
  try {
    if (await isFinancialTestShipment(shipment)) {
      await supabaseAdmin
        .from("shipments")
        .update({
          status: "pending_label",
          label_purchase_started_at: null,
          label_purchase_error: "Automatic label purchase skipped for a financial test order.",
          updated_at: new Date().toISOString()
        })
        .eq("id", shipment.id)
        .eq("status", "purchasing_label");
      return { ok: true, state: "test_order_skipped", parcels: [] };
    }

    const quote =
      (await getPartialPurchaseQuote(shipment.id)) ||
      (await getCheckoutQuote(shipment)) ||
      (await getSavedAutomaticQuote(shipment.id)) ||
      await saveFastestQuote(shipment);
    const parcels = await purchaseQuote(shipment, quote);
    return { ok: true, state: "label_purchased", quote, parcels };
  } catch (error) {
    await recordPurchaseFailure(shipment.id, error);
    throw error;
  }
}
