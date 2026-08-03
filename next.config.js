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
  if (getSecurityEnvironmentBucket() !== "PRODUCTION") {
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
    "EASYPOST_FROM_STREET1",
    "EASYPOST_FROM_CITY",
    "EASYPOST_FROM_STATE",
    "EASYPOST_FROM_ZIP",
    "EASYPOST_FROM_PHONE",
    "EASYPOST_FROM_EMAIL"
  ];
  const missingShippingVariables = requiredShippingVariables.filter(
    (name) => !String(process.env[name] || "").trim()
  );
  if (missingShippingVariables.length > 0) {
    throw new Error(
      `Incomplete production shipping configuration: set ${missingShippingVariables.join(", ")}.`
    );
  }

  if (isHostedProduction()) {
    const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
    const stripePublishableKey = String(
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""
    ).trim();
    const easyPostApiKey = String(process.env.EASYPOST_API_KEY || "").trim();

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
    qualities: [75],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com"
      }
    ]
  }
});

module.exports = createNextConfig;
