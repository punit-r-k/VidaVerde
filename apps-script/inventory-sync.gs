const CONFIG = {
  SHEET_NAME: "Inventory",
  PREP_SHEET_NAME: "Prepare for this week",
  ORDERS_SHEET_NAME: "Orders",
  SHIPMENTS_SHEET_NAME: "Shipments",
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
  },
  PREP: {
    META_ROW: 1,
    HEADER_ROW: 2,
    START_ROW: 3
  },
  ORDERS: {
    HEADER_ROW: 1,
    START_ROW: 2
  },
  SHIPMENTS: {
    HEADER_ROW: 1,
    START_ROW: 2
  }
};

function onOpen() {
  ensureSettingsSheet_();

  SpreadsheetApp.getUi()
    .createMenu("Vida Verde")
    .addItem("Master Sync", "masterSync")
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

  if (col === CONFIG.COLS.PREORDERS) {
    handlePreordersEdit_(sheet, row);
  }

  if (col === CONFIG.COLS.RESTOCK_DATE) {
    handleRestockDateEdit_(sheet, row);
  }
}

function setupEditTrigger() {
  const triggers = ScriptApp.getProjectTriggers().filter((trigger) => {
    return (
      trigger.getHandlerFunction() === "onInventoryEdit" &&
      trigger.getEventType() === ScriptApp.EventType.ON_EDIT
    );
  });

  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }

  ScriptApp.newTrigger("onInventoryEdit")
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onEdit()
    .create();

  SpreadsheetApp.getUi().alert("Installable edit trigger reset.");
}

function masterSync() {
  const ui = SpreadsheetApp.getUi();
  const steps = [
    { name: "Inventory", run: syncInventory },
    { name: "Weekly Prep", run: syncWeeklyPrep },
    { name: "Orders", run: syncOrders },
    { name: "Shipments", run: syncShipments }
  ];
  const failed = [];

  for (const step of steps) {
    try {
      step.run();
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      failed.push(`${step.name}: ${message}`);
      Logger.log("Master sync failed for %s: %s", step.name, message);
    }
  }

  if (failed.length > 0) {
    ui.alert(`Master sync completed with errors:\n\n${failed.join("\n")}`);
    return;
  }

  SpreadsheetApp.getActive().toast(
    "Inventory, prep, orders, and shipments synced.",
    "Vida Verde",
    5
  );
}

