import {
  DUPLICATE_CART_SKU_MESSAGE,
  MAX_CART_LINE_ITEMS,
  MAX_CART_UNITS,
  MAX_CART_UNITS_MESSAGE,
  MAX_ITEM_QUANTITY,
  inspectCartItems
} from "./cartLimits.js";

const PRODUCTS = {
  VV1: { family: "sauerkraut", weightOz: 20.35 },
  VV2: { family: "sauerkraut", weightOz: 20.81 },
  VV3: { family: "sauerkraut", weightOz: 19.97 },
  VV4: { family: "sauerkraut", weightOz: 20.95 },
  VV5: { family: "hot_sauce", weightOz: 10.19 },
  VV6: { family: "hot_sauce", weightOz: 10.05 }
};

const BOXES = {
  sauerkraut: [
    { code: "SK-1", capacity: 1, length: 6.375, width: 5.25, height: 5.5, emptyOz: 7.76027, costCents: 250, supplier: "Flush Packaging" },
    { code: "SK-3", capacity: 3, length: 12, width: 5.25, height: 5.375, emptyOz: 11.46404, costCents: 299, supplier: "Flush Packaging" },
    { code: "SK-12", capacity: 12, length: 15, width: 12, height: 5.375, emptyOz: 28.21917, costCents: 599, supplier: "Flush Packaging" }
  ],
  hot_sauce: [
    { code: "HS-1", capacity: 1, length: 8.25, width: 2.38, height: 2.5, emptyOz: 2, costCents: 70, supplier: "Hot Sauce Pod" },
    { code: "HS-2", capacity: 2, length: 7.5, width: 5.19, height: 2.31, emptyOz: 4, costCents: 125, supplier: "Hot Sauce Pod" },
    { code: "HS-3", capacity: 3, length: 7.63, width: 6.93, height: 2.31, emptyOz: 4, costCents: 135, supplier: "Hot Sauce Pod" },
    { code: "HS-4", capacity: 4, length: 9.38, width: 7.63, height: 2.31, emptyOz: 5, costCents: 155, supplier: "Hot Sauce Pod" },
    { code: "HS-5", capacity: 5, length: 11.25, width: 7.63, height: 2.31, emptyOz: 6, costCents: 155, supplier: "Hot Sauce Pod" }
  ]
};

const MAX_FAMILY_PLANS = 12;
const MAX_DP_CANDIDATES_PER_CAPACITY = 24;

const normalizeItems = (items) => {
  const sourceItems = Array.isArray(items) ? items : [];
  if (sourceItems.length > MAX_CART_LINE_ITEMS) {
    throw new RangeError(
      `Shipping carts can contain at most ${MAX_CART_LINE_ITEMS} line items.`
    );
  }

  const { duplicateItems } = inspectCartItems(sourceItems);
  if (duplicateItems.length > 0) {
    throw new Error(DUPLICATE_CART_SKU_MESSAGE);
  }

  let totalUnits = 0;
  const normalizedItems = sourceItems.map((item) => {
    const sku = String(item?.sku || "").trim().toUpperCase();
    const quantity = Number(item?.quantity);

    if (!PRODUCTS[sku]) {
      throw new Error(
        `Shipping is not configured for SKU ${sku || "(missing)"}. Please refresh and try again.`
      );
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new RangeError(`Shipping quantity for ${sku} must be a positive whole number.`);
    }
    if (quantity > MAX_ITEM_QUANTITY) {
      throw new RangeError(
        `Please keep each item quantity at ${MAX_ITEM_QUANTITY} or fewer.`
      );
    }

    totalUnits += quantity;
    return { sku, quantity };
  });

  if (totalUnits > MAX_CART_UNITS) {
    throw new RangeError(MAX_CART_UNITS_MESSAGE);
  }

  return normalizedItems;
};

