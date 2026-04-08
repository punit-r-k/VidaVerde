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
  const allowCredentials =
    String(process.env.CORS_ALLOW_CREDENTIALS || "").toLowerCase() === "true";
  const trustedOrigins = configuredOrigins.filter((origin) => origin !== "*");

  if (wildcardConfigured) {
    throw new Error(
      "Unsafe production CORS configuration: wildcard origins are forbidden in production."
    );
  }

  if (allowCredentials && wildcardConfigured) {
    throw new Error(
      "Unsafe production CORS configuration: credentials cannot be enabled with wildcard origins."
    );
  }

  if (trustedOrigins.length === 0) {
    throw new Error(
      "Unsafe production CORS configuration: set an explicit trusted origin allowlist before starting the server."
    );
  }
};

assertSafeProductionCorsConfig();

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com"
      }
    ]
  }
};

module.exports = nextConfig;
