import crypto from "crypto";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripeApiVersion = process.env.STRIPE_API_VERSION || "2024-06-20";

export const stripeConfig = stripeSecretKey
  ? {
      baseUrl: "https://api.stripe.com",
      secretKey: stripeSecretKey,
      apiVersion: stripeApiVersion
    }
  : null;

const appendFormValue = (params, key, value) => {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      appendFormValue(params, `${key}[${index}]`, entry);
    });
    return;
  }

  if (typeof value === "object") {
    Object.entries(value).forEach(([childKey, childValue]) => {
      appendFormValue(params, `${key}[${childKey}]`, childValue);
    });
    return;
  }

  params.append(key, String(value));
};

const toFormBody = (payload) => {
  const params = new URLSearchParams();

  Object.entries(payload || {}).forEach(([key, value]) => {
    appendFormValue(params, key, value);
  });

  return params.toString();
};

export async function stripeRequest(path, { method = "POST", body } = {}) {
  if (!stripeConfig) {
    return {
      ok: false,
      status: 500,
      error: "Stripe is not connected right now."
    };
  }

  const response = await fetch(`${stripeConfig.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeConfig.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": stripeConfig.apiVersion
    },
    body: body ? toFormBody(body) : undefined
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: data?.error || data?.errors || data || text
    };
  }

  return { ok: true, status: response.status, data };
}

export function verifyStripeSignature({
  payload,
  signatureHeader,
  secret,
  toleranceSeconds = 300
}) {
  if (!signatureHeader || !secret) {
    return { ok: false, error: "Missing signature." };
  }

  const parts = signatureHeader
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((acc, segment) => {
      const [key, ...rest] = segment.split("=");
      if (!key || rest.length === 0) return acc;
      const value = rest.join("=");
      if (!acc[key]) acc[key] = [];
      acc[key].push(value);
      return acc;
    }, {});

  const timestamp = Number(parts?.t?.[0]);
  const signatures = parts?.v1 || [];

  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    return { ok: false, error: "Invalid signature format." };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { ok: false, error: "Signature timestamp outside tolerance." };
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "utf8");
  const hasMatch = signatures.some((signature) => {
    const sigBuffer = Buffer.from(signature, "utf8");
    if (sigBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  });

  return hasMatch
    ? { ok: true }
    : { ok: false, error: "Invalid signature." };
}
