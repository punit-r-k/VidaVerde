import { supabaseAdmin } from "./supabaseAdmin";

const PRODUCT_CONTENT_BY_SKU = {
  VV1: {
    name: "Red Coral",
    profile: "",
    description:
      "This live fermented kraut blends cabbage, beets, and carrots for bold flavor and added antioxidants. Fermented in natural vegetable juices with no preservatives and never pasteurized, it supports digestion, gut balance, and everyday vitality.",
    specs: [
      "Ingredients: cabbage, beets, carrots, salt",
      "Fermented in natural vegetable juices",
      "No preservatives, no shortcuts, never pasteurized",
      "Supports circulation and overall vitality",
      "Jar size: 12oz"
    ],
    sizeOz: 12
  },
  VV2: {
    name: "Sunset",
    profile: "Turmeric + Cumin",
    description:
      "This live fermented kraut combines cabbage and carrots with turmeric and cumin for a warm, spice-forward profile. Naturally fermented in vegetable juices and never pasteurized, it supports digestion, gut balance, and overall wellness.",
    specs: [
      "Ingredients: cabbage, carrots, turmeric, cumin seeds, salt",
      "Fermented in natural vegetable juices",
      "No preservatives, no shortcuts, never pasteurized",
      "Turmeric and cumin support overall wellness",
      "Jar size: 12oz"
    ],
    sizeOz: 12
  },
  VV3: {
    name: "Caribbean Heat",
    profile: "Medium Spice",
    description:
      "This medium-spice kraut blends cabbage and jalapeno for a vibrant kick and bright flavor. Naturally fermented in vegetable juices with live active cultures, it supports digestion and gut balance without preservatives or shortcuts.",
    specs: [
      "Ingredients: cabbage, jalapeno pepper, salt",
      "Fermented in natural vegetable juices",
      "No preservatives, no shortcuts, never pasteurized",
      "Medium heat with a vibrant kick",
      "Vitamin C and antioxidant support",
      "Jar size: 12oz"
    ],
    sizeOz: 12
  },
  VV4: {
    name: "Endless Summer",
    profile: "Fresh + Balanced",
    description:
      "This fresh, balanced kraut blends cabbage and carrots for clean flavor and everyday versatility. Fermented in natural vegetable juices and never pasteurized, it delivers live probiotics that support digestion, gut balance, and vitality.",
    specs: [
      "Ingredients: cabbage, carrots, salt",
      "Fermented in natural vegetable juices",
      "No preservatives, no shortcuts, never pasteurized",
      "Nutrients that support eye health and vitality",
      "Jar size: 12oz"
    ],
    sizeOz: 12
  },
  VV5: {
    name: "Green Kick Hot Sauce",
    profile: "Herbal + Mild",
    description:
      "A raw, fermented 5oz hot sauce with a fresh herbal profile and mild heat. Fermented in natural vegetable juices and never pasteurized, Green Kick brings live cultures, bold flavor, and gut-supporting benefits to eggs, tacos, bowls, and more.",
    specs: [
      "Ingredients: jalapeno pepper, onion, green onion, cilantro",
      "Fermented in natural vegetable juices",
      "No preservatives, no shortcuts, never pasteurized",
      "Flavor profile: fresh, herbal, mild heat",
      "Bottle size: 5oz"
    ],
    sizeOz: 5
  },
  VV6: {
    name: "Hell Yeah! Hot Sauce",
    profile: "Hot + Bright",
    description:
      "A raw, fermented 5oz hot sauce crafted for bold heat with a bright finish. Fermented in natural vegetable juices with no preservatives and never pasteurized, it delivers live probiotics and balanced intensity for everyday meals.",
    specs: [
      "Ingredients: red habanero pepper, red jalapeno pepper, onion",
      "Fermented in natural vegetable juices",
      "No preservatives, no shortcuts, never pasteurized",
      "Flavor profile: bold heat with bright finish",
      "Bottle size: 5oz"
    ],
    sizeOz: 5
  }
};