const compareCountVectors = (a, b) => {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const compareCandidates = (a, b) =>
  a.parcels - b.parcels ||
  a.cost - b.cost ||
  a.capacity - b.capacity ||
  compareCountVectors(a.counts, b.counts);

const dominatesCandidate = (candidate, other) =>
  candidate.cost <= other.cost &&
  candidate.parcels <= other.parcels &&
  (candidate.cost < other.cost || candidate.parcels < other.parcels);

const addBoundedCandidate = (candidates, candidate) => {
  if (candidates.some((existing) => dominatesCandidate(existing, candidate))) {
    return candidates;
  }

  const retained = candidates.filter(
    (existing) => !dominatesCandidate(candidate, existing)
  );
  retained.push(candidate);
  retained.sort(compareCandidates);
  return retained.slice(0, MAX_DP_CANDIDATES_PER_CAPACITY);
};

const enumerateBoxCounts = (quantity, boxes, maxPlans = MAX_FAMILY_PLANS) => {
  if (!quantity) return [[]];
  const maximumBoxCapacity = Math.max(...boxes.map((box) => box.capacity));
  // Any solution at or above this limit can drop one box and still fit the order,
  // making it strictly worse on both cost and parcel count.
  const capacityLimit = quantity + maximumBoxCapacity - 1;
  let states = Array.from({ length: capacityLimit + 1 }, () => []);
  states[0] = [{
    counts: Array(boxes.length).fill(0),
    capacity: 0,
    cost: 0,
    parcels: 0
  }];

  boxes.forEach((box, boxIndex) => {
    const nextStates = Array.from({ length: capacityLimit + 1 }, () => []);

    states.forEach((candidates, capacity) => {
      candidates.forEach((candidate) => {
        const maxCount = Math.floor((capacityLimit - capacity) / box.capacity);
        for (let count = 0; count <= maxCount; count += 1) {
          const counts = candidate.counts.slice();
          counts[boxIndex] = count;
          const nextCapacity = capacity + count * box.capacity;
          nextStates[nextCapacity] = addBoundedCandidate(nextStates[nextCapacity], {
            counts,
            capacity: nextCapacity,
            cost: candidate.cost + count * box.costCents,
            parcels: candidate.parcels + count
          });
        }
      });
    });

    states = nextStates;
  });

  const eligibleCandidates = states.slice(quantity).flat();
  return eligibleCandidates
    .filter((candidate, _, all) => !all.some((other) =>
      other !== candidate && dominatesCandidate(other, candidate)
    ))
    .sort(compareCandidates)
    .slice(0, maxPlans)
    .map((candidate) => candidate.counts);
};

const expandUnits = (items, family) => items
  .flatMap((item) => Array.from({ length: item.quantity }, () => ({
    sku: item.sku,
    weightOz: PRODUCTS[item.sku].weightOz
  })))
  .filter((unit) => PRODUCTS[unit.sku].family === family)
  .sort((a, b) => b.weightOz - a.weightOz);

const buildFamilyPlans = (items, family) => {
  const units = expandUnits(items, family);
  if (!units.length) return [{ key: `${family}-none`, parcels: [] }];
  const boxes = BOXES[family];

  return enumerateBoxCounts(units.length, boxes).map((counts) => {
    const selectedBoxes = counts.flatMap((count, index) =>
      Array.from({ length: count }, () => ({ ...boxes[index], units: [] }))
    ).sort((a, b) => b.capacity - a.capacity);

    units.forEach((unit) => {
      const target = selectedBoxes
        .filter((box) => box.units.length < box.capacity)
        .sort((a, b) => (a.units.reduce((sum, entry) => sum + entry.weightOz, 0)) -
          (b.units.reduce((sum, entry) => sum + entry.weightOz, 0)))[0];
      target.units.push(unit);
    });

    const parcels = selectedBoxes.map((box) => ({
      family,
      packageCode: box.code,
      supplier: box.supplier,
      quantity: box.units.length,
      skus: box.units.map((unit) => unit.sku),
      length: box.length,
      width: box.width,
      height: box.height,
      weightOz: Math.ceil(box.emptyOz + box.units.reduce((sum, unit) => sum + unit.weightOz, 0)),
      boxCostCents: box.costCents
    }));
    return { key: `${family}-${counts.join("-")}`, parcels };
  });
};

export function buildShippingPlans(items) {
  const normalizedItems = normalizeItems(items);
  const sauerkrautPlans = buildFamilyPlans(normalizedItems, "sauerkraut");
  const hotSaucePlans = buildFamilyPlans(normalizedItems, "hot_sauce");
  const combinedPlans = sauerkrautPlans.flatMap((sauerkraut) => hotSaucePlans.map((hotSauce) => {
    const parcels = [...sauerkraut.parcels, ...hotSauce.parcels];
    return {
      key: `${sauerkraut.key}__${hotSauce.key}`,
      parcels,
      boxCostCents: parcels.reduce((sum, parcel) => sum + parcel.boxCostCents, 0)
    };
  })).sort((a, b) =>
    a.parcels.length - b.parcels.length || a.boxCostCents - b.boxCostCents
  );

  // Packaging is a local, deterministic decision. EasyPost must only see the
  // parcels that will actually be purchased, never speculative alternatives.
  return combinedPlans.slice(0, 1);
}

export const buildShippingPlan = (items) => buildShippingPlans(items)[0] || null;
