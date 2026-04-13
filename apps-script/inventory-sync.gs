const CONFIG = {
  SHEET_NAME: "Inventory",
  PREP_SHEET_NAME: "Prepare for this week",
  ORDERS_SHEET_NAME: "Orders",
  SHIPMENTS_SHEET_NAME: "Shipments",
  EMAIL_SIGNUPS_SHEET_NAME: "Email List",
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
  },
  EMAIL_SIGNUPS: {
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
    .addItem("Send Pickup Reminders Now", "sendPickupReminders")
    .addItem("Setup Friday Reminder Trigger", "setupFridayReminderTrigger")
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

function setupFridayReminderTrigger() {
  const triggers = ScriptApp.getProjectTriggers().filter((trigger) => {
    return (
      trigger.getHandlerFunction() === "sendPickupReminders" &&
      trigger.getEventType() === ScriptApp.EventType.CLOCK
    );
  });

  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }

  ScriptApp.newTrigger("sendPickupReminders")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(12)
    .inTimezone("America/Chicago")
    .create();

  SpreadsheetApp.getUi().alert(
    "Friday pickup reminder trigger reset for 12pm America/Chicago."
  );
}

function masterSync() {
  const ui = SpreadsheetApp.getUi();
  const steps = [
    { name: "Inventory", run: syncInventory },
    { name: "Weekly Prep", run: syncWeeklyPrep },
    { name: "Orders", run: syncOrders },
    { name: "Shipments", run: syncShipments },
    { name: "Email List", run: syncEmailSignups }
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
    "Inventory, prep, orders, shipments, and email signups synced.",
    "Vida Verde",
    5
  );
}

