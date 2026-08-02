import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  isMissingShipmentAutomationColumn,
  readShipmentsWithLegacyFallback
} from "../lib/adminShipmentPolicy.js";
import { shipmentsQuerySchema } from "../lib/adminSchemas.js";

test("shipment legacy fallback is limited to the two known Postgres columns", () => {
  assert.equal(
    isMissingShipmentAutomationColumn({
      code: "42703",
      message: "column shipments.label_purchase_error does not exist"
    }),
    true
  );
  assert.equal(
    isMissingShipmentAutomationColumn({
      code: "42703",
      message: "column shipments.label_purchase_started_at does not exist"
    }),
    true
  );
  assert.equal(
    isMissingShipmentAutomationColumn({ code: "42703", message: "column shipments.customer_email does not exist" }),
    false
  );
  assert.equal(
    isMissingShipmentAutomationColumn({ code: "42501", message: "permission denied" }),
    false
  );
});

test("shipment reads fall back once for the known rolling-migration error", async () => {
  let currentReads = 0;
  let legacyReads = 0;
  let warnings = 0;
  const result = await readShipmentsWithLegacyFallback({
    readCurrent: async () => {
      currentReads += 1;
      return {
        data: null,
        error: { code: "42703", message: "column shipments.label_purchase_error does not exist" }
      };
    },
    readLegacy: async () => {
      legacyReads += 1;
      return { data: [{ id: "shipment-1" }], error: null };
    },
    onLegacyFallback: () => {
      warnings += 1;
    }
  });

  assert.deepEqual(result.data, [{ id: "shipment-1" }]);
  assert.equal(currentReads, 1);
  assert.equal(legacyReads, 1);
  assert.equal(warnings, 1);
});

test("unrelated shipment database errors fail closed without a legacy retry", async () => {
  let legacyReads = 0;
  const expectedError = { code: "42501", message: "permission denied" };
  const result = await readShipmentsWithLegacyFallback({
    readCurrent: async () => ({ data: null, error: expectedError }),
    readLegacy: async () => {
      legacyReads += 1;
      return { data: [], error: null };
    }
  });

  assert.equal(result.error, expectedError);
  assert.equal(legacyReads, 0);
});

test("shipment GET stays read-only while POST owns refresh side effects", () => {
  const routeSource = fs.readFileSync(
    new URL("../app/api/admin/shipments/route.js", import.meta.url),
    "utf8"
  );
  const getStart = routeSource.indexOf("export async function GET");
  const postStart = routeSource.indexOf("export async function POST");

  assert.ok(getStart >= 0 && postStart > getStart);
  const getSource = routeSource.slice(getStart, postStart);
  const postSource = routeSource.slice(postStart);

  assert.doesNotMatch(getSource, /await\s+refreshShipments\s*\(/u);
  assert.match(postSource, /await\s+refreshShipments\s*\(/u);
});

test("legacy refresh query parameters remain valid but have no mutation semantics", () => {
  const parsed = shipmentsQuerySchema.safeParse({ refresh: "1", limit: "1000" });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data.refresh, true);
  assert.equal(parsed.data.limit, 1000);
});