const FALLBACK_PRODUCTS = [
  {
    id: "verdant-classic",
    sku: "VV1",
    ...PRODUCT_CONTENT_BY_SKU.VV1,
    image:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=800&q=80",
    priceCents: 1199,
    sizeOz: 12
  },
  {
    id: "citrus-fennel",
    sku: "VV2",
    ...PRODUCT_CONTENT_BY_SKU.VV2,
    image:
      "https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=800&q=80",
    priceCents: 1199,
    sizeOz: 12
  },
  {
    id: "caribbean-heat",
    sku: "VV3",
    ...PRODUCT_CONTENT_BY_SKU.VV3,
    image:
      "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=800&q=80",
    priceCents: 1199,
    sizeOz: 12
  },
  {
    id: "smoked-chili",
    sku: "VV4",
    ...PRODUCT_CONTENT_BY_SKU.VV4,
    image:
      "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80",
    priceCents: 1199,
    sizeOz: 12
  },
  {
    id: "green-kick",
    sku: "VV5",
    ...PRODUCT_CONTENT_BY_SKU.VV5,
    image:
      "https://images.unsplash.com/photo-1476718406336-bb5a9690ee2a?auto=format&fit=crop&w=800&q=80",
    priceCents: 1199,
    sizeOz: 5
  },
  {
    id: "hell-yeah",
    sku: "VV6",
    ...PRODUCT_CONTENT_BY_SKU.VV6,
    image:
      "https://images.unsplash.com/photo-1505250469679-203ad9ced0cb?auto=format&fit=crop&w=800&q=80",
    priceCents: 1199,
    sizeOz: 5
  }
];

const FALLBACK_MAP = new Map(
  FALLBACK_PRODUCTS.map((product) => [product.sku, product])
);

const mapProductRow = (row) => {
  const contentOverride = PRODUCT_CONTENT_BY_SKU[row.sku] || {};

  return {
    id: row.id,
    sku: row.sku,
    name: contentOverride.name ?? row.name,
    profile: contentOverride.profile ?? row.profile,
    description: contentOverride.description ?? row.description,
    specs: Array.isArray(contentOverride.specs)
      ? contentOverride.specs
      : Array.isArray(row.specs)
        ? row.specs
        : [],
    image: row.image_url,
    priceCents: row.price_cents ?? 0,
    sizeOz: contentOverride.sizeOz ?? row.size_oz ?? 12
  };
};

const fallbackProductMap = (skus) =>
  new Map(
    (skus || [])
      .map((sku) => {
        const product = FALLBACK_MAP.get(sku);
        if (!product) return null;
        return [
          sku,
          {
            sku,
            name: product.name,
            price_cents: product.priceCents,
            image_url: product.image
          }
        ];
      })
      .filter(Boolean)
  );

export async function getProducts() {
  if (!supabaseAdmin) {
    return FALLBACK_PRODUCTS;
  }

  const { data, error } = await supabaseAdmin
    .from("products")
    .select(
      "id, sku, name, profile, description, specs, image_url, price_cents, size_oz, sort_order"
    )
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("products read error:", error);
    return FALLBACK_PRODUCTS;
  }

  const mapped = (data || []).map(mapProductRow);
  return mapped.length > 0 ? mapped : FALLBACK_PRODUCTS;
}

export async function getProductMap(skus) {
  if (!Array.isArray(skus) || skus.length === 0) {
    return new Map();
  }

  if (!supabaseAdmin) {
    return fallbackProductMap(skus);
  }

  const { data, error } = await supabaseAdmin
    .from("products")
    .select("sku, name, price_cents, image_url")
    .in("sku", skus)
    .eq("active", true);

  if (error) {
    console.error("products lookup error:", error);
    return fallbackProductMap(skus);
  }

  const map = new Map((data || []).map((row) => [row.sku, row]));
  return map.size > 0 ? map : fallbackProductMap(skus);
}
