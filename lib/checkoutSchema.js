import { z } from "zod";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTAL_REGEX = /^\d{5}(?:-\d{4})?$/;
const E164_REGEX = /^\+[1-9]\d{7,14}$/;
const SKU_REGEX = /^[A-Z0-9_-]{1,64}$/;
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 16;
const MAX_ADDRESS_LENGTH = 120;
const MAX_CITY_LENGTH = 120;
const MAX_NOTE_LENGTH = 500;
const MAX_CART_ITEMS = 50;
const MAX_ITEM_QUANTITY = 1_000;
const MAX_INVENTORY_COUNT = 100_000;

export const US_STATE_OPTIONS = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" }
];

export const US_CITY_OPTIONS = [
  "Albuquerque",
  "Anaheim",
  "Anchorage",
  "Arlington",
  "Atlanta",
  "Aurora",
  "Austin",
  "Bakersfield",
  "Baltimore",
  "Baton Rouge",
  "Boise",
  "Boston",
  "Buffalo",
  "Charlotte",
  "Chicago",
  "Cincinnati",
  "Cleveland",
  "Colorado Springs",
  "Columbus",
  "Dallas",
  "Denver",
  "Des Moines",
  "Detroit",
  "Durham",
  "El Paso",
  "Fort Worth",
  "Fresno",
  "Greensboro",
  "Henderson",
  "Honolulu",
  "Houston",
  "Indianapolis",
  "Irving",
  "Jacksonville",
  "Jersey City",
  "Kansas City",
  "Katy",
  "Knoxville",
  "Las Vegas",
  "Lexington",
  "Lincoln",
  "Long Beach",
  "Los Angeles",
  "Louisville",
  "Lubbock",
  "Madison",
  "Memphis",
  "Mesa",
  "Miami",
  "Milwaukee",
  "Minneapolis",
  "Nashville",
  "New Orleans",
  "New York",
  "Newark",
  "Norfolk",
  "Oakland",
  "Oklahoma City",
  "Omaha",
  "Orlando",
  "Philadelphia",
  "Phoenix",
  "Pittsburgh",
  "Plano",
  "Portland",
  "Raleigh",
  "Reno",
  "Richmond",
  "Riverside",
  "Sacramento",
  "Saint Paul",
  "Salt Lake City",
  "San Antonio",
  "San Diego",
  "San Francisco",
  "San Jose",
  "Santa Ana",
  "Scottsdale",
  "Seattle",
  "Spokane",
  "St. Louis",
  "St. Petersburg",
  "Stockton",
  "Tampa",
  "Toledo",
  "Tucson",
  "Tulsa",
  "Virginia Beach",
  "Washington",
  "Wichita"
];

const US_STATE_CODES = new Set(US_STATE_OPTIONS.map((entry) => entry.code));

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

