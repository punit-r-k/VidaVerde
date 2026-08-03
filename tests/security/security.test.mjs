import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildAnalyticsReportFromRows,
  formatAnalyticsReportMarkdown
} from "../../lib/analytics/report.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const nextBin = path.join(repoRoot, "node_modules", "next", "dist", "bin", "next");
const host = "127.0.0.1";
const port = 3200;
const baseUrl = `http://${host}:${port}`;

const baseEnvironment = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  STRIPE_SECRET_KEY: "sk_test_dummy",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_dummy",
  STRIPE_WEBHOOK_SECRET: "whsec_dummy",
  STRIPE_API_VERSION: "2026-03-25.dahlia",
  SITE_URL: baseUrl,
  CORS_ALLOWED_ORIGINS: baseUrl,
  CORS_ALLOWED_ORIGINS_PRODUCTION: baseUrl,
  ADMIN_JWT_SECRET: "test-admin-secret-please-rotate-at-least-32-bytes",
  ADMIN_JWT_ISSUER: "vidaverde-admin",
  ADMIN_JWT_AUDIENCE: "vidaverde-admin-api",
  RATE_LIMIT_BACKEND: "memory"
};

const privilegedEndpoints = [
  { name: "admin orders", method: "GET", path: "/api/admin/orders" },
  { name: "admin shipments", method: "GET", path: "/api/admin/shipments" },
  { name: "admin shipment refresh", method: "POST", path: "/api/admin/shipments", body: {} },
  { name: "admin shipment labels", method: "POST", path: "/api/admin/shipments/00000000-0000-4000-8000-000000000000/labels", body: {} },
  { name: "admin prep", method: "GET", path: "/api/admin/prep" },
  { name: "admin health", method: "GET", path: "/api/admin/health" },
  { name: "admin pickup reminders", method: "POST", path: "/api/admin/pickup-reminders", body: {} },
  { name: "admin email jobs", method: "POST", path: "/api/admin/email-jobs", body: {} },
  { name: "admin inventory get", method: "GET", path: "/api/admin/inventory" },
  {
    name: "admin inventory patch",
    method: "PATCH",
    path: "/api/admin/inventory",
    body: { show_stock: true }
  },
  {
    name: "admin restock",
    method: "POST",
    path: "/api/admin/restock",
    body: { sku: "VV1", restock: 1 }
  }
];

