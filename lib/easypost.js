import crypto from "node:crypto";

const API_BASE = "https://api.easypost.com/v2";

const getApiKey = () => {
  const key = String(process.env.EASYPOST_API_KEY || "").trim();
  if (!key) throw new Error("EasyPost is not configured.");
  return key;
};

export async function easyPostRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${getApiKey()}:`).toString("base64")}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `EasyPost request failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}

export const getFromAddress = () => ({
  name: process.env.EASYPOST_FROM_NAME || "Vida Verde Sauerkraut",
  street1: process.env.EASYPOST_FROM_STREET1 || "7002 Sugar Oaks Ct",
  city: process.env.EASYPOST_FROM_CITY || "Richmond",
  state: process.env.EASYPOST_FROM_STATE || "TX",
  zip: process.env.EASYPOST_FROM_ZIP || "77407",
  country: process.env.EASYPOST_FROM_COUNTRY || "US",
  phone: process.env.EASYPOST_FROM_PHONE || "+17134781878",
  email: process.env.EASYPOST_FROM_EMAIL || "vidaverdemicrogreens@gmail.com"
});

export const createEasyPostShipment = ({ toAddress, parcel, options }) => easyPostRequest("/shipments", {
  method: "POST",
  body: {
    shipment: {
      to_address: toAddress,
      from_address: getFromAddress(),
      parcel,
      ...(options ? { options } : {})
    }
  }
});

export const getEasyPostShipment = (shipmentId) =>
  easyPostRequest(`/shipments/${encodeURIComponent(shipmentId)}`);

export const buyEasyPostShipment = (shipmentId, rateId) => easyPostRequest(`/shipments/${encodeURIComponent(shipmentId)}/buy`, {
  method: "POST",
  body: { rate: { id: rateId } }
});

export function verifyEasyPostWebhook(rawBody, { signature, timestamp, path, method = "POST" }) {
  const secret = String(process.env.EASYPOST_WEBHOOK_SECRET || "").trim();
  if (!secret || !signature || !timestamp || !path) return false;
  const sentAt = Date.parse(timestamp);
  const ageMs = Date.now() - sentAt;
  if (!Number.isFinite(sentAt) || ageMs > 60_000 || ageMs < -30_000) return false;
  const stringToSign = `${timestamp}${String(method).toUpperCase()}${path}${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(stringToSign, "utf8").digest("hex");
  const actual = String(signature).replace(/^hmac-sha256-hex=/i, "").trim().toLowerCase();
  return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
