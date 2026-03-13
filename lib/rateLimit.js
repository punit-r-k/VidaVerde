const limiter = new Map();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanupAt = 0;

const cleanupExpiredEntries = (now) => {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;

  for (const [key, entry] of limiter.entries()) {
    if (!entry || now > entry.resetAt) {
      limiter.delete(key);
    }
  }

  lastCleanupAt = now;
};

export const getClientId = (request) => {
  const forwardedFor = request?.headers?.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return (
    request?.headers?.get("x-real-ip") ||
    request?.headers?.get("cf-connecting-ip") ||
    "unknown"
  );
};

export const createRateLimitKey = (scope, identifier) => {
  const normalizedScope = String(scope || "global").trim().toLowerCase();
  const normalizedIdentifier = String(identifier || "unknown").trim().toLowerCase();
  return `${normalizedScope}:${normalizedIdentifier}`;
};

export const getRetryAfterSeconds = (resetAt) =>
  Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));

export const getRateLimitHeaders = (state, max) => ({
  "X-RateLimit-Limit": String(max),
  "X-RateLimit-Remaining": String(Math.max(0, Number(state?.remaining || 0))),
  "X-RateLimit-Reset": String(Math.ceil(Number(state?.resetAt || Date.now()) / 1000))
});

export function rateLimit(key, { windowMs, max }) {
  const now = Date.now();
  cleanupExpiredEntries(now);

  const entry = limiter.get(key);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    limiter.set(key, { count: 1, resetAt });
    return { ok: true, resetAt, remaining: max - 1 };
  }

  if (entry.count >= max) {
    return { ok: false, resetAt: entry.resetAt, remaining: 0 };
  }

  entry.count += 1;
  return { ok: true, resetAt: entry.resetAt, remaining: max - entry.count };
}

export const rateLimitByRequest = (
  request,
  { scope = "global", windowMs, max, identifier }
) => {
  const resolvedIdentifier = String(identifier || getClientId(request) || "unknown");
  const key = createRateLimitKey(scope, resolvedIdentifier);
  const state = rateLimit(key, { windowMs, max });

  return {
    ...state,
    key,
    identifier: resolvedIdentifier
  };
};
