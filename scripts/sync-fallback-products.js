const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const REQUIRED_KEYS = [
  "id",
  "sku",
  "name",
  "profile",
  "description",
  "specs",
  "image",
  "priceCents",
  "sizeOz"
];

const escapeString = (value) =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

const formatValue = (value, indent) => {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const nextIndent = `${indent}  `;
    const lines = value.map(
      (entry) => `${nextIndent}${formatValue(entry, nextIndent)}`
    );
    return `[\n${lines.join(",\n")}\n${indent}]`;
  }

  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return `"${escapeString(value)}"`;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "object") {
    const nextIndent = `${indent}  `;
    const keys = [
      ...REQUIRED_KEYS.filter((key) => key in value),
      ...Object.keys(value).filter((key) => !REQUIRED_KEYS.includes(key))
    ];
    const lines = keys.map(
      (key) => `${nextIndent}${key}: ${formatValue(value[key], nextIndent)}`
    );
    return `{\n${lines.join(",\n")}\n${indent}}`;
  }

  return "null";
};

const formatProducts = (products) => {
  if (products.length === 0) return "[]";
  const lines = products.map((product) => `  ${formatValue(product, "  ")}`);
  return `[\n${lines.join(",\n")}\n]`;
};

const main = async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
  });

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, slug, sku, name, profile, description, specs, image_url, price_cents, size_oz, sort_order"
    )
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Supabase error: ${error.message}`);
  }

  const fallbackProducts = (data || []).map((row) => ({
    id: row.slug || row.sku || row.id,
    sku: row.sku,
    name: row.name,
    profile: row.profile,
    description: row.description,
    specs: Array.isArray(row.specs) ? row.specs : [],
    image: row.image_url,
    priceCents: row.price_cents ?? 0,
    sizeOz: row.size_oz ?? 12
  }));

  if (fallbackProducts.length === 0) {
    throw new Error("No products found to sync.");
  }

  const filePath = path.join(__dirname, "..", "lib", "products.js");
  const source = fs.readFileSync(filePath, "utf8");
  const replacement = `const FALLBACK_PRODUCTS = ${formatProducts(fallbackProducts)};`;
  const updated = source.replace(
    /const FALLBACK_PRODUCTS = \[[\s\S]*?\];/m,
    replacement
  );

  if (updated === source) {
    throw new Error("FALLBACK_PRODUCTS block not found.");
  }

  fs.writeFileSync(filePath, updated);
  console.log("Updated FALLBACK_PRODUCTS in lib/products.js.");
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