const createAdminJwt = ({ roles, sub = "security-test-admin", claims = {} }) => {
  const encodeBase64Url = (value) =>
    Buffer.from(JSON.stringify(value))
      .toString("base64url");

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "HS256",
    typ: "JWT"
  };
  const payload = {
    iss: baseEnvironment.ADMIN_JWT_ISSUER,
    aud: baseEnvironment.ADMIN_JWT_AUDIENCE,
    sub,
    roles,
    iat: now,
    nbf: now - 5,
    exp: now + 60,
    jti: crypto.randomUUID(),
    ...claims
  };

  const encodedHeader = encodeBase64Url(header);
  const encodedPayload = encodeBase64Url(payload);
  const signature = crypto
    .createHmac("sha256", baseEnvironment.ADMIN_JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

const runNpmScript = (scriptName, envOverrides = {}) =>
  new Promise((resolve) => {
    const command =
      process.platform === "win32"
        ? ["cmd.exe", ["/c", "npm.cmd", "run", scriptName]]
        : ["npm", ["run", scriptName]];

    const child = spawn(command[0], command[1], {
      cwd: repoRoot,
      env: {
        ...baseEnvironment,
        ...envOverrides
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("close", (code) => {
      resolve({ code, output });
    });
  });

const startServer = async (envOverrides = {}) => {
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: repoRoot,
    env: {
      ...baseEnvironment,
      ...envOverrides
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Next server exited early.\n${output}`);
    }

    try {
      const response = await fetch(`${baseUrl}/api/inventory`, {
        headers: {
          Origin: baseUrl
        }
      });

      if (response.ok || response.status === 500 || response.status === 503) {
        return {
          child,
          output
        };
      }
    } catch {
      // Server is still booting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  child.kill("SIGTERM");
  throw new Error(`Timed out waiting for Next server.\n${output}`);
};

const stopServer = async (server) => {
  if (!server?.child || server.child.exitCode !== null) {
    return;
  }

  server.child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (server.child.exitCode === null) {
    server.child.kill("SIGKILL");
  }
};

const requestJson = async (pathName, options = {}) => {
  const response = await fetch(`${baseUrl}${pathName}`, {
    redirect: "manual",
    ...options
  });
  const text = await response.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  return { response, text, json };
};

const sendRawHttpRequest = (rawRequest) =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write(rawRequest);
    });

    let response = "";
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
  });

test("security regression suite", { timeout: 300_000 }, async (t) => {
  const unsafeBuild = await runNpmScript("build", {
    CORS_ALLOWED_ORIGINS_PRODUCTION: "*"
  });
  assert.notEqual(
    unsafeBuild.code,
    0,
    "Production builds must fail closed on wildcard CORS configuration."
  );
  assert.match(unsafeBuild.output, /Unsafe production CORS configuration/i);

  const weakAdminSecretBuild = await runNpmScript("build", {
    ADMIN_JWT_SECRET: "too-short"
  });
  assert.notEqual(weakAdminSecretBuild.code, 0);
  assert.match(weakAdminSecretBuild.output, /ADMIN_JWT_SECRET must contain at least 32/i);

  const testProviderProductionBuild = await runNpmScript("build", {
    VERCEL_ENV: "production",
    EASYPOST_API_KEY: "EZTK_local_test_key",
    EASYPOST_WEBHOOK_SECRET: "local-test-webhook-secret",
    EASYPOST_FROM_STREET1: "7002 Sugar Oaks Ct",
    EASYPOST_FROM_CITY: "Richmond",
    EASYPOST_FROM_STATE: "TX",
    EASYPOST_FROM_ZIP: "77407",
    EASYPOST_FROM_PHONE: "+12815550100",
    EASYPOST_FROM_EMAIL: "shipping@example.com"
  });
  assert.notEqual(testProviderProductionBuild.code, 0);
  assert.match(
    testProviderProductionBuild.output,
    /test API keys cannot be deployed to production|test API key cannot be deployed to production/i
  );

  const safeBuild = await runNpmScript("build");
  assert.equal(safeBuild.code, 0, safeBuild.output);

  const server = await startServer();
  t.after(async () => {
    await stopServer(server);
  });

  await t.test("unauthenticated callers are denied on every privileged endpoint", async () => {
    for (const endpoint of privilegedEndpoints) {
      const { response, json } = await requestJson(endpoint.path, {
        method: endpoint.method,
        headers: endpoint.body ? { "Content-Type": "application/json" } : undefined,
        body: endpoint.body ? JSON.stringify(endpoint.body) : undefined
      });

      assert.equal(response.status, 401, `${endpoint.name} should reject unauthenticated access.`);
      assert.equal(json?.error, "Authentication required.");
    }
  });

  await t.test("non-admin roles are denied on every privileged endpoint", async () => {
    const viewerToken = createAdminJwt({
      roles: ["viewer"],
      sub: "security-test-viewer"
    });

    for (const endpoint of privilegedEndpoints) {
      const headers = {
        Authorization: `Bearer ${viewerToken}`
      };

      if (endpoint.body) {
        headers["Content-Type"] = "application/json";
      }

      const { response, json } = await requestJson(endpoint.path, {
        method: endpoint.method,
        headers,
        body: endpoint.body ? JSON.stringify(endpoint.body) : undefined
      });

      assert.equal(response.status, 403, `${endpoint.name} should reject non-admin access.`);
      assert.match(String(json?.error || ""), /permission/i);
    }
  });

  await t.test("admin JWTs require bounded integer time claims", async () => {
    const now = Math.floor(Date.now() / 1000);
    const invalidTokens = [
      createAdminJwt({ roles: ["ops_admin"], claims: { iat: undefined } }),
      createAdminJwt({ roles: ["ops_admin"], claims: { nbf: undefined } }),
      createAdminJwt({ roles: ["ops_admin"], claims: { exp: undefined } }),
      createAdminJwt({ roles: ["ops_admin"], claims: { iat: now - 0.5 } }),
      createAdminJwt({ roles: ["ops_admin"], claims: { iat: now + 600, nbf: now + 600, exp: now + 660 } }),
      createAdminJwt({ roles: ["ops_admin"], claims: { iat: now - 1_000, nbf: now - 1_000, exp: now + 60 } })
    ];

    for (const token of invalidTokens) {
      const { response } = await requestJson("/api/admin/health", {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(response.status, 401);
    }
  });

  await t.test("admin query params reject injection payloads", async () => {
    const opsToken = createAdminJwt({
      roles: ["ops_admin"],
      sub: "security-test-ops"
    });

    const ordersAttempt = await requestJson(
      "/api/admin/orders?status=paid%27%20OR%201%3D1--",
      {
        headers: {
          Authorization: `Bearer ${opsToken}`
        }
      }
    );
    assert.equal(ordersAttempt.response.status, 400);

    const shipmentsAttempt = await requestJson(
      "/api/admin/shipments?status=shipped%27%20OR%20%271%27=%271",
      {
        headers: {
          Authorization: `Bearer ${opsToken}`
        }
      }
    );
    assert.equal(shipmentsAttempt.response.status, 400);
  });

  await t.test("admin mutation bodies reject injection payloads", async () => {
    const inventoryToken = createAdminJwt({
      roles: ["inventory_admin"],
      sub: "security-test-inventory"
    });
    const opsToken = createAdminJwt({
      roles: ["ops_admin"],
      sub: "security-test-ops-mutation"
    });

    const inventoryAttempt = await requestJson("/api/admin/inventory", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${inventoryToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sku: "VV1'; DROP TABLE inventory;--",
        preorders_remaining: 1
      })
    });
    assert.equal(inventoryAttempt.response.status, 400);

    const restockAttempt = await requestJson("/api/admin/restock", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${inventoryToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sku: "VV1",
        restock: "1; DROP TABLE inventory"
      })
    });
    assert.equal(restockAttempt.response.status, 400);

    const emailJobsAttempt = await requestJson("/api/admin/email-jobs", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opsToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        limit: "1; DROP TABLE email_jobs;--"
      })
    });
    assert.equal(emailJobsAttempt.response.status, 400);
  });

  await t.test("public checkout payload rejects injection-shaped cart values", async () => {
    const { response, json } = await requestJson("/api/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: JSON.stringify({
        fulfillment: "market",
        customer: {
          name: "Test User",
          email: "security@example.com",
          phone: "+15555550123",
          address1: "",
          address2: "",
          city: "",
          state: "",
          postalCode: "",
          note: ""
        },
        items: [
          {
            sku: "VV1'; DROP TABLE orders;--",
            quantity: 1
          }
        ]
      })
    });

    assert.equal(response.status, 400);
    assert.match(JSON.stringify(json), /cart|refresh/i);

    const quantityAttempt = await requestJson("/api/order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: JSON.stringify({
        fulfillment: "market",
        customer: {
          name: "Test User",
          email: "security@example.com",
          phone: "+15555550123",
          address1: "",
          address2: "",
          city: "",
          state: "",
          postalCode: "",
          note: ""
        },
        items: [
          {
            sku: "VV1",
            quantity: "1; DROP TABLE orders;--"
          }
        ]
      })
    });

    assert.equal(quantityAttempt.response.status, 400);
    assert.match(JSON.stringify(quantityAttempt.json), /whole number|invalid/i);
  });

  await t.test("public shipping preview rejects injection-shaped cart values", async () => {
    const { response, json } = await requestJson("/api/shipping/quote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: JSON.stringify({
        shippingOption: "normal",
        customer: {
          address1: "123 Main Street",
          address2: "",
          city: "Austin",
          state: "TX",
          postalCode: "78701",
          country: "US"
        },
        items: [
          {
            sku: "VV1'; DROP TABLE checkout_shipping_quotes;--",
            quantity: 1
          }
        ]
      })
    });

    assert.equal(response.status, 400);
    assert.match(JSON.stringify(json), /cart|refresh/i);
  });

  await t.test("public email signup rejects injection-shaped source values", async () => {
    const { response, json } = await requestJson("/api/email-signups", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: JSON.stringify({
        email: "security@example.com",
        source: "homepage_join_email'; DROP TABLE email_signups;--"
      })
    });

    assert.equal(response.status, 400);
    assert.match(JSON.stringify(json), /signup|refresh/i);
  });

  await t.test("public order finalization accepts only bound PaymentIntent identifiers", async () => {
    const { response, json } = await requestJson("/api/order/finalize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: JSON.stringify({
        paymentIntentId: "pi_123'; DROP TABLE orders;--"
      })
    });

    assert.equal(response.status, 400);
    assert.match(JSON.stringify(json), /invalid/i);

    const legacySessionAttempt = await requestJson("/api/order/finalize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: JSON.stringify({
        sessionId: "cs_test_legacy"
      })
    });

    assert.equal(legacySessionAttempt.response.status, 400);
    assert.match(
      JSON.stringify(legacySessionAttempt.json),
      /payment|checkout|confirmation|unrecognized/i
    );
  });

  await t.test("public inventory route reports backend unavailability instead of empty stock", async () => {
    const { response, json } = await requestJson("/api/inventory", {
      headers: {
        Origin: baseUrl
      }
    });

    assert.equal(response.status, 503);
    assert.match(String(json?.error || ""), /inventory/i);
  });

  await t.test("analytics ingest rejects unknown events and oversized batches before persistence", async () => {
    const invalidEvent = await requestJson("/api/analytics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: JSON.stringify({
        events: [
          {
            name: "totally_fake_event",
            occurredAt: new Date().toISOString(),
            visitorId: "v_test",
            sessionId: "s_test",
            pageViewId: "pv_test",
            pagePath: "/"
          }
        ]
      })
    });

    assert.equal(invalidEvent.response.status, 400);

    const oversizedBatch = await requestJson("/api/analytics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: baseUrl
      },
      body: JSON.stringify({
        events: Array.from({ length: 40 }, (_, index) => ({
          name: "cta_click",
          occurredAt: new Date().toISOString(),
          visitorId: `v_${index}`,
          sessionId: `s_${index}`,
          pageViewId: `pv_${index}`,
          pagePath: "/",
          elementId: `cta_${index}`
        }))
      })
    });

    assert.equal(oversizedBatch.response.status, 400);
  });

  await t.test("analytics ingest rejects cross-origin requests", async () => {
    const response = await fetch(`${baseUrl}/api/analytics`, {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        events: [
          {
            name: "cta_click",
            occurredAt: new Date().toISOString(),
            visitorId: "v_test",
            sessionId: "s_test",
            pageViewId: "pv_test",
            pagePath: "/",
            elementId: "hero_shop_cta"
          }
        ]
      })
    });

    assert.equal(response.status, 403);
  });

  await t.test("analytics reporting output stays aggregated and redacted", async () => {
    const report = buildAnalyticsReportFromRows(
      [
        {
          event_name: "page_view",
          visitor_id: "v_1",
          session_id: "s_1",
          page_path: "/",
          section_id: "hero",
          element_id: "",
          product_sku: "",
          metadata: {}
        },
        {
          event_name: "product_card_view",
          visitor_id: "v_1",
          session_id: "s_1",
          page_path: "/",
          section_id: "shop",
          element_id: "product_card_vv1",
          product_sku: "VV1",
          metadata: {}
        },
        {
          event_name: "product_add_to_cart",
          visitor_id: "v_1",
          session_id: "s_1",
          page_path: "/",
          section_id: "shop",
          element_id: "product_add_vv1",
          product_sku: "VV1",
          metadata: {}
        },
        {
          event_name: "checkout_field_error",
          visitor_id: "v_1",
          session_id: "s_1",
          page_path: "/",
          section_id: "shop",
          element_id: "checkout_field_email",
          product_sku: "",
          metadata: {
            fieldName: "email",
            attempted_value: "customer@example.com",
            api_key: "sk_test_should_never_appear"
          }
        },
        {
          event_name: "email_popup_open",
          visitor_id: "v_2",
          session_id: "s_2",
          page_path: "/",
          section_id: "hero",
          element_id: "email_popup_dialog",
          product_sku: "",
          metadata: {}
        },
        {
          event_name: "email_popup_dismiss",
          visitor_id: "v_2",
          session_id: "s_2",
          page_path: "/",
          section_id: "hero",
          element_id: "email_popup_dialog",
          product_sku: "",
          metadata: {
            reason: "no_thanks"
          }
        }
      ],
      { rangeLabel: "7d", generatedAt: "2026-04-09T12:00:00.000Z" }
    );

    const markdown = formatAnalyticsReportMarkdown(report);
    const json = JSON.stringify(report);

    assert.match(markdown, /Summary/);
    assert.match(markdown, /Recommended Actions/);
    assert.doesNotMatch(markdown, /customer@example\.com/i);
    assert.doesNotMatch(markdown, /sk_test_should_never_appear/i);
    assert.doesNotMatch(json, /customer@example\.com/i);
    assert.doesNotMatch(json, /sk_test_should_never_appear/i);
  });

  await t.test("CORS allows only trusted origins", async () => {
    const allowedPreflight = await fetch(`${baseUrl}/api/admin/orders`, {
      method: "OPTIONS",
      headers: {
        Origin: baseUrl,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization"
      }
    });

    assert.equal(allowedPreflight.status, 204);
    assert.equal(allowedPreflight.headers.get("access-control-allow-origin"), baseUrl);

    const deniedPreflight = await fetch(`${baseUrl}/api/admin/orders`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://evil.example",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization"
      }
    });

    assert.equal(deniedPreflight.status, 403);
  });

  await t.test("ambiguous Content-Length and Transfer-Encoding is rejected", async () => {
    const rawResponse = await sendRawHttpRequest(
      [
        "POST /api/order HTTP/1.1",
        `Host: ${host}:${port}`,
        "Content-Type: application/json",
        "Content-Length: 4",
        "Transfer-Encoding: chunked",
        "Connection: close",
        "",
        "0",
        "",
        ""
      ].join("\r\n")
    );

    assert.match(rawResponse, /^HTTP\/1\.1 400 /);
  });
});
