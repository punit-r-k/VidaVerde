import { z } from "zod";

const blankToUndefined = (value) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : undefined;
};

const parseIntegerInput = (value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return Number.NaN;
};

const integerRangeSchema = ({
  message,
  min,
  minMessage,
  max,
  maxMessage,
  defaultValue
}) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return defaultValue;
    return parseIntegerInput(value);
  }, z.number(message).int(message).min(min, minMessage).max(max, maxMessage));

const safeSkuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{1,64}$/, "Use a SKU with only letters, numbers, underscores, or hyphens.");

const orderStatusSchema = z.enum(["paid", "pending", "cancelled", "refunded", "fulfilled"]);
const shipmentStatusSchema = z.enum([
  "pending_label",
  "purchasing_label",
  "label_purchased",
  "shipped",
  "delivered",
  "cancelled"
]);
const fulfillmentSchema = z.enum(["market", "ship"]);

export const ordersQuerySchema = z
  .object({
    limit: integerRangeSchema({
      message: "Use a whole number for the limit.",
      min: 1,
      minMessage: "Show at least 1 order.",
      max: 2000,
      maxMessage: "Show 2,000 orders or fewer at a time.",
      defaultValue: 500
    }),
    status: z.preprocess(blankToUndefined, orderStatusSchema.optional()),
    fulfillment: z.preprocess(blankToUndefined, fulfillmentSchema.optional())
  })
  .strict();

export const shipmentsQuerySchema = z
  .object({
    limit: integerRangeSchema({
      message: "Use a whole number for the limit.",
      min: 1,
      minMessage: "Show at least 1 shipment.",
      max: 2000,
      maxMessage: "Show 2,000 shipments or fewer at a time.",
      defaultValue: 500
    }),
    status: z.preprocess(blankToUndefined, shipmentStatusSchema.optional()),
    refresh: z.preprocess((value) => {
      if (value === undefined || value === null || value === "") return false;
      if (value === true || value === "true" || value === "1" || value === 1) return true;
      if (value === false || value === "false" || value === "0" || value === 0) return false;
      return value;
    }, z.boolean())
  })
  .strict();

export const shipmentIdSchema = z.string().uuid("Use a valid shipment ID.");

export const shipmentLabelPurchaseSchema = z
  .object({
    quote_id: z.string().uuid("Choose a valid shipping quote.")
  })
  .strict();

const showStockPatchSchema = z
  .object({
    show_stock: z.boolean()
  })
  .strict();

const preordersPatchSchema = z
  .object({
    sku: safeSkuSchema,
    preorders_remaining: integerRangeSchema({
      message: "Use a whole number for preorders.",
      min: 0,
      minMessage: "Preorders cannot be negative.",
      max: 100_000,
      maxMessage: "Keep preorders at 100,000 or fewer."
    })
  })
  .strict();

const restockDatePatchSchema = z
  .object({
    sku: safeSkuSchema,
    expected_restock_date: z.preprocess((value) => {
      if (value === undefined || value === null || value === "") return null;
      return String(value).trim();
    }, z.union([z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]))
  })
  .strict();

export const inventoryPatchSchema = z.union([
  showStockPatchSchema,
  preordersPatchSchema,
  restockDatePatchSchema
]);

export const restockPayloadSchema = z
  .object({
    sku: safeSkuSchema,
    restock: integerRangeSchema({
      message: "Use a whole number for the restock amount.",
      min: -100_000,
      minMessage: "Keep restock changes at -100,000 or higher.",
      max: 100_000,
      maxMessage: "Keep restock changes at 100,000 or lower."
    })
  })
  .strict();

export const parseSearchParams = (request) =>
  Object.fromEntries(new URL(request.url).searchParams.entries());
