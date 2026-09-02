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
  }));

const quoteUsesOneCarrier = (quote) => {
  const parcels = Array.isArray(quote?.quote_json?.parcels)
    ? quote.quote_json.parcels
    : [];
  const carriers = new Set(parcels.map((parcel) =>
    String(parcel?.selectedRate?.carrier || "").trim().toLowerCase()
  ).filter(Boolean));
  return parcels.length > 0 && carriers.size === 1;
};

export const releaseQuoteMatches = ({ quote, shipment, parcelPlan, now = Date.now() }) => {
  const expiresAt = Date.parse(String(quote?.expires_at || ""));
  if (
    !quote ||
    String(quote.shipment_id || "") !== String(shipment?.id || "") ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Number(now) ||
    !String(quote.plan_key || "").startsWith("RELEASE__") ||
    !quoteUsesOneCarrier(quote)
  ) return false;
  if (
    String(quote.quote_json?.releaseShippingOption || "") !==
      String(shipment.shipping_option || "") ||
    String(quote.quote_json?.releaseShippingTier || "") !==
      String(shipment.shipping_tier || "")
  ) return false;
  return JSON.stringify(normalizeParcelPlan(quote.quote_json?.parcels)) ===
    JSON.stringify(normalizeParcelPlan(parcelPlan?.parcels));
};

export async function getOrCreateCompatibleReleaseQuote({
  shipment,
  parcelPlan,
  loadCandidates,
  hasPurchases,
  createQuote,
  now = Date.now()
}) {
  const candidates = await loadCandidates();
  for (const quote of Array.isArray(candidates) ? candidates : []) {
    if (!releaseQuoteMatches({ quote, shipment, parcelPlan, now })) continue;
    if (!await hasPurchases(quote)) return { quote, reused: true };
  }
  return { quote: await createQuote(), reused: false };
}
