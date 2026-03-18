import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
  STRIPE_API_VERSION: "2024-06-20",
  SITE_URL: baseUrl,
  CORS_ALLOWED_ORIGINS: baseUrl,
  CORS_ALLOWED_ORIGINS_PRODUCTION: baseUrl,
  ADMIN_JWT_SECRET: "test-admin-secret-please-rotate",
  ADMIN_JWT_ISSUER: "vidaverde-admin",
  ADMIN_JWT_AUDIENCE: "vidaverde-admin-api",
  RATE_LIMIT_BACKEND: "memory"
};

const privilegedEndpoints = [
  { name: "admin orders", method: "GET", path: "/api/admin/orders" },
  { name: "admin shipments", method: "GET", path: "/api/admin/shipments" },
  { name: "admin prep", method: "GET", path: "/api/admin/prep" },
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

const createAdminJwt = ({ roles, sub = "security-test-admin" }) => {
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
    jti: crypto.randomUUID()
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

      if (response.ok || response.status === 200 || response.status === 500) {
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
  });

  await t.test("public checkout payload rejects injection-shaped SKU values", async () => {
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
    assert.match(JSON.stringify(json), /invalid/i);
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