function syncInventory() {
  ensureSettingsSheet_();

  const settings = getSettings_();
  const response = getJson_(
    `${settings.apiBaseUrl}/api/admin/inventory`,
    settings
  );

  const inventory = Array.isArray(response?.inventory) ? response.inventory : [];
  const map = inventory.reduce((acc, record) => {
    if (record && record.sku) {
      acc[normalizeSku_(record.sku)] = record;
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
    const sku = normalizeSku_(sheet.getRange(row, CONFIG.COLS.SKU).getValue());
    if (!sku) continue;

    const record = map[sku];
    if (!record) continue;

    writeRow_(sheet, row, record);
  }
}

function syncWeeklyPrep() {
  ensureSettingsSheet_();

  const settings = getSettings_();
  const response = getJson_(
    `${settings.apiBaseUrl}/api/admin/prep`,
    settings
  );

  const prepRows = Array.isArray(response?.prep) ? response.prep : [];
  const weekInfo = response?.week || {};
  const pickup = response?.pickup || {};
  const timezone = String(response?.timezone || "America/Chicago");

  const sheet = ensurePrepSheet_();
  sheet.clearContents();

  const metaValues = [[
    "Week Start",
    weekInfo.week_start_date || "",
    "Week End",
    weekInfo.week_end_date || "",
    "Market Date (Saturday)",
    pickup.market_date || weekInfo.market_date || "",
    "Pickup Window",
    pickup.pickup_window || "",
    "Same-Day Cutoff",
    pickup.same_day_cutoff_label || "",
    "Market",
    pickup.market_name || "",
    "Address",
    pickup.market_address || "",
    "Timezone",
    pickup.timezone || timezone
  ]];
  sheet.getRange(CONFIG.PREP.META_ROW, 1, 1, metaValues[0].length).setValues(metaValues);

  const headerValues = [[
    "SKU",
    "Product",
    "Ship This Week",
    "Market This Saturday",
    "Total To Prepare"
  ]];
  sheet
    .getRange(CONFIG.PREP.HEADER_ROW, 1, 1, headerValues[0].length)
    .setValues(headerValues);

  if (prepRows.length === 0) {
    sheet
      .getRange(CONFIG.PREP.START_ROW, 1)
      .setValue("No paid orders for this week yet.");
  } else {
    const rows = prepRows.map((row) => ([
      normalizeSku_(row?.sku),
      String(row?.name || ""),
      Number(row?.shipping_qty || 0),
      Number(row?.market_qty || 0),
      Number(row?.total_qty || 0)
    ]));

    sheet
      .getRange(CONFIG.PREP.START_ROW, 1, rows.length, rows[0].length)
      .setValues(rows);

    const shipTotal = rows.reduce((sum, row) => sum + row[2], 0);
    const marketTotal = rows.reduce((sum, row) => sum + row[3], 0);
    const totalToPrepare = rows.reduce((sum, row) => sum + row[4], 0);
    const totalsRow = CONFIG.PREP.START_ROW + rows.length;

    sheet
      .getRange(totalsRow, 1, 1, 5)
      .setValues([["TOTAL", "", shipTotal, marketTotal, totalToPrepare]]);
    sheet
      .getRange(CONFIG.PREP.START_ROW, 3, rows.length + 1, 3)
      .setNumberFormat("0");
  }

  sheet
    .getRange(CONFIG.PREP.META_ROW, 1, 1, metaValues[0].length)
    .setFontWeight("bold");
  sheet
    .getRange(CONFIG.PREP.HEADER_ROW, 1, 1, 5)
    .setFontWeight("bold");
  sheet.setFrozenRows(2);
  sheet.autoResizeColumns(1, Math.max(5, metaValues[0].length));
}

function syncOrders() {
  ensureSettingsSheet_();

  const settings = getSettings_();
  const response = getJson_(
    `${settings.apiBaseUrl}/api/admin/orders?status=paid&limit=1000`,
    settings
  );

  const orders = Array.isArray(response?.orders) ? response.orders : [];
  const sheet = ensureOrdersSheet_();
  sheet.clearContents();

  const headerValues = [[
    "Created At",
    "Order ID",
    "Fulfillment",
    "Customer",
    "Email",
    "Phone",
    "Address",
    "Items",
    "Units",
    "Subtotal",
    "Tax",
    "Shipping",
    "Total",
    "Order Note",
    "Status",
    "Payment Session"
  ]];
  sheet
    .getRange(CONFIG.ORDERS.HEADER_ROW, 1, 1, headerValues[0].length)
    .setValues(headerValues);

  if (orders.length === 0) {
    sheet
      .getRange(CONFIG.ORDERS.START_ROW, 1)
      .setValue("No paid orders yet.");
  } else {
    const rows = orders.map((order) => {
      const createdAt = order?.created_at
        ? new Date(order.created_at)
        : "";

      return [
        createdAt,
        String(order?.id || ""),
        formatOrderFulfillment_(order?.fulfillment),
        String(order?.customer_name || ""),
        String(order?.customer_email || ""),
        String(order?.customer_phone || ""),
        formatOrderAddress_(order),
        formatOrderItems_(order),
        Number(order?.item_count || 0),
        Number(order?.amount_subtotal || 0) / 100,
        Number(order?.amount_tax || 0) / 100,
        Number(order?.amount_shipping || 0) / 100,
        Number(order?.amount_total || 0) / 100,
        String(order?.note || ""),
        String(order?.status || ""),
        String(order?.payment_session_id || "")
      ];
    });

    sheet
      .getRange(CONFIG.ORDERS.START_ROW, 1, rows.length, rows[0].length)
      .setValues(rows);

    sheet
      .getRange(CONFIG.ORDERS.START_ROW, 1, rows.length, 1)
      .setNumberFormat("yyyy-mm-dd hh:mm");
    sheet
      .getRange(CONFIG.ORDERS.START_ROW, 9, rows.length, 1)
      .setNumberFormat("0");
    sheet
      .getRange(CONFIG.ORDERS.START_ROW, 10, rows.length, 4)
      .setNumberFormat("$#,##0.00");
  }

  sheet
    .getRange(CONFIG.ORDERS.HEADER_ROW, 1, 1, 16)
    .setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 16);
}

function syncShipments() {
  ensureSettingsSheet_();

  const settings = getSettings_();
  const response = getJson_(
    `${settings.apiBaseUrl}/api/admin/shipments?refresh=1&limit=1000`,
    settings
  );

  const shipments = Array.isArray(response?.shipments) ? response.shipments : [];
  const sheet = ensureShipmentsSheet_();
  sheet.clearContents();

  const headerValues = [[
    "Created At",
    "Order ID",
    "Payment Session",
    "Customer",
    "Email",
    "Phone",
    "Ship To",
    "Items",
    "Units",
    "Order Total",
    "Order Note",
    "Status",
    "Carrier",
    "Service",
    "Tracking",
    "Label URL"
  ]];
  sheet
    .getRange(CONFIG.SHIPMENTS.HEADER_ROW, 1, 1, headerValues[0].length)
    .setValues(headerValues);

  if (shipments.length === 0) {
    sheet
      .getRange(CONFIG.SHIPMENTS.START_ROW, 1)
      .setValue("No shipping orders yet.");
  } else {
    const rows = shipments.map((shipment) => {
      const createdAt = shipment?.created_at
        ? new Date(shipment.created_at)
        : "";
      const amountCents = Number(shipment?.amount_total || 0);
      const amountDollars = amountCents / 100;

      return [
        createdAt,
        String(shipment?.order_id || ""),
        String(shipment?.payment_session_id || ""),
        String(shipment?.customer_name || ""),
        String(shipment?.customer_email || ""),
        String(shipment?.customer_phone || ""),
        formatShipmentAddress_(shipment),
        formatShipmentItems_(shipment),
        Number(shipment?.item_count || 0),
        amountDollars,
        String(shipment?.notes || ""),
        String(shipment?.status || ""),
        String(shipment?.carrier || ""),
        String(shipment?.service || ""),
        String(shipment?.tracking_number || ""),
        String(shipment?.label_url || "")
      ];
    });

    sheet
      .getRange(CONFIG.SHIPMENTS.START_ROW, 1, rows.length, rows[0].length)
      .setValues(rows);

    sheet
      .getRange(CONFIG.SHIPMENTS.START_ROW, 1, rows.length, 1)
      .setNumberFormat("yyyy-mm-dd hh:mm");
    sheet
      .getRange(CONFIG.SHIPMENTS.START_ROW, 9, rows.length, 1)
      .setNumberFormat("0");
    sheet
      .getRange(CONFIG.SHIPMENTS.START_ROW, 10, rows.length, 1)
      .setNumberFormat("$#,##0.00");
  }

  sheet
    .getRange(CONFIG.SHIPMENTS.HEADER_ROW, 1, 1, 16)
    .setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 16);
}

