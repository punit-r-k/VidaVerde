const CONFIG = {
  SHEET_NAME: "Inventory",
  SETTINGS_SHEET_NAME: "Settings",
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
  },
  SETTINGS: {
    HEADER_KEY_ROW: 1,
    HEADER_KEY_COL: 1,
    HEADER_VALUE_ROW: 1,
    HEADER_VALUE_COL: 2,
    SHOW_STOCK_LABEL_ROW: 2,
    SHOW_STOCK_LABEL_COL: 1,
    SHOW_STOCK_VALUE_ROW: 2,
    SHOW_STOCK_VALUE_COL: 2
  }
};

function onOpen() {
  ensureSettingsSheet_();

  SpreadsheetApp.getUi()
    .createMenu("Vida Verde")
    .addItem("Sync Inventory", "syncInventory")
    .addItem("Setup Edit Trigger", "setupEditTrigger")
    .addToUi();
}

function onEdit(e) {
  // Simple onEdit triggers cannot call UrlFetchApp.
  // Keep this as a no-op and use the installable onInventoryEdit trigger.
  return;
}

function onInventoryEdit(e) {
  handleInventoryEdit_(e);
}

function handleInventoryEdit_(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  const row = e.range.getRow();
  const col = e.range.getColumn();
  const sheetName = sheet.getName();

  if (sheetName === CONFIG.SETTINGS_SHEET_NAME) {
    if (
      row === CONFIG.SETTINGS.SHOW_STOCK_VALUE_ROW &&
      col === CONFIG.SETTINGS.SHOW_STOCK_VALUE_COL
    ) {
      handleShowStockToggleEdit_(sheet);
    }
    return;
  }

  if (sheetName !== CONFIG.SHEET_NAME) return;
  if (row <= CONFIG.HEADER_ROW) return;

  if (col === CONFIG.COLS.STOCK_INPUT) {
    handleRestockEdit_(sheet, row);
  }

  if (col === CONFIG.COLS.RESTOCK_DATE) {
    handleRestockDateEdit_(sheet, row);
  }
}

function setupEditTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some((trigger) => {
    return (
      trigger.getHandlerFunction() === "onInventoryEdit" &&
      trigger.getEventType() === ScriptApp.EventType.ON_EDIT
    );
  });

  if (exists) {
    SpreadsheetApp.getUi().alert("Installable edit trigger already exists.");
    return;
  }

  ScriptApp.newTrigger("onInventoryEdit")
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();

  SpreadsheetApp.getUi().alert("Installable edit trigger created.");
}

function syncInventory() {
  ensureSettingsSheet_();

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

  const showStock = normalizeBoolean_(response?.settings?.show_stock, true);
  writeShowStockSetting_(showStock);

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

function handleShowStockToggleEdit_(sheet) {
  const rawValue = sheet
    .getRange(
      CONFIG.SETTINGS.SHOW_STOCK_VALUE_ROW,
      CONFIG.SETTINGS.SHOW_STOCK_VALUE_COL
    )
    .getValue();

  const showStock = normalizeBoolean_(rawValue, true);
  const settings = getSettings_();

  const response = patchJson_(
    `${settings.apiBaseUrl}/api/admin/inventory`,
    settings.adminSecret,
    { show_stock: showStock }
  );

  if (!response?.ok) {
    Logger.log(
      "Show stock toggle update failed (status: %s, error: %s)",
      response?.status ?? "unknown",
      response?.error || response?.message || response?.raw || "unknown"
    );
    return;
  }

  const confirmed = normalizeBoolean_(response?.settings?.show_stock, showStock);
  writeShowStockSetting_(confirmed);
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

function ensureSettingsSheet_() {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName(CONFIG.SETTINGS_SHEET_NAME);

  if (!sheet) {
    sheet = book.insertSheet(CONFIG.SETTINGS_SHEET_NAME);
  }

  sheet
    .getRange(CONFIG.SETTINGS.HEADER_KEY_ROW, CONFIG.SETTINGS.HEADER_KEY_COL)
    .setValue("Setting");
  sheet
    .getRange(CONFIG.SETTINGS.HEADER_VALUE_ROW, CONFIG.SETTINGS.HEADER_VALUE_COL)
    .setValue("Value");
  sheet
    .getRange(
      CONFIG.SETTINGS.SHOW_STOCK_LABEL_ROW,
      CONFIG.SETTINGS.SHOW_STOCK_LABEL_COL
    )
    .setValue("Show stock on website");

  const toggleCell = sheet.getRange(
    CONFIG.SETTINGS.SHOW_STOCK_VALUE_ROW,
    CONFIG.SETTINGS.SHOW_STOCK_VALUE_COL
  );
  toggleCell.insertCheckboxes();

  if (toggleCell.getValue() === "") {
    toggleCell.setValue(true);
  }

  return sheet;
}

function writeShowStockSetting_(showStock) {
  const sheet = ensureSettingsSheet_();
  const value = normalizeBoolean_(showStock, true);
  const toggleCell = sheet.getRange(
    CONFIG.SETTINGS.SHOW_STOCK_VALUE_ROW,
    CONFIG.SETTINGS.SHOW_STOCK_VALUE_COL
  );

  toggleCell.insertCheckboxes();
  if (toggleCell.getValue() !== value) {
    toggleCell.setValue(value);
  }
}

function normalizeBoolean_(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;

  const text = String(value || "").trim().toLowerCase();
  if (!text) return fallback;
  if (text === "true" || text === "yes" || text === "on") return true;
  if (text === "false" || text === "no" || text === "off") return false;
  return fallback;
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
