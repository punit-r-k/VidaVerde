import crypto from "node:crypto";

const API_BASE = "https://api.easypost.com/v2";
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;

const getApiKey = () => {
  const key = String(process.env.EASYPOST_API_KEY || "").trim();
  if (!key) throw new Error("EasyPost is not configured.");
  return key;
};

const getRequestTimeoutMs = (value) => {
  const configured = Number(value ?? process.env.EASYPOST_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(Math.floor(configured), MAX_REQUEST_TIMEOUT_MS);
};

export const isUsdEasyPostRate = (rate) =>
  String(rate?.currency || "").trim().toUpperCase() === "USD";

export async function easyPostRequest(
  path,
  { method = "GET", body, timeoutMs } = {}
) {
  const controller = new AbortController();
  const requestTimeoutMs = getRequestTimeoutMs(timeoutMs);
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(`${getApiKey()}:`).toString("base64")}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || data?.message ||
        `EasyPost request failed (${response.status}).`;
      throw new Error(message);
    }
    return data;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`EasyPost request timed out after ${requestTimeoutMs}ms.`, {
        cause: error
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const getFromAddress = () => {
  const address = {
    name: String(process.env.EASYPOST_FROM_NAME || "Vida Verde Sauerkraut").trim(),
    street1: String(process.env.EASYPOST_FROM_STREET1 || "").trim(),
    city: String(process.env.EASYPOST_FROM_CITY || "").trim(),
    state: String(process.env.EASYPOST_FROM_STATE || "").trim(),
    zip: String(process.env.EASYPOST_FROM_ZIP || "").trim(),
    country: String(process.env.EASYPOST_FROM_COUNTRY || "US").trim(),
    phone: String(process.env.EASYPOST_FROM_PHONE || "").trim(),
    email: String(process.env.EASYPOST_FROM_EMAIL || "").trim()
  };
  const missing = Object.entries(address)
    .filter(([, value]) => !value)
    .map(([key]) => `EASYPOST_FROM_${key === "zip" ? "ZIP" : key.toUpperCase()}`);

  if (missing.length > 0) {
    throw new Error(`EasyPost return address is incomplete. Set ${missing.join(", ")}.`);
  }

  return address;
};

const normalizeAddressReference = (address) =>
  typeof address === "string" ? { id: address } : address;

export const createEasyPostShipment = ({ toAddress, parcel, options, timeoutMs }) => easyPostRequest("/shipments", {
  method: "POST",
  timeoutMs,
  body: {
    shipment: {
      to_address: normalizeAddressReference(toAddress),
      from_address: getFromAddress(),
      parcel,
      ...(options ? { options } : {})
    }
  }
});

export const createAndVerifyEasyPostAddress = async (address, { timeoutMs } = {}) => {
  const response = await easyPostRequest("/addresses/create_and_verify", {
    method: "POST",
    timeoutMs,
    body: { address }
  });
  const verified = response?.address || response;
  if (!verified?.id) {
    throw new Error("The shipping address could not be verified.");
  }
  return verified;
};

export const getEasyPostShipment = (shipmentId, { timeoutMs } = {}) =>
  easyPostRequest(`/shipments/${encodeURIComponent(shipmentId)}`, { timeoutMs });

export const buyEasyPostShipment = (shipmentId, rateId, { timeoutMs } = {}) => easyPostRequest(`/shipments/${encodeURIComponent(shipmentId)}/buy`, {
  method: "POST",
  timeoutMs,
  body: { rate: { id: rateId } }
});

export function verifyEasyPostWebhook(rawBody, { signature } = {}) {
  const secret = String(process.env.EASYPOST_WEBHOOK_SECRET || "");
  const actual = String(signature || "").trim();
  if (!secret || !actual) return false;

  const body = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody ?? ""), "utf8");
  const digest = crypto
    .createHmac("sha256", secret.normalize("NFKD"))
    .update(body)
    .digest("hex");
  const expected = `hmac-sha256-hex=${digest}`;
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");

  return expectedBytes.length === actualBytes.length &&
    crypto.timingSafeEqual(expectedBytes, actualBytes);
}
