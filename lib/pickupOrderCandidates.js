import {
  MARKET_TIMEZONE,
  getDatePartsInTimezone
} from "@/lib/pickupDetails";

export const toText = (value, max = 500) => String(value || "").trim().slice(0, max);

export const normalizeSku = (value) => toText(value, 32).toUpperCase();

export const toQty = (value) => {
  const qty = Number.parseInt(value, 10);
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
};

export const compareItems = (left, right) =>
  toText(left?.name, 120).localeCompare(toText(right?.name, 120), undefined, {
    sensitivity: "base"
  }) || normalizeSku(left?.sku).localeCompare(normalizeSku(right?.sku), undefined, {
    sensitivity: "base"
  });

export const addItemToMap = (itemsMap, item) => {
  if (!(itemsMap instanceof Map) || !item) return;

  const sku = normalizeSku(item?.sku);
  const quantity = toQty(item?.quantity);
  const name = toText(item?.name, 120) || sku;
  if (!sku || quantity <= 0) return;

  const existing = itemsMap.get(sku);
  if (existing) {
    existing.quantity += quantity;
    if (!toText(existing.name, 120)) {
      existing.name = name;
    }
    return;
  }

  itemsMap.set(sku, {
    sku,
    name,
    quantity
  });
};

export const mapToSortedItems = (itemsMap) =>
  [...(itemsMap instanceof Map ? itemsMap.values() : [])].sort(compareItems);

export const getJoinedOrderData = (row) =>
  Array.isArray(row?.orders) ? row.orders[0] : row?.orders;

export const getJoinedProductData = (row) =>
  Array.isArray(row?.products) ? row.products[0] : row?.products;

export const isFridayOrderInMarketTimezone = (
  createdAt,
  timeZone = MARKET_TIMEZONE
) => {
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
    return false;
  }

  return (getDatePartsInTimezone(createdAt, timeZone).weekday || "").startsWith("fri");
};
