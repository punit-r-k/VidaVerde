import {
  EXPEDITED_SHIPPING_OPTION_ID,
  getShippingOptionsForCart,
  normalizeShippingOptionId
} from "@/lib/shippingPricing";

const toText = (value, max = 180) =>
  String(value ?? "").trim().slice(0, max);

const EXPECTED_ARRIVAL_PATTERN =
  /^Expected arrival:\s*((?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4})\.?$/iu;

export const getSafeExpectedArrivalText = (value) => {
  const match = EXPECTED_ARRIVAL_PATTERN.exec(toText(value));
  return match?.[1] || "";
};

export const getConsumerShippingDetails = (source = {}) => {
  const rawOption =
    source?.shippingOption ??
    source?.shipping_option ??
    source?.id ??
    "";
  const storedLabel = toText(
    source?.shippingOptionLabel ?? source?.shipping_option_label,
    120
  ).toLowerCase();
  const normalizedOption = normalizeShippingOptionId(
    rawOption || (storedLabel === "expedited shipping" ? "expedited" : "normal")
  );
  const { normalOption, expeditedOption } = getShippingOptionsForCart();
  const option = normalizedOption === EXPEDITED_SHIPPING_OPTION_ID
    ? expeditedOption
    : normalOption;
  const exactArrival = getSafeExpectedArrivalText(
    source?.shippingEstimate ?? source?.shipping_estimate
  );

  return {
    id: option.id,
    label: option.label,
    deliveryEstimate: option.deliveryEstimate,
    expectedArrivalText: exactArrival || option.transitLabel,
    transitLabel: exactArrival
      ? `Expected arrival: ${exactArrival}.`
      : option.transitLabel
  };
};