const formatUSPhone = (digits) => {
  if (!digits) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

export const normalizePhone = (value) => {
  const raw = toText(value).trim();
  if (!raw) return "";

  const digits = getPhoneDigits(raw).slice(0, 15);
  if (!digits) return "";

  const hasPlusPrefix = raw.startsWith("+");

  if (hasPlusPrefix) {
    return `+${digits}`;
  }

  // Default country is US (+1) when user enters a local 10-digit number.
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // Common US variant when "1" is already included.
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  // Non-US values without + from autofill are treated as international.
  return `+${digits}`;
};

export const formatPhone = (value) => {
  const raw = toText(value).trim();
  if (!raw) return "";

  const digits = getPhoneDigits(raw).slice(0, 15);
  if (!digits) return "";

  const hasPlusPrefix = raw.startsWith("+");

  if (!hasPlusPrefix) {
    if (digits.length <= 10) {
      return formatUSPhone(digits);
    }

    if (digits.length === 11 && digits.startsWith("1")) {
      return `+1 ${formatUSPhone(digits.slice(1))}`;
    }

    return `+${digits}`;
  }

  if (digits.startsWith("1") && digits.length <= 11) {
    const usDigits = digits.slice(1);
    if (!usDigits) return "+1";
    return `+1 ${formatUSPhone(usDigits)}`;
  }

  return `+${digits}`;
};

export const formatPostalCode = (value) => {
  const digits = getPhoneDigits(value).slice(0, 9);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

export const formatCity = (value) => normalizeSpaces(value).trim();

export const formatState = (value) => {
  const trimmed = toText(value).trim();
  if (!trimmed) return "";

  const upper = trimmed.toUpperCase();
  if (US_STATE_CODES.has(upper)) return upper;

  return upper.replace(/[^A-Z]/g, "").slice(0, 2);
};

export const normalizeFulfillment = (value) => (value === "market" ? "market" : "ship");

export const formatCheckoutInputValue = (name, value) => {
  switch (name) {
    case "name":
    case "address1":
    case "address2":
      return normalizeSpaces(value);
    case "city":
      return formatCity(value);
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
const parseIntegerInput = (value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return Number.NaN;
};

const customerSchema = z
  .object({
    name: textSchema
      .transform((value) => normalizeSpaces(value).trim())
      .refine((value) => value.length > 0, "Please enter your name.")
      .refine((value) => value.length >= 2, "Please enter your full name.")
      .refine(
        (value) => value.length <= MAX_NAME_LENGTH,
        `Please keep your name under ${MAX_NAME_LENGTH} characters.`
      ),
    email: textSchema
      .transform((value) => formatEmail(value).trim())
      .refine((value) => value.length > 0, "Please enter your email.")
      .refine(
        (value) => value.length <= MAX_EMAIL_LENGTH,
        `Please keep your email under ${MAX_EMAIL_LENGTH} characters.`
      )
      .refine((value) => EMAIL_REGEX.test(value), "Please enter a valid email address."),
    phone: textSchema
      .transform((value) => normalizePhone(value))
      .refine(
        (value) => value.length <= MAX_PHONE_LENGTH,
        "Enter a valid phone number."
      )
      .refine(
        (value) => !value || E164_REGEX.test(value),
        "Enter a valid phone number. US defaults to +1; non-US should include country code."
      ),
    address1: textSchema
      .transform((value) => normalizeSpaces(value).trim())
      .refine(
        (value) => value.length <= MAX_ADDRESS_LENGTH,
        `Please keep your street address under ${MAX_ADDRESS_LENGTH} characters.`
      ),
    address2: textSchema
      .transform((value) => normalizeSpaces(value).trim())
      .refine(
        (value) => value.length <= MAX_ADDRESS_LENGTH,
        `Please keep address line 2 under ${MAX_ADDRESS_LENGTH} characters.`
      ),
    city: textSchema
      .transform((value) => formatCity(value))
      .refine((value) => !value || value.length >= 2, "Please enter a valid city.")
      .refine(
        (value) => value.length <= MAX_CITY_LENGTH,
        `Please keep the city under ${MAX_CITY_LENGTH} characters.`
      ),
    state: textSchema
      .transform((value) => formatState(value))
      .refine((value) => !value || US_STATE_CODES.has(value), "Please choose a valid state."),
    postalCode: textSchema.transform((value) => formatPostalCode(value)),
    note: textSchema
      .transform((value) => normalizeSpaces(value).trim())
      .refine(
        (value) => value.length <= MAX_NOTE_LENGTH,
        `Please keep your order note under ${MAX_NOTE_LENGTH} characters.`
      )
  })
  .strict();

const quantitySchema = z.preprocess(
  parseIntegerInput,
  z
    .number("Use a whole number for each item quantity.")
    .int("Use a whole number for each item quantity.")
    .min(1, "Choose at least 1 for each item.")
    .max(MAX_ITEM_QUANTITY, `Please keep each item quantity at ${MAX_ITEM_QUANTITY} or fewer.`)
);

const nonNegativeIntegerSchema = z.preprocess(
  parseIntegerInput,
  z
    .number("Use a whole number for the inventory count.")
    .int("Use a whole number for the inventory count.")
    .min(0, "Inventory counts cannot be negative.")
    .max(MAX_INVENTORY_COUNT, `Please keep inventory counts at ${MAX_INVENTORY_COUNT} or fewer.`)
);

const itemSchema = z
  .object({
    sku: textSchema
      .transform((value) => value.trim().toUpperCase())
      .refine((value) => value.length > 0, "One item in your cart looks out of date. Please refresh and try again.")
      .refine(
        (value) => SKU_REGEX.test(value),
        "One item in your cart looks out of date. Please refresh and try again."
      ),
    quantity: quantitySchema
  })
  .strict();

const inventorySnapshotItemSchema = z
  .object({
    sku: textSchema
      .transform((value) => value.trim().toUpperCase())
      .refine((value) => value.length > 0, "Your cart changed. Please refresh and try again.")
      .refine(
        (value) => SKU_REGEX.test(value),
        "Your cart changed. Please refresh and try again."
      ),
    quantity: quantitySchema,
    available: nonNegativeIntegerSchema,
    inStockUnits: nonNegativeIntegerSchema,
    preorderUnits: nonNegativeIntegerSchema
  })
  .strict()
  .superRefine((item, context) => {
    if (item.inStockUnits + item.preorderUnits !== item.quantity) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preorderUnits"],
        message: "Inventory snapshot does not match the item quantity."
      });
    }
  });

const inventorySnapshotSchema = z
  .object({
    items: z
      .array(inventorySnapshotItemSchema)
      .max(MAX_CART_ITEMS, "Your cart is a little too large. Please split it into two orders.")
      .default([])
  })
  .strict()
  .optional();

const consentSchema = z
  .object({
    pickupPolicyAccepted: z.boolean().optional().default(false)
  })
  .strict()
  .optional()
  .default({ pickupPolicyAccepted: false });

export const checkoutPayloadSchema = z
  .object({
    fulfillment: z.enum(["ship", "market"]).default("ship"),
    customer: customerSchema,
    consents: consentSchema,
    items: z
      .array(itemSchema)
      .min(1, "Add at least one item before checking out.")
      .max(MAX_CART_ITEMS, "Your cart is a little too large. Please split it into two orders."),
    inventorySnapshot: inventorySnapshotSchema
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.fulfillment !== "ship") return;

    if (!payload.customer.address1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer", "address1"],
        message: "Please enter a street address for shipping."
      });
    }

    if (!payload.customer.city) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer", "city"],
        message: "Please enter a city for shipping."
      });
    }

    if (!payload.customer.state) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer", "state"],
        message: "Please choose a state for shipping."
      });
    } else if (!US_STATE_CODES.has(payload.customer.state)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer", "state"],
        message: "Please choose a valid state."
      });
    }

    if (!payload.customer.postalCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer", "postalCode"],
        message: "Please enter a ZIP code for shipping."
      });
    } else if (!POSTAL_REGEX.test(payload.customer.postalCode)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customer", "postalCode"],
        message: "Please use ZIP format 12345 or 12345-6789."
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
