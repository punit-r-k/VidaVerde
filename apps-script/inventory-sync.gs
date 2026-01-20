const CONFIG = {
  SHEET_NAME: "Inventory",
  HEADER_ROW: 1,
  START_ROW: 2,
  COLS: {
    SKU: 1,
    PRODUCT: 2,
    STOCK_INPUT: 3,
    STOCK_STATUS: 4,
    STATUS: 5,
    PREORDERS: 6,
    RESTOCK_DATE: 7,
    TOTAL_SALES: 8
  }
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Vida Verde")
    .addItem("Sync Inventory", "syncInventory")
    .addToUi();
}

function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;

  const row = e.range.getRow();
  const col = e.range.getColumn();

  if (row <= CONFIG.HEADER_ROW) return;

  if (col === CONFIG.COLS.STOCK_INPUT) {
    handleRestockEdit_(sheet, row);
  }

  if (col === CONFIG.COLS.RESTOCK_DATE) {
    handleRestockDateEdit_(sheet, row);
  }
}

function syncInventory() {
  const settings = getSettings_();
  const response = getJson_(
    `${settings.apiBaseUrl}/api/admin/inventory`,
    settings.adminSecret
  );

  const inventory = Array.isArray(response?.inventory) ? response.inventory : [];
  const map = inventory.reduce((acc, record) => {
    if (record && record.sku) {
      acc[String(record.sku).trim()] = record;
    }
    return acc;
  }, {});

  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    throw new Error(`Sheet '${CONFIG.SHEET_NAME}' not found.`);
  }

  const lastRow = sheet.getLastRow();
  for (let row = CONFIG.START_ROW; row <= lastRow; row += 1) {
    const sku = String(sheet.getRange(row, CONFIG.COLS.SKU).getValue() || "").trim();
    if (!sku) continue;

    const record = map[sku];
    if (!record) continue;

    writeRow_(sheet, row, record);
  }
}

function handleRestockEdit_(sheet, row) {
  const rawValue = sheet.getRange(row, CONFIG.COLS.STOCK_INPUT).getValue();
  if (rawValue === "" || rawValue === null) return;

  const restock = Number(rawValue);
  if (!Number.isFinite(restock)) {
    Logger.log("Invalid restock value: %s", rawValue);
    return;
  }

  const sku = String(sheet.getRange(row, CONFIG.COLS.SKU).getValue() || "").trim();
  if (!sku) {
    Logger.log("Missing SKU for row %s", row);
    return;
  }

  const settings = getSettings_();
  const payload = {
    sku,
    restock: Math.trunc(restock)
  };

  const response = postJson_(
    `${settings.apiBaseUrl}/api/admin/restock`,
    settings.adminSecret,
    payload
  );

  if (!response?.ok) {
    Logger.log(
      "Restock failed for %s (status: %s, error: %s)",
      sku,
      response?.status ?? "unknown",
      response?.error || response?.message || response?.raw || "unknown"
    );
    return;
  }

  sheet.getRange(row, CONFIG.COLS.STOCK_INPUT).setValue("");

  if (response.inventory) {
    writeRow_(sheet, row, response.inventory);
  } else {
    syncInventoryRow_(sheet, row, sku, settings);
  }
}

function handleRestockDateEdit_(sheet, row) {
  const sku = String(sheet.getRange(row, CONFIG.COLS.SKU).getValue() || "").trim();
  if (!sku) return;

  const rawValue = sheet.getRange(row, CONFIG.COLS.RESTOCK_DATE).getValue();
  let formatted = null;

  if (rawValue) {
    if (Object.prototype.toString.call(rawValue) === "[object Date]") {
      formatted = Utilities.formatDate(rawValue, "GMT", "yyyy-MM-dd");
    } else {
      const textValue = String(rawValue).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(textValue)) {
        formatted = textValue;
      } else {
        Logger.log("Invalid restock date format: %s", rawValue);
        return;
      }
    }
  }

  const settings = getSettings_();
  const payload = {
    sku,
    expected_restock_date: formatted
  };

  const response = patchJson_(
    `${settings.apiBaseUrl}/api/admin/inventory`,
    settings.adminSecret,
    payload
  );

  if (!response?.ok) {
    Logger.log("Restock date update failed for %s", sku);
  }
}

function syncInventoryRow_(sheet, row, sku, settings) {
  const response = getJson_(
    `${settings.apiBaseUrl}/api/admin/inventory`,
    settings.adminSecret
  );

  const inventory = Array.isArray(response?.inventory) ? response.inventory : [];
  const record = inventory.find((item) => String(item.sku).trim() === sku);

  if (record) {
    writeRow_(sheet, row, record);
  }
}

function writeRow_(sheet, row, record) {
  const onHand = Number(record.on_hand || 0);
  const status = onHand > 0 ? "In Stock" : "Out of Stock";
  const preorders = Number(record.preorders_remaining || 0);
  const sales = Number(record.units_sold || 0);
  const dateValue = record.expected_restock_date
    ? new Date(`${record.expected_restock_date}T00:00:00Z`)
    : "";

  sheet.getRange(row, CONFIG.COLS.STOCK_STATUS).setValue(onHand);
  sheet.getRange(row, CONFIG.COLS.STATUS).setValue(status);
  sheet.getRange(row, CONFIG.COLS.PREORDERS).setValue(preorders);
  sheet.getRange(row, CONFIG.COLS.RESTOCK_DATE).setValue(dateValue);
  sheet.getRange(row, CONFIG.COLS.TOTAL_SALES).setValue(sales);
}

function getSettings_() {
  const props = PropertiesService.getScriptProperties();
  const apiBaseUrl = props.getProperty("API_BASE_URL");
  const adminSecret = props.getProperty("ADMIN_RESTOCK_SECRET");

  if (!apiBaseUrl || !adminSecret) {
    throw new Error("Missing API_BASE_URL or ADMIN_RESTOCK_SECRET script properties.");
  }

  return { apiBaseUrl, adminSecret };
}

function getJson_(url, adminSecret) {
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      "x-admin-secret": adminSecret
    },
    muteHttpExceptions: true
  });

  return JSON.parse(response.getContentText());
}

function postJson_(url, adminSecret, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-admin-secret": adminSecret
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  const text = response.getContentText();

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      return { status, ...parsed };
    }
    return { status, data: parsed };
  } catch (error) {
    return { status, error: "Invalid JSON response", raw: text };
  }
}

function patchJson_(url, adminSecret, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    headers: {
      "x-admin-secret": adminSecret
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  return JSON.parse(response.getContentText());
}
