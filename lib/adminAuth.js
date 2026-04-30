import crypto from "crypto";

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const base64UrlToBuffer = (value) => {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : normalized.padEnd(normalized.length + (4 - padding), "=");
  return Buffer.from(padded, "base64");
};

const decodeJwtSegment = (value, label) => {
  try {
    return JSON.parse(base64UrlToBuffer(value).toString("utf8"));
  } catch {
    throw new Error(`Invalid JWT ${label}.`);
  }
};

const getBearerToken = (request) => {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
};

const normalizeRoles = (payload) => {
  const roles = [];

  if (Array.isArray(payload?.roles)) {
    roles.push(...payload.roles);
  }

  if (typeof payload?.role === "string") {
    roles.push(payload.role);
  }

  return [...new Set(roles.map((role) => String(role || "").trim().toLowerCase()).filter(Boolean))];
};

const matchesExpectedAudience = (actualAudience, expectedAudience) => {
  if (!expectedAudience) return true;

  const audiences = Array.isArray(actualAudience) ? actualAudience : [actualAudience];
  return audiences.some((entry) => String(entry || "").trim() === expectedAudience);
};

const getAdminJwtConfig = () => ({
  secret: process.env.ADMIN_JWT_SECRET || process.env.ADMIN_RESTOCK_SECRET || "",
  issuer: process.env.ADMIN_JWT_ISSUER || "vidaverde-admin",
  audience: process.env.ADMIN_JWT_AUDIENCE || "vidaverde-admin-api",
  clockToleranceSeconds: toPositiveInt(process.env.ADMIN_JWT_CLOCK_TOLERANCE_SECONDS, 30),
  maxLifetimeSeconds: toPositiveInt(process.env.ADMIN_JWT_MAX_LIFETIME_SECONDS, 300)
});

const verifySignature = (token, signatureSegment, secret) => {
  const expected = crypto.createHmac("sha256", secret).update(token).digest();
  const provided = base64UrlToBuffer(signatureSegment);

  if (expected.length !== provided.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, provided);
};

export const authenticateAdminRequest = (request, { requiredRoles = [] } = {}) => {
  const config = getAdminJwtConfig();
  if (!config.secret) {
    return {
      ok: false,
      status: 500,
      error: "Admin sign-in is not set up right now."
    };
  }

  const token = getBearerToken(request);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "Authentication required.",
      wwwAuthenticate: 'Bearer realm="admin", error="invalid_token"'
    };
  }

  let header;
  let payload;
  const segments = token.split(".");

  if (segments.length !== 3) {
    return {
      ok: false,
      status: 401,
      error: "Invalid or expired token.",
      wwwAuthenticate: 'Bearer realm="admin", error="invalid_token"'
    };
  }

  try {
    [header, payload] = [decodeJwtSegment(segments[0], "header"), decodeJwtSegment(segments[1], "payload")];
  } catch {
    return {
      ok: false,
      status: 401,
      error: "Invalid or expired token.",
      wwwAuthenticate: 'Bearer realm="admin", error="invalid_token"'
    };
  }

  if (header?.alg !== "HS256" || !verifySignature(`${segments[0]}.${segments[1]}`, segments[2], config.secret)) {
    return {
      ok: false,
      status: 401,
      error: "Invalid or expired token.",
      wwwAuthenticate: 'Bearer realm="admin", error="invalid_token"'
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const clockTolerance = config.clockToleranceSeconds;
  const subject = String(payload?.sub || "").trim();
  const issuedAt = Number(payload?.iat);
  const notBefore = Number(payload?.nbf ?? issuedAt);
  const expiresAt = Number(payload?.exp);

  if (!subject || !Number.isFinite(expiresAt)) {
    return {
      ok: false,
      status: 401,
      error: "Invalid or expired token.",
      wwwAuthenticate: 'Bearer realm="admin", error="invalid_token"'
    };
  }

  if (
    (config.issuer && String(payload?.iss || "").trim() !== config.issuer) ||
    !matchesExpectedAudience(payload?.aud, config.audience)
  ) {
    return {
      ok: false,
      status: 401,
      error: "Invalid or expired token.",
      wwwAuthenticate: 'Bearer realm="admin", error="invalid_token"'
    };
  }

  if (
    (Number.isFinite(issuedAt) && issuedAt > now + clockTolerance) ||
    (Number.isFinite(notBefore) && notBefore > now + clockTolerance) ||
    expiresAt <= now - clockTolerance
  ) {
    return {
      ok: false,
      status: 401,
      error: "Invalid or expired token.",
      wwwAuthenticate: 'Bearer realm="admin", error="invalid_token"'
    };
  }

  if (
    Number.isFinite(issuedAt) &&
    expiresAt - issuedAt > config.maxLifetimeSeconds + clockTolerance
  ) {
    return {
      ok: false,
      status: 401,
      error: "Invalid or expired token.",
      wwwAuthenticate: 'Bearer realm="admin", error="invalid_token"'
    };
  }

  const roles = normalizeRoles(payload);
  const normalizedRequiredRoles = requiredRoles
    .map((role) => String(role || "").trim().toLowerCase())
    .filter(Boolean);
  const hasRequiredRole =
    normalizedRequiredRoles.length === 0 ||
    normalizedRequiredRoles.some((role) => roles.includes(role));

  if (!hasRequiredRole) {
    return {
      ok: false,
      status: 403,
      error: "You do not have permission to access this resource.",
      wwwAuthenticate: 'Bearer realm="admin", error="insufficient_scope"'
    };
  }

  return {
    ok: true,
    auth: {
      subject,
      roles,
      tokenId: String(payload?.jti || "").trim() || null,
      expiresAt
    }
  };
};
