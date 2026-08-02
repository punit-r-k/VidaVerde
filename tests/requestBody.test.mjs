import assert from "node:assert/strict";
import test from "node:test";

import {
  readBoundedJsonBody,
  readBoundedTextBody
} from "../lib/requestBody.js";

test("rejects an oversized declared Content-Length before consuming the body", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    headers: { "Content-Length": "1025" },
    body: "{}"
  });

  assert.deepEqual(
    await readBoundedJsonBody(request, { maxBytes: 1_024 }),
    { ok: false, status: 413, code: "body_too_large" }
  );
  assert.equal(request.bodyUsed, false);
});

test("counts actual UTF-8 bytes rather than JavaScript characters", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    body: "éé"
  });

  assert.deepEqual(
    await readBoundedTextBody(request, { maxBytes: 3 }),
    { ok: false, status: 413, code: "body_too_large" }
  );
});

test("returns exact raw webhook text within the byte limit", async () => {
  const raw = '{"type":"payment_intent.succeeded","emoji":"🌱"}';
  const result = await readBoundedTextBody(
    new Request("https://example.test", { method: "POST", body: raw }),
    { maxBytes: 256 }
  );

  assert.equal(result.ok, true);
  assert.equal(result.text, raw);
  assert.equal(result.bytes, new TextEncoder().encode(raw).byteLength);
});

test("parses valid bounded JSON and rejects malformed JSON", async () => {
  const valid = await readBoundedJsonBody(
    new Request("https://example.test", { method: "POST", body: '{"ok":true}' }),
    { maxBytes: 64 }
  );
  assert.deepEqual(valid.data, { ok: true });

  const invalid = await readBoundedJsonBody(
    new Request("https://example.test", { method: "POST", body: "{" }),
    { maxBytes: 64 }
  );
  assert.deepEqual(invalid, { ok: false, status: 400, code: "invalid_json" });
});
