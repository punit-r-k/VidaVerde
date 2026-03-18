import { z } from "zod";

const blankToUndefined = (value) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : undefined;
};

const safeSkuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9_-]{1,64}$/, "SKU must contain only letters, numbers, underscores, or hyphens.");

const orderStatusSchema = z.enum(["paid", "pending", "cancelled", "refunded", "fulfilled"]);
const shipmentStatusSchema = z.enum([
  "pending_label",
  "label_purchased",
  "shipped",
  "delivered",
  "cancelled"
]);
const fulfillmentSchema = z.enum(["market", "ship"]);

export const ordersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(2000).default(500),
    status: z.preprocess(blankToUndefined, orderStatusSchema.optional()),
    fulfillment: z.preprocess(blankToUndefined, fulfillmentSchema.optional())
  })
  .strict();

export const shipmentsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(2000).default(500),
    status: z.preprocess(blankToUndefined, shipmentStatusSchema.optional()),
    refresh: z.preprocess((value) => {
      if (value === undefined || value === null || value === "") return false;
      if (value === true || value === "true" || value === "1" || value === 1) return true;
      if (value === false || value === "false" || value === "0" || value === 0) return false;
      return value;
    }, z.boolean())
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
    preorders_remaining: z.coerce.number().int().min(0).max(100_000)
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
    restock: z.coerce.number().int().min(-100_000).max(100_000)
  })
  .strict();

export const parseSearchParams = (request) =>
  Object.fromEntries(new URL(request.url).searchParams.entries());
