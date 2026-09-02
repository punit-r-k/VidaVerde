import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const databaseUrl = String(process.env.EASYPOST_BUDGET_TEST_SUPABASE_URL || "").trim();
const serviceRoleKey = String(
  process.env.EASYPOST_BUDGET_TEST_SUPABASE_SERVICE_ROLE_KEY || ""
).trim();
const resetAllowed = process.env.EASYPOST_BUDGET_TEST_RESET_ALLOWED === "true";
const enabled = Boolean(databaseUrl && serviceRoleKey && resetAllowed);

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
const supabase = enabled
  ? createClient(databaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

test("atomic EasyPost RPC prevents concurrent distinct-fingerprint budget overshoot", {
  skip: enabled
    ? false
    : "Set the isolated EasyPost budget-test Supabase variables and explicit reset flag."
}, async () => {
  const runId = crypto.randomUUID();
  const usedFingerprints = [];
  const reserve = async ({
    name,
    session = name,
    parcelCount = 1,
    ratingLimit = 100,
    verificationLimit = 100,
    monthlyLimit = 10_000,
    estimatedCost = 1
  }) => {
    const fingerprint = digest(`${runId}:quote:${name}`);
    usedFingerprints.push(fingerprint);
    const { data, error } = await supabase.rpc("reserve_easypost_quote", {
      p_fingerprint: fingerprint,
      p_session_fingerprint: digest(`${runId}:session:${session}`),
      p_ip_fingerprint: digest(`${runId}:ip:${name}`),
      p_service_level: "normal",
      p_parcel_plan: { key: "database-concurrency-test", parcels: [{ name }] },
      p_planned_ship_date: "2026-09-05",
      p_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      p_parcel_count: parcelCount,
      p_daily_rating_limit: ratingLimit,
      p_daily_verification_limit: verificationLimit,
      p_monthly_overage_limit_cents: monthlyLimit,
      p_estimated_overage_cost_cents: estimatedCost
    });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data)?.state;
  };
  const cleanup = async () => {
    if (usedFingerprints.length === 0) return;
    const fingerprints = [...new Set(usedFingerprints)];
    const { error: ledgerError } = await supabase
      .from("easypost_usage_ledger")
      .delete()
      .in("quote_fingerprint", fingerprints);
    if (ledgerError) throw ledgerError;
    const { error: quoteError } = await supabase
      .from("checkout_shipping_quotes")
      .delete()
      .in("fingerprint", fingerprints);
    if (quoteError) throw quoteError;
    usedFingerprints.length = 0;
  };

  try {
    let states = await Promise.all([
      reserve({ name: "session-a", session: "shared" }),
      reserve({ name: "session-b", session: "shared" }),
      reserve({ name: "session-c", session: "shared" })
    ]);
    assert.equal(states.filter((state) => state === "reserved").length, 2);
    assert.equal(states.filter((state) => state === "blocked").length, 1);
    await cleanup();

    states = await Promise.all([
      reserve({ name: "rating-a", parcelCount: 2, ratingLimit: 3 }),
      reserve({ name: "rating-b", parcelCount: 2, ratingLimit: 3 })
    ]);
    assert.equal(states.filter((state) => state === "reserved").length, 1);
    assert.equal(states.filter((state) => state === "blocked").length, 1);
    await cleanup();

    states = await Promise.all([
      reserve({ name: "verification-a", verificationLimit: 1 }),
      reserve({ name: "verification-b", verificationLimit: 1 })
    ]);
    assert.equal(states.filter((state) => state === "reserved").length, 1);
    assert.equal(states.filter((state) => state === "blocked").length, 1);
    await cleanup();

    states = await Promise.all([
      reserve({ name: "monthly-a", monthlyLimit: 101, estimatedCost: 51 }),
      reserve({ name: "monthly-b", monthlyLimit: 101, estimatedCost: 51 })
    ]);
    assert.equal(states.filter((state) => state === "reserved").length, 1);
    assert.equal(states.filter((state) => state === "blocked").length, 1);
  } finally {
    await cleanup();
  }
});
