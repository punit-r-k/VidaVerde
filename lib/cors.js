const DEFAULT_DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];
const DEFAULT_ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const DEFAULT_ALLOWED_HEADERS = [
  "Authorization",
  "Content-Type",
  "Stripe-Signature"
];
const DEFAULT_EXPOSED_HEADERS = [
  "RateLimit-Limit",
  "RateLimit-Remaining",
  "RateLimit-Reset",
  "RateLimit-Policy",
  "Retry-After",
  "X-RateLimit-Limit",
  "X-RateLimit-Remaining",
  "X-RateLimit-Reset"
];
const ENVIRONMENT_ALIASES = {
  production: "PRODUCTION",
  preview: "STAGING",
  staging: "STAGING",
  development: "DEVELOPMENT",
  dev: "DEVELOPMENT",
  test: "DEVELOPMENT"
};

const splitCsv = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeOrigin = (value) => {
  if (!value) return null;

  if (String(value).trim() === "*") {
    return "*";
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

export const getEnvironmentBucket = () => {
  const explicitEnv =
    process.env.APP_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
  return ENVIRONMENT_ALIASES[explicitEnv.toLowerCase()] || "DEVELOPMENT";
};

const normalizeHeaderName = (value) => String(value || "").trim().toLowerCase();

const getAllowedMethods = () => {
  const configured = splitCsv(process.env.CORS_ALLOWED_METHODS);
  return configured.length > 0 ? configured.map((method) => method.toUpperCase()) : DEFAULT_ALLOWED_METHODS;
};

const getAllowedHeaders = () => {
  const configured = splitCsv(process.env.CORS_ALLOWED_HEADERS);
  return configured.length > 0 ? configured : DEFAULT_ALLOWED_HEADERS;
};

const getExposedHeaders = () => {
  const configured = splitCsv(process.env.CORS_EXPOSED_HEADERS);
  return configured.length > 0 ? configured : DEFAULT_EXPOSED_HEADERS;
};

const getConfiguredOriginTokens = () => {
  const envBucket = getEnvironmentBucket();
  const configuredOrigins = [
    ...splitCsv(process.env.CORS_ALLOWED_ORIGINS),
    ...splitCsv(process.env[`CORS_ALLOWED_ORIGINS_${envBucket}`]),
    process.env.SITE_URL,
    process.env.NEXT_PUBLIC_SITE_URL
  ];

  if (envBucket !== "PRODUCTION") {
    configuredOrigins.push(...DEFAULT_DEV_ORIGINS);
  }

  return [...new Set(configuredOrigins.map(normalizeOrigin).filter(Boolean))];
};

export const getTrustedOrigins = () => {
  const configuredOrigins = getConfiguredOriginTokens();
  const allowWildcard =
    configuredOrigins.includes("*") &&
    getEnvironmentBucket() !== "PRODUCTION" &&
    !isCorsCredentialsEnabled();

  if (!allowWildcard) {
    return configuredOrigins.filter((origin) => origin !== "*");
  }

  return configuredOrigins;
};

export const isCorsCredentialsEnabled = () =>
  String(process.env.CORS_ALLOW_CREDENTIALS || "").toLowerCase() === "true";

export const isWildcardOriginConfigured = () => getConfiguredOriginTokens().includes("*");

export const isTrustedOrigin = (origin) => {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;

  const trustedOrigins = getTrustedOrigins();
  return trustedOrigins.includes("*") || trustedOrigins.includes(normalizedOrigin);
};

export const getCorsHeaders = (origin) => {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return new Headers();
  }

  const allowCredentials = isCorsCredentialsEnabled();
  const trustedOrigins = getTrustedOrigins();
  const useWildcardOrigin = trustedOrigins.includes("*") && !allowCredentials;
  const headers = new Headers();
  headers.set(
    "Access-Control-Allow-Origin",
    useWildcardOrigin ? "*" : normalizedOrigin
  );
  headers.set("Access-Control-Allow-Methods", getAllowedMethods().join(", "));
  headers.set("Access-Control-Allow-Headers", getAllowedHeaders().join(", "));
  headers.set("Access-Control-Expose-Headers", getExposedHeaders().join(", "));
  headers.set(
    "Access-Control-Max-Age",
    String(toPositiveInt(process.env.CORS_MAX_AGE_SECONDS, 600))
  );
  headers.set("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");

  if (allowCredentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  return headers;
};

export const isPreflightRequest = (request) =>
  request.method === "OPTIONS" &&
  Boolean(request.headers.get("origin")) &&
  Boolean(request.headers.get("access-control-request-method"));

export const validateCorsRequest = (request) => {
  const origin = request.headers.get("origin");
  if (!origin) {
    return { ok: true, headers: new Headers() };
  }

  if (!isTrustedOrigin(origin)) {
    return { ok: false, reason: "origin" };
  }

  const requestedMethod = String(
    request.headers.get("access-control-request-method") || request.method || ""
  ).toUpperCase();
  const allowedMethods = getAllowedMethods();

  if (requestedMethod && !allowedMethods.includes(requestedMethod)) {
    return { ok: false, reason: "method" };
  }

  const allowedHeaders = getAllowedHeaders();
  const allowedHeaderSet = new Set(allowedHeaders.map(normalizeHeaderName));
  const requestedHeaders = splitCsv(request.headers.get("access-control-request-headers"));
  const hasUnexpectedHeader = requestedHeaders.some(
    (header) => !allowedHeaderSet.has(normalizeHeaderName(header))
  );

  if (hasUnexpectedHeader) {
    return { ok: false, reason: "header" };
  }

  return {
    ok: true,
    headers: getCorsHeaders(origin)
  };
};
