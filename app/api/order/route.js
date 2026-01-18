import { NextResponse } from "next/server";
import { products, PRODUCT_PRICE } from "@/lib/products";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getInventoryMap, updateInventorySheet } from "@/lib/stock";

const productIndex = new Map(products.map((product) => [product.sku, product]));

export async function POST(request) {
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 500 }
    );
  }

  let payload;

  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const { customer = {}, items = [], fulfillment = "ship" } = payload || {};
  const name = String(customer.name || "").trim();
  const email = String(customer.email || "").trim();

  if (!name || !email) {
    return NextResponse.json(
      { error: "Name and email are required." },
      { status: 400 }
    );
  }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "At least one item is required." },
      { status: 400 }
    );
  }

  const normalizedItems = items
    .map((item) => {
      const sku = String(item.sku || "").trim();
      const quantity = Number.parseInt(item.quantity, 10);
      const product = productIndex.get(sku);

      if (!product || Number.isNaN(quantity) || quantity <= 0) {
        return null;
      }

      return {
        sku,
        name: product.name,
        quantity
      };
    })
    .filter(Boolean);

  if (normalizedItems.length === 0) {
    return NextResponse.json(
      { error: "No valid items were provided." },
      { status: 400 }
    );
  }

  const inventoryMap = await getInventoryMap();

  const orderItems = normalizedItems.map((item) => ({
    ...item,
    name: inventoryMap[item.sku]?.name || item.name
  }));

  const enrichedItems = orderItems.map((item) => {
    const available = inventoryMap[item.sku]?.stock ?? 0;
    const preorder = available <= 0 || item.quantity > available;

    return {
      ...item,
      preorder,
      unitPrice: PRODUCT_PRICE,
      lineTotal: PRODUCT_PRICE * item.quantity,
      stockAtOrder: available
    };
  });

  const subtotal = enrichedItems.reduce(
    (sum, item) => sum + item.lineTotal,
    0
  );

  const hasPreorder = enrichedItems.some((item) => item.preorder);
  const isPickup = fulfillment === "market";

  if (!isPickup) {
    const address1 = String(customer.address1 || "").trim();
    const city = String(customer.city || "").trim();
    const state = String(customer.state || "").trim();
    const postalCode = String(customer.postalCode || "").trim();

    if (!address1 || !city || !state || !postalCode) {
      return NextResponse.json(
        { error: "Shipping address is incomplete." },
        { status: 400 }
      );
    }
  }

  const orderRecord = {
    name,
    email,
    phone: String(customer.phone || "").trim(),
    fulfillment,
    address1: String(customer.address1 || "").trim(),
    address2: String(customer.address2 || "").trim(),
    city: String(customer.city || "").trim(),
    state: String(customer.state || "").trim(),
    postal_code: String(customer.postalCode || "").trim(),
    note: String(customer.note || "").trim(),
    items: enrichedItems,
    subtotal,
    preorder: hasPreorder
  };

  const sheetUpdates = orderItems.map((item) => {
    const record = inventoryMap[item.sku] || {
      stock: 0,
      preorders: 0,
      sales: 0
    };
    const available = record.stock ?? 0;
    const preorderCount = Math.max(item.quantity - available, 0);

    return {
      sku: item.sku,
      row: record.row,
      stock: Math.max(available - item.quantity, 0),
      preorders: (record.preorders ?? 0) + preorderCount,
      sales: (record.sales ?? 0) + item.quantity
    };
  });

  const { data, error } = await supabaseAdmin
    .from("orders")
    .insert([orderRecord])
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Unable to save order." },
      { status: 500 }
    );
  }

  try {
    await updateInventorySheet(sheetUpdates);
  } catch (sheetError) {
    if (data?.id) {
      const { error: deleteError } = await supabaseAdmin
        .from("orders")
        .delete()
        .eq("id", data.id);

      if (deleteError) {
        console.error("Unable to roll back order after sheet failure.");
      }
    }

    console.error("Unable to update Google Sheet.", sheetError);

    return NextResponse.json(
      { error: "Unable to sync inventory." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