function handleRestockEdit_(sheet, row) {
  const lock = LockService.getDocumentLock() || LockService.getScriptLock();
  lock.waitLock(30000);

  const inputCell = sheet.getRange(row, CONFIG.COLS.STOCK_INPUT);
  const rawValue = inputCell.getValue();

  try {
    if (rawValue === "" || rawValue === null) return;

    const restock = Number(rawValue);
    if (!Number.isFinite(restock)) {
      Logger.log("Invalid restock value: %s", rawValue);
      return;
    }

    const sku = normalizeSku_(sheet.getRange(row, CONFIG.COLS.SKU).getValue());
    if (!sku) {
      Logger.log("Missing SKU for row %s", row);
      return;
    }

    const settings = getSettings_();
    const payload = {
      sku,
      restock: Math.trunc(restock)
    };

    // Clear input before posting so concurrent duplicate triggers do not submit twice.
    inputCell.setValue("");
    SpreadsheetApp.flush();

    const response = postJson_(
      `${settings.apiBaseUrl}/api/admin/restock`,
      settings,
      payload
    );

    if (!response?.ok) {
      inputCell.setValue(rawValue);
      Logger.log(
        "Restock failed for %s (status: %s, error: %s)",
        sku,
        response?.status ?? "unknown",
        response?.error || response?.message || response?.raw || "unknown"
      );
      return;
    }

    if (response.inventory) {
      writeRow_(sheet, row, response.inventory);
    } else {
      syncInventoryRow_(sheet, row, sku, settings);
    }
  } finally {
    lock.releaseLock();
  }
}

