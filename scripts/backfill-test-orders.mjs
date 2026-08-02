import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
};

loadEnvFile(path.join(repoRoot, ".env.local"));
loadEnvFile(path.join(repoRoot, ".env"));

const applyChanges = process.argv.includes("--apply");
const [{ supabaseAdmin }, { stripeRequest }, { isFinancialTestOrder }] = await Promise.all([
  import("../lib/supabaseAdmin.js"),
  import("../lib/stripe.js"),
  import("../lib/testOrders.js")
]);

if (!supabaseAdmin) throw new Error("Supabase service credentials are unavailable.");

const { data: orders, error: ordersError } = await supabaseAdmin
  .from("orders")
  .select("id, payment_session_id")
  .eq("payment_provider", "stripe")
  .eq("is_test_order", false)
  .order("created_at", { ascending: true });

if (ordersError) {
  throw new Error(`Could not load orders. Apply the test-order migration first: ${ordersError.message}`);
}

const testOrderIds = [];
let unresolvedCount = 0;

for (const order of orders || []) {
  const paymentSessionId = String(order?.payment_session_id || "").trim();
  let stripePath = "";

  if (paymentSessionId.startsWith("pi_")) {
    stripePath = `/v1/payment_intents/${encodeURIComponent(paymentSessionId)}?expand[]=latest_charge`;
  } else if (paymentSessionId.startsWith("cs_")) {
    stripePath = `/v1/checkout/sessions/${encodeURIComponent(paymentSessionId)}?expand[]=payment_intent.latest_charge`;
  } else {
    unresolvedCount += 1;
    continue;
  }

  const { ok, data } = await stripeRequest(stripePath, { method: "GET" });
  if (!ok) {
    unresolvedCount += 1;
    continue;
  }

  const charge = paymentSessionId.startsWith("pi_")
    ? data?.latest_charge
    : data?.payment_intent?.latest_charge;
  if (isFinancialTestOrder({ charge, source: data })) testOrderIds.push(order.id);
}

if (applyChanges && testOrderIds.length > 0) {
  const { error: updateError } = await supabaseAdmin
    .from("orders")
    .update({ is_test_order: true })
    .in("id", testOrderIds);
  if (updateError) throw new Error(`Could not flag test orders: ${updateError.message}`);
}

console.log(
  `${applyChanges ? "Flagged" : "Found"} ${testOrderIds.length} test order(s); ` +
    `${unresolvedCount} Stripe payment(s) could not be resolved.`
);
if (!applyChanges && testOrderIds.length > 0) {
  console.log("Preview only. Run again with --apply after reviewing the count.");
}
