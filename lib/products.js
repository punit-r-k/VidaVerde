import { supabaseAdmin } from "./supabaseAdmin";

const RED_CORAL_PRODUCT_IMAGE = "/product-photos/Red-Coral.webp";
const ENDLESS_SUMMER_PRODUCT_IMAGE = "/product-photos/Endless-Summer.webp";

const PRODUCT_CONTENT_BY_SKU = {
  VV1: {
    name: "Red Coral",
    image: RED_CORAL_PRODUCT_IMAGE,
    profile: "",
    description:
      "Tangy kraut with a gently sweet beet finish and a clean carrot note. Ideal with breakfast plates, goat-cheese toast, grain bowls, roasted chicken, and rich meals that need acidity. Naturally soured for bright lactic tang and active cultures, with all the vegetable fiber still in the jar. Beets and carrots add extra plant variety and a fuller finish than classic kraut. Spoon 1-2 forkfuls alongside eggs or roasted meats, or fold into bowls and salads instead of a heavy dressing.",
    specs: [
      "Ingredients: cabbage, beets, carrots, salt"
    ],
    sizeOz: 12
  },
  VV2: {
    name: "Sunset",
    profile: "",
    description:
      "Savory-tangy kraut with turmeric warmth and toasted cumin flavor. Pair it with lentils, roasted sweet potatoes, rice bowls, wraps, and meal prep. A traditional brine process develops active cultures and clean acidity that can replace oily sauces, while cabbage and carrots keep it fiber-rich. Turmeric and cumin add warm, spiced depth that makes legumes and roasted vegetables taste seasoned fast. Drop in a forkful when you want layered flavor without heaviness.",
    specs: [
      "Ingredients: cabbage, carrots, turmeric, cumin seeds, salt"
    ],
    sizeOz: 12
  },
  VV3: {
    name: "Caribbean Heat",
    profile: "Mild Spice",
    description:
      "Bright kraut tang with a steady jalapeno kick. Great on tacos, breakfast eggs, burgers, wraps, and bowls that need heat plus acidity. A probiotic-rich cabbage base brings lively tang, while jalapenos add pepper bite plus naturally occurring vitamin C and antioxidants. Try it as a spicy topper in place of mayo-based condiments, especially on tacos and rice bowls.",
    specs: [
      "Ingredients: cabbage, jalapeno pepper, salt"
    ],
    sizeOz: 12
  },
  VV4: {
    name: "Endless Summer",
    image: ENDLESS_SUMMER_PRODUCT_IMAGE,
    profile: "Fresh + Balanced",
    description:
      "Mild, classic kraut tang with a light carrot sweetness. Works well in deli sandwiches, big salads, tuna bowls, grilled sausages, and as an easy side. This is your most versatile live-culture veggie: naturally soured for bright tang, with simple cabbage-and-carrot flavor that does not compete with the meal. Swap it in anywhere you would use pickles or slaw, especially sandwiches and salads.",
    specs: [
      "Ingredients: cabbage, carrots, salt"
    ],
    sizeOz: 12
  },
  VV5: {
    name: "Green Kick Hot Sauce",
    profile: "Mild + Herbal",
    description:
      "Jalapeno hot sauce with onion savoriness and a cilantro finish. Reach for it on scrambled eggs, tacos, wraps, grilled chicken, roasted vegetables, and quick dips. Raw, active peppers bring naturally tangy bite and probiotic-rich depth, giving you bold flavor without sugary sauces. Drizzle over proteins and veggies, or stir a spoonful into Greek yogurt or mayo for an instant green sauce.",
    specs: [
      "Ingredients: jalapeno pepper, onion, green onion, cilantro"
    ],
    sizeOz: 5
  },
  VV6: {
    name: "Hell Yeah! Hot Sauce",
    profile: "Hot + Bright",
    description:
      "Very hot sauce with habanero heat, red jalapeno punch, and onion for balance. Use it for chili, wings, pizza, soups, roasted cauliflower, and bowls. A brine-aged pepper base adds tang and active culture character that can support digestion and gut balance, while keeping the heat clean and focused. A few drops go a long way. Start small, then build, especially in soups and bowls where it spreads evenly.",
    specs: [
      "Ingredients: red habanero pepper, red jalapeno pepper, onion"
    ],
    sizeOz: 5
  }
};

const FALLBACK_PRODUCT_IMAGE = "/email/order-confirmation-banner.png";

const FALLBACK_PRODUCTS = [
  {
    id: "verdant-classic",
    sku: "VV1",
    ...PRODUCT_CONTENT_BY_SKU.VV1,
    image: RED_CORAL_PRODUCT_IMAGE,
    priceCents: 1199,
    sizeOz: 12
  },
  {
    id: "citrus-fennel",
    sku: "VV2",
    ...PRODUCT_CONTENT_BY_SKU.VV2,
    image: FALLBACK_PRODUCT_IMAGE,
    priceCents: 1199,
    sizeOz: 12
  },
  {
    id: "caribbean-heat",
    sku: "VV3",
    ...PRODUCT_CONTENT_BY_SKU.VV3,
    image: FALLBACK_PRODUCT_IMAGE,
    priceCents: 1199,
    sizeOz: 12
  },
  {
    id: "smoked-chili",
    sku: "VV4",
    ...PRODUCT_CONTENT_BY_SKU.VV4,
    image: ENDLESS_SUMMER_PRODUCT_IMAGE,
    priceCents: 1199,
    sizeOz: 12
  },
  {
    id: "green-kick",
    sku: "VV5",
    ...PRODUCT_CONTENT_BY_SKU.VV5,
    image: FALLBACK_PRODUCT_IMAGE,
    priceCents: 999,
    sizeOz: 5
  },
  {
    id: "hell-yeah",
    sku: "VV6",
    ...PRODUCT_CONTENT_BY_SKU.VV6,
    image: FALLBACK_PRODUCT_IMAGE,
    priceCents: 999,
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
    image: contentOverride.image ?? row.image_url,
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

  const map = new Map(
    (data || []).map((row) => {
      const contentOverride = PRODUCT_CONTENT_BY_SKU[row.sku] || {};

      return [
        row.sku,
        {
          ...row,
          image_url: contentOverride.image ?? row.image_url
        }
      ];
    })
  );
  return map.size > 0 ? map : fallbackProductMap(skus);
}