function handleRestockDateEdit_(sheet, row) {
  const sku = normalizeSku_(sheet.getRange(row, CONFIG.COLS.SKU).getValue());
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
    settings,
    payload
  );

  if (!response?.ok) {
    Logger.log("Restock date update failed for %s", sku);
  }
}

function handlePreordersEdit_(sheet, row) {
  const sku = normalizeSku_(sheet.getRange(row, CONFIG.COLS.SKU).getValue());
  if (!sku) return;

  const rawValue = sheet.getRange(row, CONFIG.COLS.PREORDERS).getValue();
  const preorders = rawValue === "" || rawValue === null ? 0 : Number(rawValue);

  if (!Number.isFinite(preorders) || preorders < 0) {
    Logger.log("Invalid preorder value for %s: %s", sku, rawValue);
    return;
  }

  const targetPreorders = Math.trunc(preorders);
  const settings = getSettings_();
  const payload = {
    sku,
    preorders_remaining: targetPreorders
  };

  const response = patchJson_(
    `${settings.apiBaseUrl}/api/admin/inventory`,
    settings,
    payload
  );

  if (!response?.ok) {
    Logger.log(
      "Preorders update failed for %s (status: %s, error: %s)",
      sku,
      response?.status ?? "unknown",
      response?.error || response?.message || response?.raw || "unknown"
    );
    return;
  }

  const returnedPreorders = Number(response?.inventory?.preorders_remaining);
  if (!Number.isFinite(returnedPreorders) || returnedPreorders !== targetPreorders) {
    Logger.log(
      "Preorders mismatch for %s. Sent: %s, Returned: %s. Check API deploy at %s",
      sku,
      targetPreorders,
      response?.inventory?.preorders_remaining,
      settings.apiBaseUrl
    );
    SpreadsheetApp.getActive().toast(
      `Preorders update not saved for ${sku}. Check API deployment.`,
      "Vida Verde",
      5
    );
    return;
  }

  if (response.inventory) {
    writeRow_(sheet, row, response.inventory);
  } else {
    syncInventoryRow_(sheet, row, sku, settings);
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
    settings,
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
    settings
  );

  const inventory = Array.isArray(response?.inventory) ? response.inventory : [];
  const normalizedSku = normalizeSku_(sku);
  const record = inventory.find((item) => normalizeSku_(item?.sku) === normalizedSku);

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

function ensurePrepSheet_() {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName(CONFIG.PREP_SHEET_NAME);

  if (!sheet) {
    sheet = book.insertSheet(CONFIG.PREP_SHEET_NAME);
  }

  return sheet;
}

function ensureOrdersSheet_() {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName(CONFIG.ORDERS_SHEET_NAME);

  if (!sheet) {
    sheet = book.insertSheet(CONFIG.ORDERS_SHEET_NAME);
  }

  return sheet;
}

function ensureShipmentsSheet_() {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName(CONFIG.SHIPMENTS_SHEET_NAME);

  if (!sheet) {
    sheet = book.insertSheet(CONFIG.SHIPMENTS_SHEET_NAME);
  }

  return sheet;
}

function formatShipmentAddress_(shipment) {
  const addressParts = [
    String(shipment?.address1 || "").trim(),
    String(shipment?.address2 || "").trim(),
    [shipment?.city, shipment?.state, shipment?.postal_code]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(", "),
    String(shipment?.country || "").trim()
  ].filter(Boolean);

  return addressParts.join(" | ");
}

function formatOrderAddress_(order) {
  const addressParts = [
    String(order?.address1 || "").trim(),
    String(order?.address2 || "").trim(),
    [order?.city, order?.state, order?.postal_code]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(", ")
  ].filter(Boolean);

  if (addressParts.length === 0) {
    return order?.fulfillment === "market"
      ? "Pickup at Fulshear Farmers Market"
      : "";
  }

  return addressParts.join(" | ");
}

function formatOrderItems_(order) {
  const summary = String(order?.items_summary || "").trim();
  if (summary) return summary;

  const items = Array.isArray(order?.items_json) ? order.items_json : [];
  return items
    .map((item) => {
      const name = String(item?.name || "").trim();
      const sku = normalizeSku_(item?.sku);
      const label = name || sku;
      const quantity = Number(item?.quantity || 0);
      if (!label || quantity <= 0) return "";
      return `${label} x${quantity}`;
    })
    .filter(Boolean)
    .join(", ");
}

function formatOrderFulfillment_(value) {
  return value === "market"
    ? "Pickup at Fulshear Farmers Market"
    : "Ship to me";
}

function formatShipmentItems_(shipment) {
  const summary = String(shipment?.items_summary || "").trim();
  if (summary) return summary;

  const items = Array.isArray(shipment?.items_json) ? shipment.items_json : [];
  const fallbackSummary = items
    .map((item) => {
      const name = String(item?.name || "").trim();
      const sku = normalizeSku_(item?.sku);
      const label = name || sku;
      const quantity = Number(item?.quantity || 0);
      if (!label || quantity <= 0) return "";
      return `${label} x${quantity}`;
    })
    .filter(Boolean)
    .join(", ");

  return fallbackSummary;
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

function normalizeSku_(value) {
  return String(value || "").trim().toUpperCase();
}

function getSettings_() {
  const props = PropertiesService.getScriptProperties();
  const apiBaseUrl = props.getProperty("API_BASE_URL");
  const adminJwtSecret =
    props.getProperty("ADMIN_JWT_SECRET") || props.getProperty("ADMIN_RESTOCK_SECRET");
  const adminJwtIssuer = props.getProperty("ADMIN_JWT_ISSUER") || "vidaverde-admin";
  const adminJwtAudience = props.getProperty("ADMIN_JWT_AUDIENCE") || "vidaverde-admin-api";
  const adminJwtSubject =
    props.getProperty("ADMIN_JWT_SUBJECT") || "vidaverde-inventory-sync";
  const adminJwtRoles = String(
    props.getProperty("ADMIN_JWT_ROLES") || "ops_admin,inventory_admin"
  )
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);

  if (!apiBaseUrl || !adminJwtSecret) {
    throw new Error(
      "Missing API_BASE_URL or ADMIN_JWT_SECRET (or legacy ADMIN_RESTOCK_SECRET) script properties."
    );
  }

  return {
    apiBaseUrl,
    adminJwtSecret,
    adminJwtIssuer,
    adminJwtAudience,
    adminJwtSubject,
    adminJwtRoles
  };
}

function encodeBase64Url_(value) {
  const encoded = Array.isArray(value)
    ? Utilities.base64EncodeWebSafe(value)
    : Utilities.base64EncodeWebSafe(String(value), Utilities.Charset.UTF_8);
  return encoded.replace(/=+$/g, "");
}

function createAdminJwt_(settings) {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "HS256",
    typ: "JWT"
  };
  const payload = {
    iss: settings.adminJwtIssuer,
    aud: settings.adminJwtAudience,
    sub: settings.adminJwtSubject,
    roles: settings.adminJwtRoles,
    iat: now,
    nbf: now - 5,
    exp: now + 60,
    jti: Utilities.getUuid()
  };

  const encodedHeader = encodeBase64Url_(JSON.stringify(header));
  const encodedPayload = encodeBase64Url_(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signatureBytes = Utilities.computeHmacSha256Signature(
    signingInput,
    settings.adminJwtSecret,
    Utilities.Charset.UTF_8
  );
  const signature = encodeBase64Url_(signatureBytes);

  return `${signingInput}.${signature}`;
}

function buildAdminAuthHeaders_(settings) {
  return {
    Authorization: `Bearer ${createAdminJwt_(settings)}`
  };
}

function getJson_(url, settings) {
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: buildAdminAuthHeaders_(settings),
    muteHttpExceptions: true
  });

  return JSON.parse(response.getContentText());
}

function postJson_(url, settings, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: buildAdminAuthHeaders_(settings),
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

function patchJson_(url, settings, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    headers: buildAdminAuthHeaders_(settings),
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
