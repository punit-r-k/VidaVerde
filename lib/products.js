import { supabaseAdmin } from "./supabaseAdmin";

const PRODUCT_CONTENT_BY_SKU = {
  VV1: {
    name: "Red Coral",
    profile: "",
    description:
      "Tangy kraut with a gently sweet beet finish and a clean carrot note. Best for breakfast plates, goat-cheese toast, grain bowls, roasted chicken, and rich meals that need acidity. Naturally fermented for a bright lactic tang and live cultures, with all the vegetable fiber still in the jar. Beets and carrots add extra plant variety and a fuller finish than classic kraut. Use 1-2 forkfuls as a side with eggs or roasted meats, or mix into bowls and salads instead of a heavy dressing.",
    specs: [
      "Ingredients: cabbage, beets, carrots, salt"
    ],
    sizeOz: 12
  },
  VV2: {
    name: "Sunset",
    profile: "Turmeric + Cumin",
    description:
      "Savory-tangy kraut with turmeric warmth and toasted cumin flavor. Best for lentils, roasted sweet potatoes, rice bowls, wraps, and meal prep. Fermentation gives it live cultures and a clean acidity that helps replace oily sauces, while cabbage and carrots keep it fiber-rich. Turmeric and cumin add warm, spiced depth that makes legumes and roasted vegetables taste seasoned fast. Add a forkful to bowls or wraps when you want flavor without heaviness.",
    specs: [
      "Ingredients: cabbage, carrots, turmeric, cumin seeds, salt"
    ],
    sizeOz: 12
  },
  VV3: {
    name: "Caribbean Heat",
    profile: "Mild Spice",
    description:
      "Bright kraut tang with a steady jalapeno kick. Best for tacos, breakfast eggs, burgers, wraps, and bowls that want heat plus acidity. Naturally fermented cabbage brings live cultures and tang, while jalapenos add pepper bite plus naturally occurring vitamin C and antioxidants. Use it like a spicy topping instead of mayo-based condiments, especially on tacos and rice bowls.",
    specs: [
      "Ingredients: cabbage, jalapeno pepper, salt"
    ],
    sizeOz: 12
  },
  VV4: {
    name: "Endless Summer",
    profile: "Fresh + Balanced",
    description:
      "Mild, classic kraut tang with a light carrot sweetness. Best for deli sandwiches, big salads, tuna bowls, grilled sausages, and as an easy side. Your most versatile fermented veggie: naturally fermented for live cultures and bright tang, with simple cabbage-and-carrot flavor that doesn't compete with the meal. Use it anywhere you'd use pickles or slaw, especially sandwiches and salads.",
    specs: [
      "Ingredients: cabbage, carrots, salt"
    ],
    sizeOz: 12
  },
  VV5: {
    name: "Green Kick Hot Sauce",
    profile: "Herbal + Mild",
    description:
      "Jalapeno hot sauce with onion savoriness and a cilantro finish. Best for scrambled eggs, tacos, wraps, grilled chicken, roasted vegetables, and quick dips. Fermented peppers bring a naturally tangy bite and live cultures, so you get big flavor without sugary sauces. Drizzle on proteins and veggies, or mix a spoonful into Greek yogurt or mayo for an instant green sauce.",
    specs: [
      "Ingredients: jalapeno pepper, onion, green onion, cilantro"
    ],
    sizeOz: 5
  },
  VV6: {
    name: "Hell Yeah! Hot Sauce",
    profile: "Hot + Bright",
    description:
      "Very hot sauce with habanero heat, red jalapeno punch, and onion for balance. Best for chili, wings, pizza, soups, roasted cauliflower, and bowls. Fermentation adds tang plus live cultures that can support digestion and gut balance, while keeping the heat clean and focused. A few drops go a long way. Start small, then build, especially in soups and bowls where it spreads evenly.",
    specs: [
      "Ingredients: red habanero pepper, red jalapeno pepper, onion"
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
