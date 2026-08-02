export const MAX_CART_LINE_ITEMS = 48;
export const MAX_ITEM_QUANTITY = 24;
export const MAX_CART_UNITS = 48;

export const DUPLICATE_CART_SKU_MESSAGE =
  "Each product can appear only once in your cart. Please refresh and try again.";
export const MAX_CART_UNITS_MESSAGE =
  `Please keep your order to ${MAX_CART_UNITS} total items or fewer.`;

const normalizeSku = (value) => String(value || "").trim().toUpperCase();

export const inspectCartItems = (items) => {
  const seenSkus = new Map();
  const duplicateItems = [];
  let totalUnits = 0;

  (Array.isArray(items) ? items : []).forEach((item, index) => {
    const sku = normalizeSku(item?.sku);
    const quantity = Number(item?.quantity);

    if (sku) {
      const firstIndex = seenSkus.get(sku);
      if (firstIndex === undefined) {
        seenSkus.set(sku, index);
      } else {
        duplicateItems.push({ sku, index, firstIndex });
      }
    }

    if (Number.isInteger(quantity) && quantity > 0) {
      totalUnits += quantity;
    }
  });

  return { duplicateItems, totalUnits };
};