function sendPickupReminders() {
  ensureSettingsSheet_();

  const settings = getSettings_();
  const response = postJson_(
    `${settings.apiBaseUrl}/api/admin/pickup-reminders`,
    settings,
    {}
  );

  if (!response?.ok) {
    Logger.log(
      "Pickup reminder send failed (status: %s, error: %s)",
      response?.status ?? "unknown",
      response?.error || response?.message || response?.raw || "unknown"
    );
    SpreadsheetApp.getActive().toast(
      "Pickup reminder send failed. Check Apps Script logs.",
      "Vida Verde",
      5
    );
    return;
  }

  const sentCount = Number(response?.sentCount || 0);
  const pickupDate = String(response?.pickupDate || "").trim();
  const targetLabel = pickupDate || "the next pickup day";

  if (response?.skipped) {
    SpreadsheetApp.getActive().toast(
      `Pickup reminders skipped for ${targetLabel}: ${response?.reason || "email is not configured."}`,
      "Vida Verde",
      5
    );
    return;
  }

  SpreadsheetApp.getActive().toast(
    sentCount > 0
      ? `${sentCount} pickup reminder email(s) sent for ${targetLabel}.`
      : `No pickup reminder emails needed for ${targetLabel}.`,
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
  const pickupOrders = Array.isArray(response?.pickup_orders) ? response.pickup_orders : [];
  const weekInfo = response?.week || {};
  const pickup = response?.pickup || {};
  const normalizedPrepRows = prepRows.map((row) => normalizePrepRow_(row));
  const productionRows = normalizedPrepRows.filter((row) => Number(row?.total_qty || 0) > 0);
  const prepNamesBySku = buildPrepNameMap_(normalizedPrepRows);
  const inventoryPreorderRows = getInventoryPreorderRows_(prepNamesBySku);
  const preorderRows = inventoryPreorderRows !== null
    ? inventoryPreorderRows
    : normalizedPrepRows.filter((row) => Number(row?.preorder_qty || 0) > 0);

  const sheet = ensurePrepSheet_();
  sheet.clear();

  const orderWindow =
    String(weekInfo.collection_window_label || "").trim() ||
    String(
      [weekInfo.collection_start_label, weekInfo.collection_end_label]
        .filter(Boolean)
        .join(" to ")
    ).trim() ||
    [weekInfo.week_start_date, weekInfo.week_end_date]
      .filter(Boolean)
      .join(" to ");
  const pickupDateLabel =
    String(pickup.market_date_label || "").trim() ||
    String(pickup.market_date || weekInfo.market_date || "").trim();
  const metaValues = [[
    "Orders Collected",
    orderWindow,
    "Saturday Pickup",
    pickupDateLabel
  ]];
  sheet
    .getRange(CONFIG.PREP.META_ROW, 1, 1, metaValues[0].length)
    .setValues(metaValues)
    .setFontWeight("bold");

  let currentRow = 2;

  const pickupSectionRow = currentRow;
  sheet.getRange(pickupSectionRow, 1).setValue("Saturday Pickup Verification");
  currentRow += 1;

  const pickupHeaderRow = currentRow;
  const pickupHeaderValues = [[
    "Name",
    "Phone",
    "Email",
    "Order",
    "Units"
  ]];
  sheet
    .getRange(pickupHeaderRow, 1, 1, pickupHeaderValues[0].length)
    .setValues(pickupHeaderValues);
  currentRow += 1;

  if (pickupOrders.length === 0) {
    sheet
      .getRange(currentRow, 1)
      .setValue("No Saturday pickup orders ready yet.");
    currentRow += 1;
  } else {
    const pickupRows = pickupOrders.map((order) => ([
      String(order?.customer_name || ""),
      formatPhoneForSheet_(order?.customer_phone),
      String(order?.customer_email || ""),
      formatPickupOrderItems_(order),
      Number(order?.item_count || 0)
    ]));

    sheet
      .getRange(currentRow, 1, pickupRows.length, pickupRows[0].length)
      .setValues(pickupRows);
    sheet
      .getRange(currentRow, 5, pickupRows.length, 1)
      .setNumberFormat("0");
    currentRow += pickupRows.length;
  }

  currentRow += 1;

  const prepSectionRow = currentRow;
  sheet.getRange(prepSectionRow, 1).setValue("Jars To Make This Week");
  currentRow += 1;

  const prepHeaderRow = currentRow;
  const prepHeaderValues = [[
    "Product",
    "Ship This Week",
    "Market Pickup This Saturday",
    "Total Jars To Make"
  ]];
  sheet
    .getRange(prepHeaderRow, 1, 1, prepHeaderValues[0].length)
    .setValues(prepHeaderValues);
  currentRow += 1;

  if (productionRows.length === 0) {
    sheet
      .getRange(currentRow, 1)
      .setValue("No non-preorder jars to make for this week yet.");
    currentRow += 1;
  } else {
    const rows = productionRows.map((row) => ([
      String(row?.name || ""),
      Number(row?.shipping_qty || 0),
      Number(row?.market_qty || 0),
      Number(row?.total_qty || 0)
    ]));

    sheet
      .getRange(currentRow, 1, rows.length, rows[0].length)
      .setValues(rows);

    const shipTotal = rows.reduce((sum, row) => sum + row[1], 0);
    const marketTotal = rows.reduce((sum, row) => sum + row[2], 0);
    const totalToPrepare = rows.reduce((sum, row) => sum + row[3], 0);
    const totalsRow = currentRow + rows.length;

    sheet
      .getRange(totalsRow, 1, 1, 4)
      .setValues([[
        "TOTAL",
        shipTotal,
        marketTotal,
        totalToPrepare
      ]]);
    sheet
      .getRange(currentRow, 2, rows.length + 1, 3)
      .setNumberFormat("0");
    sheet
      .getRange(totalsRow, 1, 1, 4)
      .setFontWeight("bold");
    currentRow = totalsRow + 1;
  }

  currentRow += 1;

  const preorderSectionRow = currentRow;
  sheet.getRange(preorderSectionRow, 1).setValue("Pre-orders To Handle Separately");
  currentRow += 1;

  const preorderHeaderRow = currentRow;
  const preorderHeaderValues = [[
    "Product",
    "Total Pre-orders"
  ]];
  sheet
    .getRange(preorderHeaderRow, 1, 1, preorderHeaderValues[0].length)
    .setValues(preorderHeaderValues);
  currentRow += 1;

  if (preorderRows.length === 0) {
    sheet
      .getRange(currentRow, 1)
      .setValue("No pre-orders pending.");
    currentRow += 1;
  } else {
    const rows = preorderRows.map((row) => ([
      String(row?.name || ""),
      Number(row?.preorder_qty || 0)
    ]));

    sheet
      .getRange(currentRow, 1, rows.length, rows[0].length)
      .setValues(rows);

    const preorderTotal = rows.reduce((sum, row) => sum + row[1], 0);
    const totalsRow = currentRow + rows.length;

    sheet
      .getRange(totalsRow, 1, 1, 2)
      .setValues([["TOTAL", preorderTotal]]);
    sheet
      .getRange(currentRow, 2, rows.length + 1, 1)
      .setNumberFormat("0");
    sheet
      .getRange(totalsRow, 1, 1, 2)
      .setFontWeight("bold");
    currentRow = totalsRow + 1;
  }

  sheet
    .getRange(pickupSectionRow, 1, 1, 5)
    .setFontWeight("bold");
  sheet
    .getRange(prepSectionRow, 1, 1, 4)
    .setFontWeight("bold");
  sheet
    .getRange(preorderSectionRow, 1, 1, 2)
    .setFontWeight("bold");
  sheet
    .getRange(pickupHeaderRow, 1, 1, 5)
    .setFontWeight("bold");
  sheet
    .getRange(prepHeaderRow, 1, 1, 4)
    .setFontWeight("bold");
  sheet
    .getRange(preorderHeaderRow, 1, 1, 2)
    .setFontWeight("bold");
  sheet
    .getRange(1, 1, Math.max(currentRow - 1, 1), 5)
    .setVerticalAlignment("top");
  sheet
    .getRange(pickupHeaderRow, 1, 1, 5)
    .setBackground("#d9ead3");
  sheet
    .getRange(prepHeaderRow, 1, 1, 4)
    .setBackground("#fce5cd");
  sheet
    .getRange(preorderHeaderRow, 1, 1, 2)
    .setBackground("#d9d2e9");
  sheet
    .getRange(pickupSectionRow, 1)
    .setFontSize(12);
  sheet
    .getRange(prepSectionRow, 1)
    .setFontSize(12);
  sheet
    .getRange(preorderSectionRow, 1)
    .setFontSize(12);
  sheet
    .getRange(1, 1, Math.max(currentRow - 1, 1), 5)
    .setWrap(true);

  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 130);
  sheet.setColumnWidth(3, 220);
  sheet.setColumnWidth(4, 420);
  sheet.setColumnWidth(5, 110);
  sheet.autoResizeRows(1, Math.max(currentRow - 1, 1));
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
        formatPhoneForSheet_(order?.customer_phone),
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
        formatPhoneForSheet_(shipment?.customer_phone),
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

function syncEmailSignups() {
  ensureSettingsSheet_();

  const settings = getSettings_();
  const response = getJson_(
    `${settings.apiBaseUrl}/api/admin/email-signups?limit=5000`,
    settings
  );

  const emailSignups = Array.isArray(response?.email_signups)
    ? response.email_signups
    : [];
  const sheet = ensureEmailSignupsSheet_();
  sheet.clearContents();

  const headerValues = [[
    "Signed Up At",
    "Email",
    "Source"
  ]];
  sheet
    .getRange(CONFIG.EMAIL_SIGNUPS.HEADER_ROW, 1, 1, headerValues[0].length)
    .setValues(headerValues);

  if (emailSignups.length === 0) {
    sheet
      .getRange(CONFIG.EMAIL_SIGNUPS.START_ROW, 1)
      .setValue("No email signups yet.");
  } else {
    const rows = emailSignups.map((signup) => ([
      signup?.created_at ? new Date(signup.created_at) : "",
      String(signup?.email || ""),
      String(signup?.source || "website")
    ]));

    sheet
      .getRange(CONFIG.EMAIL_SIGNUPS.START_ROW, 1, rows.length, rows[0].length)
      .setValues(rows);

    sheet
      .getRange(CONFIG.EMAIL_SIGNUPS.START_ROW, 1, rows.length, 1)
      .setNumberFormat("yyyy-mm-dd hh:mm");
  }

  sheet
    .getRange(CONFIG.EMAIL_SIGNUPS.HEADER_ROW, 1, 1, 3)
    .setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 3);
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

    const preorderReadyEmailCount = Number(
      response?.preorder_ready_pickup_emails_sent || 0
    );
    if (Number.isFinite(preorderReadyEmailCount) && preorderReadyEmailCount > 0) {
      SpreadsheetApp.getActive().toast(
        `${preorderReadyEmailCount} preorder ready email(s) sent for ${sku}.`,
        "Vida Verde",
        5
      );
    }

    try {
      syncWeeklyPrep();
    } catch (error) {
      Logger.log(
        "Weekly prep sync after restock failed for %s: %s",
        sku,
        error && error.message ? error.message : String(error)
      );
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

  const settings = getSettings_();
  SpreadsheetApp.getActive().toast(
    `Preorders for ${sku} are managed automatically from paid orders and cannot be edited manually.`,
    "Vida Verde",
    5
  );

  syncInventoryRow_(sheet, row, sku, settings);

  try {
    syncWeeklyPrep();
  } catch (error) {
    Logger.log(
      "Weekly prep sync after preorder update failed for %s: %s",
      sku,
      error && error.message ? error.message : String(error)
    );
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

function ensureEmailSignupsSheet_() {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName(CONFIG.EMAIL_SIGNUPS_SHEET_NAME);

  if (!sheet) {
    sheet = book.insertSheet(CONFIG.EMAIL_SIGNUPS_SHEET_NAME);
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

function formatPickupOrderItems_(order) {
  const summary = String(order?.items_summary || "").trim();
  if (summary) return summary;

  const items = Array.isArray(order?.items) ? order.items : [];
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

function getPhoneDigits_(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatUsPhone_(digits) {
  if (!digits) return "";
  if (digits.length < 4) return `(${digits}`;
  if (digits.length < 7) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatPhoneForSheet_(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const digits = getPhoneDigits_(raw).slice(0, 15);
  if (!digits) return "";

  if (!raw.startsWith("+")) {
    if (digits.length <= 10) {
      return formatUsPhone_(digits);
    }

    if (digits.length === 11 && digits.startsWith("1")) {
      return `+1 ${formatUsPhone_(digits.slice(1))}`;
    }

    return `+${digits}`;
  }

  if (digits.startsWith("1") && digits.length <= 11) {
    const usDigits = digits.slice(1);
    if (!usDigits) return "+1";
    return `+1 ${formatUsPhone_(usDigits)}`;
  }

  return `+${digits}`;
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

function normalizePrepRow_(row) {
  const shippingQty = Math.max(Number(row?.shipping_qty || 0), 0);
  const marketQty = Math.max(Number(row?.market_qty || 0), 0);
  const totalQty = Math.max(Number(row?.total_qty || shippingQty + marketQty), 0);
  const preorderQty = Math.max(Number(row?.preorder_qty || 0), 0);
  const hasSplitPreorders =
    row &&
    (row.shipping_preorder_qty !== undefined || row.market_preorder_qty !== undefined);

  if (hasSplitPreorders) {
    return {
      ...row,
      shipping_qty: shippingQty,
      market_qty: marketQty,
      total_qty: shippingQty + marketQty,
      preorder_qty: preorderQty,
      shipping_preorder_qty: Math.max(Number(row?.shipping_preorder_qty || 0), 0),
      market_preorder_qty: Math.max(Number(row?.market_preorder_qty || 0), 0)
    };
  }

  const readyTotal = Math.max(totalQty - preorderQty, 0);

  // Legacy prep payloads only expose a combined preorder count.
  // Remove those units from Saturday pickup first so the market tally stays conservative.
  const inferredMarketPreorders = Math.min(preorderQty, marketQty);
  const inferredShippingPreorders = Math.max(preorderQty - inferredMarketPreorders, 0);
  const readyMarketQty = Math.max(marketQty - inferredMarketPreorders, 0);
  const readyShippingQty = Math.max(readyTotal - readyMarketQty, 0);

  return {
    ...row,
    shipping_qty: readyShippingQty,
    market_qty: readyMarketQty,
    total_qty: readyTotal,
    preorder_qty: preorderQty,
    shipping_preorder_qty: inferredShippingPreorders,
    market_preorder_qty: inferredMarketPreorders
  };
}

function buildPrepNameMap_(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((acc, row) => {
    const sku = normalizeSku_(row?.sku);
    const name = String(row?.name || "").trim();

    if (sku && name) {
      acc[sku] = name;
    }

    return acc;
  }, {});
}

function getInventoryPreorderRows_(fallbackNamesBySku) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return null;

  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.START_ROW) {
    return [];
  }

  const rows = sheet
    .getRange(
      CONFIG.START_ROW,
      CONFIG.COLS.SKU,
      lastRow - CONFIG.START_ROW + 1,
      CONFIG.COLS.PREORDERS
    )
    .getValues();
  const preorderColIndex = CONFIG.COLS.PREORDERS - CONFIG.COLS.SKU;

  return rows.reduce((acc, row) => {
    const sku = normalizeSku_(row[0]);
    if (!sku) return acc;

    const preorderQty = Number(row[preorderColIndex]);
    if (!Number.isFinite(preorderQty) || preorderQty <= 0) {
      return acc;
    }

    const productName =
      String(row[1] || "").trim() ||
      String((fallbackNamesBySku || {})[sku] || "").trim() ||
      sku;

    acc.push({
      sku,
      name: productName,
      preorder_qty: Math.trunc(preorderQty)
    });

    return acc;
  }, []);
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
    Authorization: `Bearer ${createAdminJwt_(settings)}`,
    Accept: "application/json"
  };
}

function parseJsonResponse_(response) {
  const status = response.getResponseCode();
  const text = response.getContentText();

  try {
    const parsed = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === "object") {
      return { status, ...parsed };
    }
    return { status, data: parsed };
  } catch (error) {
    return {
      status,
      error: "Invalid JSON response",
      raw: text
    };
  }
}

function getJson_(url, settings) {
  const response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: buildAdminAuthHeaders_(settings),
    muteHttpExceptions: true
  });

  const parsed = parseJsonResponse_(response);
  if (parsed.status === 404) {
    throw new Error(
      `GET ${url} failed (404): Route not found on the deployed site. Redeploy ${settings.apiBaseUrl} with the latest code so /api/admin/email-signups exists.`
    );
  }
  if (parsed.status < 200 || parsed.status >= 300) {
    throw new Error(
      `GET ${url} failed (${parsed.status}): ${parsed.error || parsed.message || parsed.raw || "Unknown error"}`
    );
  }
  if (parsed.error) {
    throw new Error(
      `GET ${url} returned an error payload: ${parsed.error}`
    );
  }

  return parsed;
}

function postJson_(url, settings, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: buildAdminAuthHeaders_(settings),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  return parseJsonResponse_(response);
}

function patchJson_(url, settings, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    headers: buildAdminAuthHeaders_(settings),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  return parseJsonResponse_(response);
}
