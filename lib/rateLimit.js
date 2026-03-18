import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const limiter = new Map();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanupAt = 0;

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getWindowSeconds = (windowMs) => Math.max(1, Math.ceil(Number(windowMs || 0) / 1000));

const cleanupExpiredEntries = (now) => {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;

  for (const [key, entry] of limiter.entries()) {
    if (!entry || now > entry.resetAt) {
      limiter.delete(key);
    }
  }

  lastCleanupAt = now;
};

const hashIdentifier = (key) => {
  const secret =
    process.env.RATE_LIMIT_KEY_SECRET ||
    process.env.ADMIN_JWT_SECRET ||
    process.env.ADMIN_RESTOCK_SECRET ||
    "";
  if (secret) {
    return crypto.createHmac("sha256", secret).update(key).digest("hex");
  }

  return crypto.createHash("sha256").update(key).digest("hex");
};

const isMissingDistributedLimiter = (error) => {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    message.includes("consume_api_rate_limit") ||
    message.includes("api_rate_limits") ||
    message.includes("does not exist") ||
    message.includes("could not find the function")
  );
};

const consumeDistributedRateLimit = async (bucket, { scope, windowMs, max }) => {
  if (!supabaseAdmin || String(process.env.RATE_LIMIT_BACKEND || "").toLowerCase() === "memory") {
    return null;
  }

  const { data, error } = await supabaseAdmin.rpc("consume_api_rate_limit", {
    p_bucket: bucket,
    p_scope: scope,
    p_window_seconds: getWindowSeconds(windowMs),
    p_max: max
  });

  if (error) {
    if (!isMissingDistributedLimiter(error)) {
      console.error("distributed rate limit error:", error);
    }
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  return {
    ok: Boolean(row.allowed),
    count: Number(row.count || 0),
    remaining: Math.max(0, Number(row.remaining || 0)),
    resetAt: new Date(row.reset_at).getTime(),
    max,
    windowMs
  };
};

const consumeInMemoryRateLimit = (key, { windowMs, max }) => {
  const now = Date.now();
  cleanupExpiredEntries(now);

  const entry = limiter.get(key);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    limiter.set(key, { count: 1, resetAt });
    return { ok: true, count: 1, resetAt, remaining: max - 1, max, windowMs };
  }

  if (entry.count >= max) {
    return { ok: false, count: entry.count, resetAt: entry.resetAt, remaining: 0, max, windowMs };
  }

  entry.count += 1;
  return {
    ok: true,
    count: entry.count,
    resetAt: entry.resetAt,
    remaining: max - entry.count,
    max,
    windowMs
  };
};

const consumeRateLimit = async (key, options) => {
  const distributed = await consumeDistributedRateLimit(hashIdentifier(key), {
    scope: options.scope,
    windowMs: options.windowMs,
    max: options.max
  });

  if (distributed) {
    return distributed;
  }

  return consumeInMemoryRateLimit(key, options);
};

const rateLimitPriority = (state) => {
  if (!state) return Number.POSITIVE_INFINITY;
  const remainingRatio = state.max > 0 ? state.remaining / state.max : 0;
  return remainingRatio;
};

const pickPrimaryState = (states) => {
  if (!Array.isArray(states) || states.length === 0) return null;

  return [...states].sort((left, right) => {
    const ratioDelta = rateLimitPriority(left) - rateLimitPriority(right);
    if (ratioDelta !== 0) return ratioDelta;

    const remainingDelta = left.remaining - right.remaining;
    if (remainingDelta !== 0) return remainingDelta;

    return left.resetAt - right.resetAt;
  })[0];
};

export const getClientId = (request) => {
  const forwardedFor =
    request?.headers?.get("x-vercel-forwarded-for") ||
    request?.headers?.get("cf-connecting-ip") ||
    request?.headers?.get("x-real-ip") ||
    request?.headers?.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return "unknown";
};

export const createRateLimitKey = (scope, identifier, label = "ip") => {
  const normalizedScope = String(scope || "global").trim().toLowerCase();
  const normalizedIdentifier = String(identifier || "unknown").trim().toLowerCase();
  const normalizedLabel = String(label || "ip").trim().toLowerCase();
  return `${normalizedScope}:${normalizedLabel}:${normalizedIdentifier}`;
};

export const getRetryAfterSeconds = (resetAt) =>
  Math.max(1, Math.ceil((Number(resetAt || 0) - Date.now()) / 1000));

export const getRateLimitHeaders = (state) => {
  if (!state) return {};

  const remaining = Math.max(0, Number(state.remaining || 0));
  const resetAt = Number(state.resetAt || Date.now());
  const resetSeconds = getRetryAfterSeconds(resetAt);
  const limit = String(state.max || 0);

  return {
    "RateLimit-Limit": limit,
    "RateLimit-Remaining": String(remaining),
    "RateLimit-Reset": String(resetSeconds),
    "RateLimit-Policy": `${limit};w=${getWindowSeconds(state.windowMs)}`,
    "X-RateLimit-Limit": limit,
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000))
  };
};

export const getRouteRateLimitConfig = (scopeKey, defaults) => ({
  windowMs: toPositiveInt(
    process.env[`RATE_LIMIT_${scopeKey}_WINDOW_MS`],
    defaults.windowMs
  ),
  ipMax: toPositiveInt(process.env[`RATE_LIMIT_${scopeKey}_IP_MAX`], defaults.ipMax),
  userMax:
    defaults.userMax === undefined
      ? undefined
      : toPositiveInt(process.env[`RATE_LIMIT_${scopeKey}_USER_MAX`], defaults.userMax)
});

export const combineRateLimitResults = (...results) => {
  const states = results.flatMap((result) => result?.states || []);
  const blockedStates = states.filter((state) => !state.ok);

  return {
    ok: blockedStates.length === 0,
    states,
    primary: pickPrimaryState(blockedStates.length > 0 ? blockedStates : states)
  };
};

export const enforceRateLimit = async (
  request,
  { scope = "global", windowMs, ipMax = 0, userId, userMax = 0 }
) => {
  const states = [];
  const ip = getClientId(request);

  if (ipMax > 0) {
    const ipKey = createRateLimitKey(scope, ip, "ip");
    const ipState = await consumeRateLimit(ipKey, {
      scope: `${scope}:ip`,
      windowMs,
      max: ipMax
    });
    states.push({
      ...ipState,
      label: "ip"
    });
  }

  if (userId && userMax > 0) {
    const userKey = createRateLimitKey(scope, userId, "user");
    const userState = await consumeRateLimit(userKey, {
      scope: `${scope}:user`,
      windowMs,
      max: userMax
    });
    states.push({
      ...userState,
      label: "user"
    });
  }

  const blockedStates = states.filter((state) => !state.ok);

  return {
    ok: blockedStates.length === 0,
    states,
    primary: pickPrimaryState(blockedStates.length > 0 ? blockedStates : states)
  };
};
