import { z } from "zod";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATE_REGEX = /^[A-Z]{2}$/;
const POSTAL_REGEX = /^\d{5}(?:-\d{4})?$/;

export const SHIPPING_FIELDS = ["address1", "city", "state", "postalCode"];
export const FORM_FIELD_ORDER = ["name", "email", "phone", ...SHIPPING_FIELDS];
export const INITIAL_FORM_VALUES = {
  name: "",
  email: "",
  phone: "",
  address1: "",
  address2: "",
  city: "",
  state: "",
  postalCode: "",
  note: ""
};

const toText = (value) => {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return String(value);
};

export const normalizeSpaces = (value) =>
  toText(value).replace(/\s+/g, " ").replace(/^\s+/, "");

export const formatEmail = (value) => toText(value).replace(/\s+/g, "").toLowerCase();

export const getPhoneDigits = (value) => toText(value).replace(/\D/g, "");

export const formatPhone = (value) => {
  const digits = getPhoneDigits(value).slice(0, 10);
  if (!digits) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

export const formatPostalCode = (value) => {
  const digits = getPhoneDigits(value).slice(0, 9);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

export const formatState = (value) =>
  toText(value).replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2);

export const normalizeFulfillment = (value) => (value === "market" ? "market" : "ship");

export const formatCheckoutInputValue = (name, value) => {
  switch (name) {
    case "name":
    case "address1":
    case "address2":
    case "city":
      return normalizeSpaces(value);
    case "email":
      return formatEmail(value);
    case "phone":
      return formatPhone(value);
    case "state":
      return formatState(value);
    case "postalCode":
      return formatPostalCode(value);
    default:
      return toText(value);
  }
};

const textSchema = z.preprocess(toText, z.string());

const customerSchema = z.object({
  name: textSchema
    .transform((value) => normalizeSpaces(value).trim())
    .refine((value) => value.length > 0, "Name is required.")
    .refine((value) => value.length >= 2, "Enter your full name."),
  email: textSchema
    .transform((value) => formatEmail(value).trim())
    .refine((value) => value.length > 0, "Email is required.")
    .refine((value) => EMAIL_REGEX.test(value), "Enter a valid email address."),
  phone: textSchema
    .transform((value) => value.trim())
    .refine(
      (value) => !value || getPhoneDigits(value).length === 10,
      "Enter a 10-digit phone number."
    ),
  address1: textSchema.transform((value) => normalizeSpaces(value).trim()),
  address2: textSchema.transform((value) => normalizeSpaces(value).trim()),
  city: textSchema.transform((value) => normalizeSpaces(value).trim()),
  state: textSchema.transform((value) => formatState(value)),
  postalCode: textSchema.transform((value) => formatPostalCode(value)),
  note: textSchema.transform((value) => normalizeSpaces(value).trim())
});

const quantitySchema = z.preprocess((value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    return Number.parseInt(value, 10);
  }
  return Number.NaN;
}, z.number().int().min(1, "Item quantity must be at least 1."));

const itemSchema = z.object({
  sku: textSchema
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, "Item SKU is required."),
  quantity: quantitySchema
});

export const checkoutPayloadSchema = z
  .object({
    fulfillment: z.enum(["ship", "market"]).default("ship"),
    customer: customerSchema,
    items: z.array(itemSchema).min(1, "At least one item is required.")
  })
  .superRefine((payload, context) => {
    if (payload.fulfillment !== "ship") return;

    if (!payload.customer.address1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer", "address1"],
        message: "Street address is required for shipping."
      });
    }

    if (!payload.customer.city) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer", "city"],
        message: "City is required for shipping."
      });
    }

    if (!payload.customer.state) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer", "state"],
        message: "State is required for shipping."
      });
    } else if (!STATE_REGEX.test(payload.customer.state)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer", "state"],
        message: "Use 2-letter state code."
      });
    }

    if (!payload.customer.postalCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer", "postalCode"],
        message: "Postal code is required for shipping."
      });
    } else if (!POSTAL_REGEX.test(payload.customer.postalCode)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer", "postalCode"],
        message: "Use ZIP format 12345 or 12345-6789."
      });
    }
  });

export const mapCheckoutIssuesToFieldErrors = (issues = []) => {
  const fieldErrors = {};

  for (const issue of issues) {
    if (!Array.isArray(issue.path)) continue;
    if (issue.path[0] !== "customer") continue;

    const fieldName = issue.path[1];
    if (typeof fieldName !== "string") continue;
    if (fieldErrors[fieldName]) continue;

    fieldErrors[fieldName] = issue.message;
  }

  return fieldErrors;
};

const VALIDATION_PROBE_ITEM = [{ sku: "__checkout__", quantity: 1 }];

export const getCheckoutFieldErrors = (values, fulfillment) => {
  const payload = {
    fulfillment: normalizeFulfillment(fulfillment),
    customer: {
      ...INITIAL_FORM_VALUES,
      ...(values || {})
    },
    items: VALIDATION_PROBE_ITEM
  };

  const result = checkoutPayloadSchema.safeParse(payload);
  if (result.success) return {};

  return mapCheckoutIssuesToFieldErrors(result.error.issues);
};
