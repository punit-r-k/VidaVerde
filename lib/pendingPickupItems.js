import { supabaseAdmin } from "@/lib/supabaseAdmin";

const toText = (value, max = 500) => String(value || "").trim().slice(0, max);
const normalizeSku = (value) => toText(value, 32).toUpperCase();
const toQty = (value) => {
  const quantity = Number.parseInt(value, 10);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
};

const compareItems = (left, right) =>
  toText(left?.name, 120).localeCompare(toText(right?.name, 120), undefined, {
    sensitivity: "base"
  }) || normalizeSku(left?.sku).localeCompare(normalizeSku(right?.sku), undefined, {
    sensitivity: "base"
  });

const addItemToMap = (itemsMap, item) => {
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

const mapToSortedItems = (itemsMap) =>
  [...(itemsMap instanceof Map ? itemsMap.values() : [])].sort(compareItems);

export const getPendingPreorderItemsByOrder = async (
  orderIds,
  { logLabel = "pending preorder lookup" } = {}
) => {
  const normalizedOrderIds = (Array.isArray(orderIds) ? orderIds : [])
    .map((value) => toText(value, 36))
    .filter(Boolean);
  if (normalizedOrderIds.length === 0) {
    return new Map();
  }

  if (!supabaseAdmin) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("preorder_queue")
    .select("order_id, sku, remaining, products(name)")
    .in("order_id", normalizedOrderIds)
    .gt("remaining", 0);

  if (error) {
    console.error(`${logLabel} error:`, error);
    return null;
  }

  const itemsByOrder = new Map();

  for (const row of data || []) {
    const orderId = toText(row?.order_id, 36);
    const sku = normalizeSku(row?.sku);
    const quantity = toQty(row?.remaining);
    const productData = Array.isArray(row?.products) ? row.products[0] : row?.products;
    const name = toText(productData?.name, 120) || sku;
    if (!orderId || !sku || quantity <= 0) continue;

    const orderItemsMap = itemsByOrder.get(orderId) || new Map();
    addItemToMap(orderItemsMap, {
      sku,
      name,
      quantity
    });
    itemsByOrder.set(orderId, orderItemsMap);
  }

  return [...itemsByOrder.entries()].reduce((acc, [orderId, itemsMap]) => {
    acc.set(orderId, mapToSortedItems(itemsMap));
    return acc;
  }, new Map());
};
