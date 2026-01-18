import { products } from "./products";

const COLUMN_MAP = {
  name: 1,
  stock: 2,
  preorders: 4,
  sales: 6
};

const SHEET_COLUMNS = {
  name: "B",
  stock: "C",
  preorders: "E",
  sales: "G"
};

const SHEET_DATA_START_ROW = 5;
const START_ROW_INDEX = SHEET_DATA_START_ROW - 1;

const normalize = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizeHeader = (value) => String(value ?? "").trim().toLowerCase();

const isRowEmpty = (row) =>
  row.every((cell) => !String(cell ?? "").trim());

const productLookup = new Map();

products.forEach((product) => {
  [product.name, product.id, product.sku].forEach((entry) => {
    const key = normalize(entry);
    if (key) {
      productLookup.set(key, product.sku);
    }
  });
});

const createInventoryMap = () =>
  Object.fromEntries(
    products.map((product) => [
      product.sku,
      { stock: 0, preorders: 0, sales: 0, name: product.name, row: null }
    ])
  );

const fallbackInventory = createInventoryMap();

const toCount = (value) => {
  const cleaned = String(value ?? "").replace(/[^0-9-]/g, "");
  const parsed = Number.parseInt(cleaned || "0", 10);

  if (Number.isNaN(parsed)) {
    return 0;
  }

  return Math.max(parsed, 0);
};

const resolveSku = (value) => {
  const key = normalize(value);
  return productLookup.get(key);
};

const findHeaderIndex = (headers, candidates) =>
  headers.findIndex((header) =>
    candidates.some(
      (candidate) => header === candidate || header.includes(candidate)
    )
  );

function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const nextChar = line[i + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/);

  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  if (lines.length === 0) {
    return [];
  }

  return lines.map(parseCsvLine);
}

const findHeaderRow = (rows) => {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];

    if (isRowEmpty(row)) {
      continue;
    }

    const headers = row.map(normalizeHeader);
    const stockIndex = findHeaderIndex(headers, [
      "stock",
      "available",
      "stock count"
    ]);
    const skuIndex = headers.indexOf("sku");
    const nameIndex = findHeaderIndex(headers, ["name", "product"]);

    if (stockIndex === -1 || (skuIndex === -1 && nameIndex === -1)) {
      continue;
    }

    return {
      rowIndex: i,
      stockIndex,
      skuIndex,
      nameIndex,
      preordersIndex: findHeaderIndex(headers, ["preorder", "preorders"]),
      salesIndex: findHeaderIndex(headers, ["sales", "total sales"])
    };
  }

  return null;
};

function mapByHeaders(rows) {
  const header = findHeaderRow(rows);

  if (!header) {
    return null;
  }

  const inventory = createInventoryMap();
  let matched = false;
  let dataIndex = 0;

  for (let i = header.rowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i];

    if (isRowEmpty(row)) {
      continue;
    }

    const rawSku = header.skuIndex !== -1 ? row[header.skuIndex] : "";
    const rawName = header.nameIndex !== -1 ? row[header.nameIndex] : "";
    const displayName = String(rawName || "").trim();
    const resolvedSku = resolveSku(rawSku || rawName);
    const fallbackSku = products[dataIndex]?.sku;
    let sku = null;

    if (header.skuIndex !== -1 && resolvedSku) {
      sku = resolvedSku;
    } else if (fallbackSku) {
      sku = fallbackSku;
    } else {
      sku = resolvedSku;
    }

    if (!sku) {
      dataIndex += 1;
      continue;
    }

    matched = true;
    inventory[sku] = {
      ...inventory[sku],
      stock: toCount(row[header.stockIndex]),
      preorders: toCount(row[header.preordersIndex]),
      sales: toCount(row[header.salesIndex]),
      name: displayName || inventory[sku]?.name,
      row: i + 1
    };

    dataIndex += 1;
  }

  return matched ? inventory : null;
}

function mapByColumns(rows) {
  if (rows.length <= START_ROW_INDEX) {
    return null;
  }

  const inventory = createInventoryMap();
  let matched = false;
  let dataIndex = 0;

  for (let i = START_ROW_INDEX; i < rows.length; i += 1) {
    const row = rows[i];

    if (isRowEmpty(row)) {
      continue;
    }

    const name = row[COLUMN_MAP.name];
    const displayName = String(name || "").trim();
    const resolvedSku = resolveSku(name);
    const fallbackSku = products[dataIndex]?.sku;
    const sku = fallbackSku || resolvedSku;

    if (!sku) {
      dataIndex += 1;
      continue;
    }

    matched = true;
    inventory[sku] = {
      ...inventory[sku],
      stock: toCount(row[COLUMN_MAP.stock]),
      preorders: toCount(row[COLUMN_MAP.preorders]),
      sales: toCount(row[COLUMN_MAP.sales]),
      name: displayName || inventory[sku]?.name,
      row: i + 1
    };

    dataIndex += 1;
  }

  return matched ? inventory : null;
}

export async function getInventoryMap() {
  const url = process.env.GOOGLE_SHEETS_CSV_URL;

  if (!url) {
    return fallbackInventory;
  }

  try {
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
      return fallbackInventory;
    }

    const text = await response.text();
    const rows = parseCsv(text);

    if (rows.length === 0) {
      return fallbackInventory;
    }

    const headerInventory = mapByHeaders(rows);
    if (headerInventory) {
      return headerInventory;
    }

    const columnInventory = mapByColumns(rows);
    if (columnInventory) {
      return columnInventory;
    }

    return fallbackInventory;
  } catch (error) {
    return fallbackInventory;
  }
}

const getSheetRowForSku = (sku, row) => {
  if (row) {
    return row;
  }

  const index = products.findIndex((product) => product.sku === sku);
  if (index === -1) {
    return null;
  }

  return SHEET_DATA_START_ROW + index;
};

const getAppsScriptConfig = () => {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  const token = process.env.GOOGLE_APPS_SCRIPT_TOKEN;

  if (!url) {
    return null;
  }

  return { url, token };
};

export async function updateInventorySheet(updates) {
  if (!updates || updates.length === 0) {
    return;
  }

  const config = getAppsScriptConfig();

  if (!config) {
    throw new Error("Google Apps Script sync is not configured.");
  }

  const missingRows = [];
  const payloadUpdates = [];

  updates.forEach((update) => {
    const row = getSheetRowForSku(update.sku, update.row);

    if (!row) {
      missingRows.push(update.sku);
      return;
    }

    payloadUpdates.push({
      row,
      stock: update.stock,
      preorders: update.preorders,
      sales: update.sales
    });
  });

  if (missingRows.length > 0) {
    throw new Error("Unable to resolve sheet rows for all products.");
  }

  if (payloadUpdates.length === 0) {
    return;
  }

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      token: config.token,
      updates: payloadUpdates,
      columns: SHEET_COLUMNS
    })
  });

  if (!response.ok) {
    throw new Error("Google Apps Script update failed.");
  }
}
