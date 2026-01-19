import { supabaseAdmin } from "./supabaseAdmin";

const FALLBACK_PRODUCTS = [
  {
    id: "verdant-classic",
    sku: "VV1",
    name: "Red Coral",
    profile: "Crisp + Mineral",
    description: "White cabbage fermented slowly with alpine salt for clean acidity.",
    specs: [
      "Ferment: 28 days",
      "Ingredients: white cabbage, alpine salt",
      "Microgreen infusion: broccoli sprouts",
      "Jar size: 12oz"
    ],
    image:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=800&q=80",
    priceCents: 1199,
    sizeOz: 12
  },
  {
    id: "citrus-fennel",
    sku: "VV2",
    name: "Sunset",
    profile: "Warm + Hearthy",
    description: "Turmeric and cumin seed add warm spice to a crisp cabbage and carrot kraut.",
    specs: [
      "Ferment: 21 days",
      "Ingredients: organic cabbage, carrots, turmeric, cumin seeds, sea salt",
      "Microgreen infusion: basil shoots",
      "Pairing: seafood + salads",
      "Jar size: 12oz"
    ],
    image:
      "https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=800&q=80",
    priceCents: 1199,
    sizeOz: 12
  },
  {
    id: "garden-herb",
    sku: "VV3",
    name: "Caribean Heat",
    profile: "Green + Silky",
    description: "A garden-forward blend with parsley, coriander, and celery leaf.",
    specs: [
      "Ferment: 18 days",
      "Ingredients: parsley, coriander, celery",
      "Microgreen infusion: pea tendrils",
      "Texture: silk + crunch",
      "Jar size: 12oz"
    ],
    image:
      "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=800&q=80",
    priceCents: 1199,
    sizeOz: 12
  },
  {
    id: "smoked-chili",
    sku: "VV4",
    name: "Endless Summer",
    profile: "Deep + Warming",
    description: "Ancho chili and cacao husk deliver a smoky, velvety finish.",
    specs: [
      "Ferment: 35 days",
      "Ingredients: ancho, cacao husk, agave",
      "Heat level: 6/10",
      "Pairing: roasted vegetables",
      "Jar size: 12oz"
    ],
    image:
      "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=800&q=80",
    priceCents: 1199,
    sizeOz: 12
  },
  {
    id: "golden-turmeric",
    sku: "VV5",
    name: "Tropical Wave",
    profile: "Warm + Vibrant",
    description: "Turmeric, ginger, and carrot bring glow and gentle spice.",
    specs: [
      "Ferment: 24 days",
      "Ingredients: turmeric, ginger, carrot",
      "Microgreen infusion: sunflower greens",
      "Finish: bright + earthy",
      "Jar size: 12oz"
    ],
    image:
      "https://images.unsplash.com/photo-1476718406336-bb5a9690ee2a?auto=format&fit=crop&w=800&q=80",
    priceCents: 1199,
    sizeOz: 12
  },
  {
    id: "purple-beet",
    sku: "VV6",
    name: "Sourkreut 6",
    profile: "Lush + Botanical",
    description: "Red cabbage and beetroot for a lush, antioxidant-rich kraut.",
    specs: [
      "Ferment: 26 days",
      "Ingredients: beetroot, red cabbage",
      "Microgreen infusion: radish greens",
      "Color: deep violet",
      "Jar size: 12oz"
    ],
    image:
      "https://images.unsplash.com/photo-1505250469679-203ad9ced0cb?auto=format&fit=crop&w=800&q=80",
    priceCents: 1199,
    sizeOz: 12
  }
];

const FALLBACK_MAP = new Map(
  FALLBACK_PRODUCTS.map((product) => [product.sku, product])
);

const mapProductRow = (row) => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  profile: row.profile,
  description: row.description,
  specs: Array.isArray(row.specs) ? row.specs : [],
  image: row.image_url,
  priceCents: row.price_cents ?? 0,
  sizeOz: row.size_oz ?? 12
});

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
