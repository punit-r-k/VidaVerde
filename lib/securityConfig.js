import {
  getTrustedOrigins,
  isWildcardOriginConfigured
} from "@/lib/cors";

let configValidated = false;

export const isProductionSecurityEnvironment = () => {
  const runtimeEnvironment =
    process.env.APP_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV || "development";

  return runtimeEnvironment.toLowerCase() === "production";
};

export const assertSafeSecurityConfig = () => {
  if (!isProductionSecurityEnvironment()) {
    return;
  }

  if (isWildcardOriginConfigured()) {
    throw new Error(
      "Unsafe production CORS configuration: wildcard origins are forbidden in production."
    );
  }

  if (getTrustedOrigins().length === 0) {
    throw new Error(
      "Unsafe production CORS configuration: set an explicit trusted origin allowlist before starting the server."
    );
  }
};

export const ensureSafeSecurityConfig = () => {
  if (configValidated) {
    return;
  }

  assertSafeSecurityConfig();
  configValidated = true;
};

export const hasAmbiguousRequestFraming = (request) =>
  Boolean(request.headers.get("content-length") && request.headers.get("transfer-encoding"));
