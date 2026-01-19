const limiter = new Map();

export function rateLimit(key, { windowMs, max }) {
  const now = Date.now();
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
