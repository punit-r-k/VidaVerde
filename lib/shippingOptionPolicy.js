import {
  EXPEDITED_SHIPPING_OPTION_ID,
  NORMAL_SHIPPING_OPTION_ID
} from "./shippingPricing.js";

const hasValidSelection = (selection) =>
  Boolean(selection?.quote && Number(selection?.charge?.amountCents) > 0);

const relabelAsNormal = (selection, normalOption) => ({
  ...selection,
  sourceServiceLevel: selection?.option?.id || EXPEDITED_SHIPPING_OPTION_ID,
  option: {
    ...selection.option,
    id: NORMAL_SHIPPING_OPTION_ID,
    label: normalOption?.label || "Normal Shipping"
  }
});

export const resolveCustomerShippingSelections = ({
  normalSelection,
  expeditedSelection,
  normalOption
} = {}) => {
  const hasNormal = hasValidSelection(normalSelection);
  const hasExpedited = hasValidSelection(expeditedSelection);

  if (!hasNormal && !hasExpedited) {
    return {
      normalSelection: null,
      expeditedSelection: null,
      visibleOptionIds: [],
      expeditedHiddenReason: "unavailable"
    };
  }

  if (!hasNormal) {
    return {
      normalSelection: relabelAsNormal(expeditedSelection, normalOption),
      expeditedSelection: null,
      visibleOptionIds: [NORMAL_SHIPPING_OPTION_ID],
      expeditedHiddenReason: "normal_unavailable"
    };
  }

  if (!hasExpedited) {
    return {
      normalSelection,
      expeditedSelection: null,
      visibleOptionIds: [NORMAL_SHIPPING_OPTION_ID],
      expeditedHiddenReason: "expedited_unavailable"
    };
  }

  const normalAmount = Number(normalSelection.charge.amountCents);
  const expeditedAmount = Number(expeditedSelection.charge.amountCents);
  const normalDays = Number(normalSelection.deliveryDays);
  const expeditedDays = Number(expeditedSelection.deliveryDays);
  const expeditedIsFaster =
    Number.isFinite(expeditedDays) &&
    (!Number.isFinite(normalDays) || expeditedDays < normalDays);

  if (expeditedAmount < normalAmount || (
    expeditedAmount === normalAmount && expeditedIsFaster
  )) {
    return {
      normalSelection: relabelAsNormal(expeditedSelection, normalOption),
      expeditedSelection: null,
      visibleOptionIds: [NORMAL_SHIPPING_OPTION_ID],
      expeditedHiddenReason: "expedited_not_premium_priced"
    };
  }

  if (expeditedAmount === normalAmount) {
    return {
      normalSelection,
      expeditedSelection: null,
      visibleOptionIds: [NORMAL_SHIPPING_OPTION_ID],
      expeditedHiddenReason: "equal_price"
    };
  }

  if (!expeditedIsFaster) {
    return {
      normalSelection,
      expeditedSelection: null,
      visibleOptionIds: [NORMAL_SHIPPING_OPTION_ID],
      expeditedHiddenReason: "not_faster"
    };
  }

  return {
    normalSelection,
    expeditedSelection,
    visibleOptionIds: [
      NORMAL_SHIPPING_OPTION_ID,
      EXPEDITED_SHIPPING_OPTION_ID
    ],
    expeditedHiddenReason: ""
  };
};
