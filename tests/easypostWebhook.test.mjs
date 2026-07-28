import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { verifyEasyPostWebhook } from "../lib/easypost.js";

test("validates EasyPost v2 signatures and rejects altered payloads", () => {
  const previous = process.env.EASYPOST_WEBHOOK_SECRET;
  process.env.EASYPOST_WEBHOOK_SECRET = "unit-test-secret";
  const timestamp = new Date().toUTCString();
  const path = "/api/webhooks/easypost";
  const body = '{"description":"tracker.updated"}';
  const signature = `hmac-sha256-hex=${crypto.createHmac("sha256", process.env.EASYPOST_WEBHOOK_SECRET).update(`${timestamp}POST${path}${body}`).digest("hex")}`;
  assert.equal(verifyEasyPostWebhook(body, { signature, timestamp, path }), true);
  assert.equal(verifyEasyPostWebhook(`${body} `, { signature, timestamp, path }), false);
  if (previous === undefined) delete process.env.EASYPOST_WEBHOOK_SECRET;
  else process.env.EASYPOST_WEBHOOK_SECRET = previous;
});
