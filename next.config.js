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
