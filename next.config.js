const { PHASE_DEVELOPMENT_SERVER } = require("next/constants");

const splitCsv = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizeOrigin = (value) => {
  if (!value) return null;
  if (String(value).trim() === "*") return "*";

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const getSecurityEnvironmentBucket = () => {
  const explicitEnv =
    process.env.APP_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
  const normalized = explicitEnv.toLowerCase();

  if (normalized === "production") return "PRODUCTION";
  if (normalized === "preview" || normalized === "staging") return "STAGING";
  return "DEVELOPMENT";
};

const isHostedProduction = () =>
  String(process.env.VERCEL_ENV || process.env.APP_ENV || "")
    .trim()
    .toLowerCase() === "production";

const assertSafeProductionCorsConfig = () => {
  const environmentBucket = getSecurityEnvironmentBucket();
  const easyPostApiKey = String(process.env.EASYPOST_API_KEY || "").trim();
  if (
    easyPostApiKey.startsWith("EZAK") &&
    (environmentBucket === "STAGING" || String(process.env.NODE_ENV).toLowerCase() === "test")
  ) {
    throw new Error(
      "Unsafe non-production shipping configuration: staging and test environments cannot use an EasyPost production key."
    );
  }
  if (environmentBucket !== "PRODUCTION") {
    return;
  }

  const configuredOrigins = [
    ...splitCsv(process.env.CORS_ALLOWED_ORIGINS),
    ...splitCsv(process.env.CORS_ALLOWED_ORIGINS_PRODUCTION),
    process.env.SITE_URL,
    process.env.NEXT_PUBLIC_SITE_URL
  ]
    .map(normalizeOrigin)
    .filter(Boolean);

  const wildcardConfigured = configuredOrigins.includes("*");
  const trustedOrigins = configuredOrigins.filter((origin) => origin !== "*");

  if (wildcardConfigured) {
    throw new Error(
      "Unsafe production CORS configuration: wildcard origins are forbidden in production."
    );
  }

  if (trustedOrigins.length === 0) {
    throw new Error(
      "Unsafe production CORS configuration: set an explicit trusted origin allowlist before starting the server."
    );
  }

  const adminJwtSecret = String(process.env.ADMIN_JWT_SECRET || "");
  if (Buffer.byteLength(adminJwtSecret, "utf8") < 32) {
    throw new Error(
      "Unsafe production admin authentication: ADMIN_JWT_SECRET must contain at least 32 UTF-8 bytes from a cryptographically random source."
    );
  }

  const requiredShippingVariables = [
    "EASYPOST_API_KEY",
    "EASYPOST_WEBHOOK_SECRET",
    "SHIPPING_QUOTE_HMAC_SECRET",
    "EASYPOST_LIVE_QUOTES_ENABLED",
    "EASYPOST_MONTHLY_OVERAGE_LIMIT_CENTS",
    "EASYPOST_DAILY_RATING_LIMIT",
    "EASYPOST_DAILY_ADDRESS_VERIFICATION_LIMIT",
    "EASYPOST_RATING_OVERAGE_UNIT_CENTS",
    "EASYPOST_ADDRESS_VERIFICATION_OVERAGE_UNIT_CENTS",
    "EASYPOST_FROM_STREET1",
    "EASYPOST_FROM_CITY",
    "EASYPOST_FROM_STATE",
    "EASYPOST_FROM_ZIP",
    "EASYPOST_FROM_PHONE",
    "EASYPOST_FROM_EMAIL",
    "NEXT_PUBLIC_SHIPPING_DAYS",
    "NEXT_PUBLIC_SHIPPING_CUTOFF_TIME",
    "NEXT_PUBLIC_SHIPPING_TIME_ZONE"
  ];
  const missingShippingVariables = requiredShippingVariables.filter(
    (name) => !String(process.env[name] || "").trim()
  );
  if (missingShippingVariables.length > 0) {
    throw new Error(
      `Incomplete production shipping configuration: set ${missingShippingVariables.join(", ")}.`
    );
  }
  const integerShippingVariables = [
    "EASYPOST_MONTHLY_OVERAGE_LIMIT_CENTS",
    "EASYPOST_DAILY_RATING_LIMIT",
    "EASYPOST_DAILY_ADDRESS_VERIFICATION_LIMIT",
    "EASYPOST_RATING_OVERAGE_UNIT_CENTS",
    "EASYPOST_ADDRESS_VERIFICATION_OVERAGE_UNIT_CENTS"
  ];
  const invalidIntegerShippingVariables = integerShippingVariables.filter((name) => {
    const rawValue = String(process.env[name] || "").trim();
    const value = Number(rawValue);
    return !/^\d+$/u.test(rawValue) || !Number.isSafeInteger(value) || value < 0;
  });
  if (invalidIntegerShippingVariables.length > 0) {
    throw new Error(
      `Invalid production shipping configuration: ${invalidIntegerShippingVariables.join(", ")} must be non-negative integers.`
    );
  }
  if (Buffer.byteLength(String(process.env.SHIPPING_QUOTE_HMAC_SECRET || ""), "utf8") < 32) {
    throw new Error(
      "Unsafe production shipping configuration: SHIPPING_QUOTE_HMAC_SECRET must contain at least 32 UTF-8 bytes."
    );
  }

  const shippingDays = splitCsv(process.env.NEXT_PUBLIC_SHIPPING_DAYS);
  const validShippingDays = new Set([
    "sun",
    "sunday",
    "mon",
    "monday",
    "tue",
    "tues",
    "tuesday",
    "wed",
    "weds",
    "wednesday",
    "thu",
    "thur",
    "thurs",
    "thursday",
    "fri",
    "friday",
    "sat",
    "saturday"
  ]);
  if (
    shippingDays.length === 0 ||
    shippingDays.some((day) => !validShippingDays.has(day.toLowerCase()))
  ) {
    throw new Error(
      "Invalid production shipping schedule: NEXT_PUBLIC_SHIPPING_DAYS must contain comma-separated weekday names."
    );
  }

  const shippingCutoff = String(
    process.env.NEXT_PUBLIC_SHIPPING_CUTOFF_TIME || ""
  ).trim();
  const cutoffMatch = /^(?<hour>\d{2}):(?<minute>\d{2})$/.exec(shippingCutoff);
  if (
    !cutoffMatch ||
    Number(cutoffMatch.groups.hour) > 23 ||
    Number(cutoffMatch.groups.minute) > 59
  ) {
    throw new Error(
      "Invalid production shipping schedule: NEXT_PUBLIC_SHIPPING_CUTOFF_TIME must use 24-hour HH:mm format."
    );
  }

  const shippingTimeZone = String(
    process.env.NEXT_PUBLIC_SHIPPING_TIME_ZONE || ""
  ).trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: shippingTimeZone }).format();
  } catch {
    throw new Error(
      "Invalid production shipping schedule: NEXT_PUBLIC_SHIPPING_TIME_ZONE must be a valid IANA time zone."
    );
  }

  if (isHostedProduction()) {
    const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
    const stripePublishableKey = String(
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""
    ).trim();
    if (stripeSecretKey.startsWith("sk_test_") || stripePublishableKey.startsWith("pk_test_")) {
      throw new Error(
        "Unsafe production payments configuration: Stripe test API keys cannot be deployed to production."
      );
    }
    if (easyPostApiKey.startsWith("EZTK")) {
      throw new Error(
        "Unsafe production shipping configuration: an EasyPost test API key cannot be deployed to production."
      );
    }
  }
};

assertSafeProductionCorsConfig();

/** @param {string} phase @returns {import("next").NextConfig} */
const createNextConfig = (phase) => ({
  reactStrictMode: true,
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  images: {
    formats: ["image/avif", "image/webp"],
    imageSizes: [32, 48, 64, 96, 128, 256, 384, 512],
    qualities: [75]
  }
});

module.exports = createNextConfig;
