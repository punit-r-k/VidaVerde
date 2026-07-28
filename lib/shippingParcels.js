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

const normalizeItems = (items) => (Array.isArray(items) ? items : [])
  .map((item) => ({
    sku: String(item?.sku || "").trim().toUpperCase(),
    quantity: Math.max(0, Number.parseInt(item?.quantity, 10) || 0)
  }))
  .filter((item) => PRODUCTS[item.sku] && item.quantity > 0);

const enumerateBoxCounts = (quantity, boxes, maxPlans = 12) => {
  if (!quantity) return [[]];
  const results = [];
  const maxCounts = boxes.map((box) => Math.ceil(quantity / box.capacity));

  const visit = (index, counts) => {
    if (index === boxes.length) {
      const capacity = counts.reduce((sum, count, i) => sum + count * boxes[i].capacity, 0);
      if (capacity >= quantity) results.push(counts.slice());
      return;
    }
    for (let count = 0; count <= maxCounts[index]; count += 1) {
      counts.push(count);
      visit(index + 1, counts);
      counts.pop();
    }
  };
  visit(0, []);

  return results
    .map((counts) => ({
      counts,
      capacity: counts.reduce((sum, count, i) => sum + count * boxes[i].capacity, 0),
      cost: counts.reduce((sum, count, i) => sum + count * boxes[i].costCents, 0),
      parcels: counts.reduce((sum, count) => sum + count, 0)
    }))
    .filter((candidate, _, all) => !all.some((other) =>
      other !== candidate && other.capacity >= quantity && other.cost <= candidate.cost &&
      other.parcels <= candidate.parcels && (other.cost < candidate.cost || other.parcels < candidate.parcels)
    ))
    .sort((a, b) => a.parcels - b.parcels || a.cost - b.cost || a.capacity - b.capacity)
    .slice(0, maxPlans)
    .map((candidate) => candidate.counts);
};

const expandUnits = (items, family) => normalizeItems(items)
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
  const sauerkrautPlans = buildFamilyPlans(items, "sauerkraut");
  const hotSaucePlans = buildFamilyPlans(items, "hot_sauce");
  return sauerkrautPlans.flatMap((sauerkraut) => hotSaucePlans.map((hotSauce) => {
    const parcels = [...sauerkraut.parcels, ...hotSauce.parcels];
    return {
      key: `${sauerkraut.key}__${hotSauce.key}`,
      parcels,
      boxCostCents: parcels.reduce((sum, parcel) => sum + parcel.boxCostCents, 0)
    };
  })).sort((a, b) => a.parcels.length - b.parcels.length || a.boxCostCents - b.boxCostCents);
}

export { BOXES, PRODUCTS };
