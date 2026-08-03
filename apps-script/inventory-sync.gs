const CONFIG = {
  SHEET_NAME: "Inventory",
  PREP_SHEET_NAME: "Prepare for this week",
  ORDERS_SHEET_NAME: "Orders",
  SHIPMENTS_SHEET_NAME: "Shipments",
  EMAIL_SIGNUPS_SHEET_NAME: "Email List",
  HEALTH_SHEET_NAME: "Health",
  SETTINGS_SHEET_NAME: "Settings",
  PUNIT_MONTHLY_PAYOUTS_SHEET_NAME: "Punit Monthly Payouts",
  FINANCIAL_DISTRIBUTIONS_SHEET_NAME: "Financial Distributions",
  FINANCIAL_DISTRIBUTIONS_START_DATE: "2026-07-01",
  PUNIT_PAYOUT_EMAIL_RECIPIENTS: [
    "vidaverdemicrogreens@gmail.com",
    "punit@peridotkonda.com"
  ],
  PUNIT_PAYOUT_TIMEZONE: "America/Chicago",
  PUNIT_PAYOUT_LAST_SENT_PROPERTY: "PUNIT_PAYOUT_LAST_SENT_MONTH",
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
    START_ROW: 2,
    REMOVE_COL: 4,
    RESTORE_COL: 9,
    CONFIRM_ROW: 2,
    CONFIRM_COL: 11
  },
  HEALTH: {
    HEADER_ROW: 1,
    START_ROW: 2
  }
};

function onOpen() {
  ensureSettingsSheet_();

  const ui = SpreadsheetApp.getUi();
  const shippingMenu = ui
    .createMenu("Shipping")
    .addItem("Refresh Shipments and Labels", "syncShipments");
  const emailMenu = ui
    .createMenu("Customer Emails")
    .addItem("Send Pickup Reminders Now", "sendPickupReminders")
    .addItem("Process Pending Emails Now", "processEmailQueue")
    .addItem("Retry Failed Confirmations", "retryFailedConfirmationEmails")
    .addItem("Check STOP Replies Now", "processEmailUnsubscribeReplies");
  const payoutMenu = ui
    .createMenu("Payouts")
    .addItem("Send Previous Month Payout", "sendMonthlyPunitPayoutReport");

  ui
    .createMenu("Vida Verde")
    .addItem("Sync All", "masterSync")
    .addSeparator()
    .addSubMenu(shippingMenu)
    .addSubMenu(emailMenu)
    .addSubMenu(payoutMenu)
    .addSeparator()
    .addItem("Set Up / Reset Automations", "setupTriggers")
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

  if (sheetName === CONFIG.EMAIL_SIGNUPS_SHEET_NAME) {
    if (
      row === CONFIG.EMAIL_SIGNUPS.CONFIRM_ROW &&
      col === CONFIG.EMAIL_SIGNUPS.CONFIRM_COL &&
      String(e.value || "").toUpperCase() === "TRUE"
    ) {
      confirmEmailListChanges_(sheet);
    }
    return;
  }

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
  resetEditTrigger_();
  SpreadsheetApp.getUi().alert("Installable edit trigger reset.");
}

function resetEditTrigger_() {
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
}

function setupFridayReminderTrigger() {
  resetFridayReminderTrigger_();
  SpreadsheetApp.getUi().alert(
    "Friday pickup reminder trigger reset for 12pm America/Chicago."
  );
}

function resetFridayReminderTrigger_() {
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
}

function resetMonthlyPunitPayoutTrigger_() {
  const triggers = ScriptApp.getProjectTriggers().filter((trigger) => {
    return (
      trigger.getHandlerFunction() === "sendMonthlyPunitPayoutReport" &&
      trigger.getEventType() === ScriptApp.EventType.CLOCK
    );
  });

  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }

  ScriptApp.newTrigger("sendMonthlyPunitPayoutReport")
    .timeBased()
    .onMonthDay(1)
    .atHour(8)
    .inTimezone(CONFIG.PUNIT_PAYOUT_TIMEZONE)
    .create();
}

function setupTriggers() {
  resetEditTrigger_();
  resetFridayReminderTrigger_();
  resetMonthlyPunitPayoutTrigger_();
  resetEmailUnsubscribeTrigger_();
  resetEmailQueueTrigger_();
  resetPreorderReadyEmailTrigger_();
  resetShipmentSyncTrigger_();
  SpreadsheetApp.getUi().alert(
    "Triggers reset: inventory edits, shipment and label refreshes, pending confirmation emails, preorder-ready emails, STOP replies, Friday pickup reminders, and monthly Punit payout emails."
  );
}

function resetShipmentSyncTrigger_() {
  const handlerName = "syncShipments";
  const triggers = ScriptApp.getProjectTriggers().filter((trigger) =>
    trigger.getHandlerFunction() === handlerName
  );

  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }

  ScriptApp.newTrigger(handlerName)
    .timeBased()
    .everyMinutes(5)
    .create();
}

function resetEmailUnsubscribeTrigger_() {
  const handlerName = "processEmailUnsubscribeReplies";
  const triggers = ScriptApp.getProjectTriggers().filter((trigger) =>
    trigger.getHandlerFunction() === handlerName
  );

  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }

  ScriptApp.newTrigger(handlerName)
    .timeBased()
    .everyMinutes(5)
    .create();
}

function resetEmailQueueTrigger_() {
  const handlerName = "processEmailQueue";
  const triggers = ScriptApp.getProjectTriggers().filter((trigger) =>
    trigger.getHandlerFunction() === handlerName
  );

  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }

  ScriptApp.newTrigger(handlerName)
    .timeBased()
    .everyMinutes(5)
    .create();
}

function resetPreorderReadyEmailTrigger_() {
  const handlerName = "sendQueuedPreorderReadyEmails";
  const triggers = ScriptApp.getProjectTriggers().filter((trigger) =>
    trigger.getHandlerFunction() === handlerName
  );

  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }

  ScriptApp.newTrigger(handlerName)
    .timeBased()
    .everyMinutes(5)
    .create();
}

function masterSync() {
  const steps = [
    { name: "Inventory", run: syncInventory },
    { name: "Weekly Prep", run: syncWeeklyPrep },
    { name: "Orders", run: syncOrders },
    { name: "Shipments", run: syncShipments },
    { name: "Email List", run: syncEmailSignups },
    { name: "Health", run: syncHealthCheck }
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
    Logger.log("Master sync completed with errors:\n\n%s", failed.join("\n"));
    toastIfAvailable_(
      "Master sync completed with errors. Check Apps Script logs.",
      "Vida Verde",
      5
    );
    return;
  }

  toastIfAvailable_(
    "Inventory, prep, orders, shipments, email signups, and health synced.",
    "Vida Verde",
    5
  );
}

function toastIfAvailable_(message, title, timeoutSeconds) {
  try {
    const spreadsheet = SpreadsheetApp.getActive();
    if (spreadsheet) {
      spreadsheet.toast(message, title, timeoutSeconds);
    }
  } catch (error) {
    Logger.log("Toast skipped: %s", error && error.message ? error.message : error);
  }
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
    toastIfAvailable_(
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
    toastIfAvailable_(
      `Pickup reminders skipped for ${targetLabel}: ${response?.reason || "email is not configured."}`,
      "Vida Verde",
      5
    );
    return;
  }

  toastIfAvailable_(
    sentCount > 0
      ? `${sentCount} pickup reminder email(s) sent for ${targetLabel}.`
      : `No pickup reminder emails needed for ${targetLabel}.`,
    "Vida Verde",
    5
  );
}

function processEmailQueue() {
  ensureSettingsSheet_();

  const settings = getSettings_();
  const response = postJson_(
    `${settings.apiBaseUrl}/api/admin/email-jobs`,
    settings,
    { action: "process", limit: 10 }
  );

  if (!response?.ok) {
    Logger.log(
      "Email queue processing failed (status: %s, error: %s)",
      response?.status ?? "unknown",
      response?.error || response?.message || response?.raw || "unknown"
    );
    toastIfAvailable_(
      "Email queue processing failed. Check Apps Script logs.",
      "Vida Verde",
      5
    );
    syncHealthCheck();
    return;
  }

  if (response?.deliveryOk === false) {
    Logger.log(
      "Email queue completed with delivery failures (failed: %s)",
      Number(response?.failedCount || 0)
    );
    toastIfAvailable_(
      "One or more confirmation emails need attention. Check the Health sheet.",
      "Vida Verde",
      6
    );
    syncHealthCheck();
    return;
  }

  const sentCount = Number(response?.sentCount || 0);
  const deferredCount = Number(response?.deferredCount || 0);
  const failedCount = Number(response?.failedCount || 0);
  toastIfAvailable_(
    `${sentCount} email(s) sent, ${deferredCount} waiting, ${failedCount} failed.`,
    "Vida Verde",
    5
  );
  syncHealthCheck();
}

function retryFailedConfirmationEmails() {
  ensureSettingsSheet_();

  const settings = getSettings_();
  const response = postJson_(
    `${settings.apiBaseUrl}/api/admin/email-jobs`,
    settings,
    { action: "retry_failed", limit: 10 }
  );

  if (!response?.ok) {
    Logger.log(
      "Failed confirmation retry failed (status: %s, error: %s)",
      response?.status ?? "unknown",
      response?.error || response?.message || response?.raw || "unknown"
    );
    toastIfAvailable_(
      "Failed confirmations could not be queued again. Check Apps Script logs.",
      "Vida Verde",
      6
    );
    syncHealthCheck();
    return;
  }

  const retriedCount = Number(response?.retriedCount || 0);
  toastIfAvailable_(
    retriedCount > 0
      ? `${retriedCount} failed confirmation email(s) queued again.`
      : "No failed confirmation emails need retrying.",
    "Vida Verde",
    6
  );
  syncHealthCheck();
}

function sendMonthlyPunitPayoutReport() {
  syncOrders();

  const period = getPreviousPunitPayoutPeriod_();
  const scriptProperties = PropertiesService.getScriptProperties();
  const lastSentMonth = scriptProperties.getProperty(
    CONFIG.PUNIT_PAYOUT_LAST_SENT_PROPERTY
  );

  if (lastSentMonth === period.monthKey) {
    Logger.log("Punit payout email already sent for %s.", period.monthKey);
    toastIfAvailable_(
      `Punit payout email already sent for ${period.monthLabel}.`,
      "Vida Verde",
      5
    );
    return;
  }

  const payout = getPunitPayoutForMonth_(period.monthKey);
  const formattedPayout = `$${payout.toFixed(2)}`;
  const distributionsSheet = ensureFinancialDistributionsSheet_();
  const spreadsheetUrl = SpreadsheetApp.getActive().getUrl();
  const reportUrl = `${spreadsheetUrl}#gid=${distributionsSheet.getSheetId()}`;
  const subject = `Vida Verde - Punit payout for ${period.monthLabel}: ${formattedPayout}`;
  const body = [
    `Punit's 15% commission for ${period.monthLabel} is ${formattedPayout}.`,
    "",
    "Calculation: 15% of paid order totals after subtracting shipping.",
    `Financial distributions report: ${reportUrl}`
  ].join("\n");
  const htmlBody = [
    `<p>Punit's 15% commission for <strong>${period.monthLabel}</strong> is ` +
      `<strong>${formattedPayout}</strong>.</p>`,
    "<p>Calculation: 15% of paid order totals after subtracting shipping.</p>",
    `<p><a href="${reportUrl}">Open the financial distributions report</a></p>`
  ].join("");

  MailApp.sendEmail({
    to: CONFIG.PUNIT_PAYOUT_EMAIL_RECIPIENTS.join(","),
    subject,
    body,
    htmlBody,
    name: "Vida Verde"
  });

  scriptProperties.setProperty(
    CONFIG.PUNIT_PAYOUT_LAST_SENT_PROPERTY,
    period.monthKey
  );
  toastIfAvailable_(
    `Punit payout email sent for ${period.monthLabel}: ${formattedPayout}.`,
    "Vida Verde",
    5
  );
}

function getPreviousPunitPayoutPeriod_() {
  const currentMonthKey = Utilities.formatDate(
    new Date(),
    CONFIG.PUNIT_PAYOUT_TIMEZONE,
    "yyyy-MM"
  );
  const parts = currentMonthKey.split("-");
  let year = Number(parts[0]);
  let month = Number(parts[1]) - 1;

  if (month === 0) {
    year -= 1;
    month = 12;
  }

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];
  const paddedMonth = String(month).padStart(2, "0");

  return {
    monthKey: `${year}-${paddedMonth}`,
    monthLabel: `${monthNames[month - 1]} ${year}`
  };
}

function getPunitPayoutForMonth_(monthKey) {
  const firstDistributionMonth = CONFIG.FINANCIAL_DISTRIBUTIONS_START_DATE.slice(
    0,
    7
  );
  if (monthKey < firstDistributionMonth) return 0;

  const sheet = SpreadsheetApp.getActive().getSheetByName(
    CONFIG.ORDERS_SHEET_NAME
  );
  if (!sheet) {
    throw new Error(`Sheet '${CONFIG.ORDERS_SHEET_NAME}' not found.`);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.ORDERS.START_ROW) return 0;

  const rows = sheet
    .getRange(
      CONFIG.ORDERS.START_ROW,
      1,
      lastRow - CONFIG.ORDERS.START_ROW + 1,
      25
    )
    .getValues();
  let payout = 0;

  for (const row of rows) {
    const createdAt = row[0];
    if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
      continue;
    }

    const orderMonthKey = Utilities.formatDate(
      createdAt,
      CONFIG.PUNIT_PAYOUT_TIMEZONE,
      "yyyy-MM"
    );
    if (orderMonthKey !== monthKey) continue;

    const isTestOrder =
      row[24] === true || String(row[24]).toLowerCase() === "true";
    if (isTestOrder) continue;

    const shipping = Number(row[12] || 0);
    const total = Number(row[17] || 0);
    payout += (total - shipping) * 0.15;
  }

  return Math.round((payout + Number.EPSILON) * 100) / 100;
}

function refreshFinancialDistributionsSummary_() {
  const sheet = ensureFinancialDistributionsSheet_();
  const distributionStart = CONFIG.FINANCIAL_DISTRIBUTIONS_START_DATE;
  const distributionStartParts = distributionStart.split("-").map(Number);
  const formula = `=LET(distributionStart,DATE(${distributionStartParts[0]},${distributionStartParts[1]},${distributionStartParts[2]}),firstMonth,EOMONTH(MIN(FILTER(Orders!A2:A,Orders!A2:A<>"")),0),monthCount,DATEDIF(firstMonth,EOMONTH(TODAY(),0),"M")+1,months,ARRAYFORMULA(EOMONTH(EOMONTH(TODAY(),0),-SEQUENCE(monthCount,1,0,1))),totals,MAP(months,LAMBDA(monthEnd,SUMIFS(Orders!R2:R,Orders!A2:A,">="&(EOMONTH(monthEnd,-1)+1),Orders!A2:A,"<"&(monthEnd+1),Orders!A2:A,">="&distributionStart,Orders!Y2:Y,FALSE))),shipping,MAP(months,LAMBDA(monthEnd,SUMIFS(Orders!M2:M,Orders!A2:A,">="&(EOMONTH(monthEnd,-1)+1),Orders!A2:A,"<"&(monthEnd+1),Orders!A2:A,">="&distributionStart,Orders!Y2:Y,FALSE))),net,ARRAYFORMULA(totals-shipping),{"Month End","Total Collected","Shipping","Net After Shipping","Punit (15%)","Vida Verde (85%)";months,totals,shipping,net,ARRAYFORMULA(net*15%),ARRAYFORMULA(net*85%)})`;
  const rowCount = Math.max(sheet.getMaxRows(), 2);

  if (sheet.getMaxColumns() < 6) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 6 - sheet.getMaxColumns());
  }

  sheet.getRange(1, 1, rowCount, 6).clearContent();
  sheet.getRange(1, 1).setFormula(formula);
  sheet
    .getRange(1, 1, 1, 6)
    .setFontWeight("bold")
    .setBackground("#e6e6e6");
  sheet
    .getRange(2, 1, rowCount - 1, 1)
    .setNumberFormat("mmm d, yyyy");
  sheet
    .getRange(2, 2, rowCount - 1, 5)
    .setNumberFormat("$#,##0.00");
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 100);
  sheet.setColumnWidth(4, 135);
  sheet.setColumnWidth(5, 110);
  sheet.setColumnWidth(6, 190);
  SpreadsheetApp.flush();

  return sheet;
}

function refreshPunitMonthlyPayoutsSummary_() {
  const sheet = ensurePunitMonthlyPayoutsSheet_();
  const formula = `=LET(firstMonth,EOMONTH(MIN(FILTER(Orders!A2:A,Orders!A2:A<>"")),0),months,ARRAYFORMULA(EOMONTH(firstMonth,SEQUENCE(DATEDIF(firstMonth,EOMONTH(TODAY(),0),"M")+1,1,0,1))),{"Month End","Punit Payout";months,MAP(months,LAMBDA(monthEnd,(SUMIFS(Orders!R2:R,Orders!A2:A,">="&(EOMONTH(monthEnd,-1)+1),Orders!A2:A,"<"&(monthEnd+1),Orders!Y2:Y,FALSE)-SUMIFS(Orders!M2:M,Orders!A2:A,">="&(EOMONTH(monthEnd,-1)+1),Orders!A2:A,"<"&(monthEnd+1),Orders!Y2:Y,FALSE))*15%))})`;

  sheet.getRange(1, 1).setFormula(formula);
  SpreadsheetApp.flush();

  return sheet;
}

function syncHealthCheck() {
  ensureSettingsSheet_();

  const settings = getSettings_();
  const response = getJson_(
    `${settings.apiBaseUrl}/api/admin/health`,
    settings
  );

  const checks = Array.isArray(response?.checks) ? response.checks : [];
  const checkedAt = response?.generatedAt ? new Date(response.generatedAt) : new Date();
  const sheet = ensureHealthSheet_();
  sheet.clearContents();

  const headerValues = [[
    "Checked At",
    "Area",
    "Status",
    "Value",
    "Details"
  ]];
  sheet
    .getRange(CONFIG.HEALTH.HEADER_ROW, 1, 1, headerValues[0].length)
    .setValues(headerValues)
    .setFontWeight("bold");

  if (checks.length === 0) {
    sheet
      .getRange(CONFIG.HEALTH.START_ROW, 1)
      .setValue("No health checks returned.");
  } else {
    const rows = checks.map((check) => ([
      checkedAt,
      String(check?.label || check?.key || ""),
      String(check?.status || ""),
      String(check?.value ?? ""),
      String(check?.detail || "")
    ]));

    sheet
      .getRange(CONFIG.HEALTH.START_ROW, 1, rows.length, rows[0].length)
      .setValues(sanitizeSheetRows_(rows));
    sheet
      .getRange(CONFIG.HEALTH.START_ROW, 1, rows.length, 1)
      .setNumberFormat("yyyy-mm-dd hh:mm");

    for (let index = 0; index < rows.length; index += 1) {
      const status = String(rows[index][2] || "").toLowerCase();
      const range = sheet.getRange(CONFIG.HEALTH.START_ROW + index, 1, 1, 5);
      if (status === "ok") {
        range.setBackground("#d9ead3");
      } else if (status === "warning") {
        range.setBackground("#fff2cc");
      } else {
        range.setBackground("#f4cccc");
      }
    }
  }

  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 260);
  sheet.setColumnWidth(3, 100);
  sheet.setColumnWidth(4, 220);
  sheet.setColumnWidth(5, 520);
  sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 5).setWrap(true);
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
      .setValues(sanitizeSheetRows_(pickupRows));
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
      .setValues(sanitizeSheetRows_(rows));

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
      .setValues(sanitizeSheetRows_(rows));

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
    "Pickup Date",
    "Customer",
    "Email",
    "Phone",
    "Address",
    "Items",
    "Units",
    "Subtotal",
    "Tax",
    "Shipping",
    "Shipping Method",
    "Shipping Tier",
    "Sauerkraut Units",
    "Hot Sauce Units",
    "Total",
    "Order Note",
    "Status",
    "Payment ID",
    "Net (Total - Shipping)",
    "Punit Commission (15%)",
    "Vida Verde Payout (85%)",
    "Test Order"
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
      const pickupDate = order?.pickup_date
        ? new Date(`${order.pickup_date}T00:00:00`)
        : "";
      const shipping = Number(order?.amount_shipping || 0) / 100;
      const total = Number(order?.amount_total || 0) / 100;
      const netAfterShipping = total - shipping;
      const orderDate = createdAt instanceof Date && !Number.isNaN(createdAt.getTime())
        ? Utilities.formatDate(
            createdAt,
            CONFIG.PUNIT_PAYOUT_TIMEZONE,
            "yyyy-MM-dd"
          )
        : "";
      const isTestOrder = order?.is_test_order === true;
      const isDistributable =
        orderDate >= CONFIG.FINANCIAL_DISTRIBUTIONS_START_DATE &&
        !isTestOrder;
      const distributableNet = isDistributable ? netAfterShipping : 0;

      return [
        createdAt,
        String(order?.id || ""),
        formatOrderFulfillment_(order?.fulfillment),
        pickupDate,
        String(order?.customer_name || ""),
        String(order?.customer_email || ""),
        formatPhoneForSheet_(order?.customer_phone),
        formatOrderAddress_(order),
        formatOrderItems_(order),
        Number(order?.item_count || 0),
        Number(order?.amount_subtotal || 0) / 100,
        Number(order?.amount_tax || 0) / 100,
        shipping,
        String(order?.shipping_option_label || ""),
        String(order?.shipping_tier || ""),
        Number(order?.sauerkraut_count || 0),
        Number(order?.hot_sauce_count || 0),
        total,
        String(order?.note || ""),
        String(order?.status || ""),
        String(order?.payment_session_id || ""),
        distributableNet,
        distributableNet * 0.15,
        distributableNet * 0.85,
        isTestOrder
      ];
    });

    sheet
      .getRange(CONFIG.ORDERS.START_ROW, 1, rows.length, rows[0].length)
      .setValues(sanitizeSheetRows_(rows));

    sheet
      .getRange(CONFIG.ORDERS.START_ROW, 1, rows.length, 1)
      .setNumberFormat("yyyy-mm-dd hh:mm");
    sheet
      .getRange(CONFIG.ORDERS.START_ROW, 4, rows.length, 1)
      .setNumberFormat("yyyy-mm-dd");
    sheet
      .getRange(CONFIG.ORDERS.START_ROW, 10, rows.length, 1)
      .setNumberFormat("0");
    sheet
      .getRange(CONFIG.ORDERS.START_ROW, 11, rows.length, 3)
      .setNumberFormat("$#,##0.00");
    sheet
      .getRange(CONFIG.ORDERS.START_ROW, 16, rows.length, 2)
      .setNumberFormat("0");
    sheet
      .getRange(CONFIG.ORDERS.START_ROW, 18, rows.length, 1)
      .setNumberFormat("$#,##0.00");
    sheet
      .getRange(CONFIG.ORDERS.START_ROW, 22, rows.length, 3)
      .setNumberFormat("$#,##0.00");
  }

  sheet
    .getRange(CONFIG.ORDERS.HEADER_ROW, 1, 1, headerValues[0].length)
    .setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headerValues[0].length);
  refreshPunitMonthlyPayoutsSummary_();
  refreshFinancialDistributionsSummary_();
}

function syncShipments() {
  ensureSettingsSheet_();

  const settings = getSettings_();
  const refreshResponse = postJson_(
    `${settings.apiBaseUrl}/api/admin/shipments`,
    settings,
    {}
  );
  let refreshWarning = "";
  if (!refreshResponse?.ok) {
    refreshWarning =
      `POST ${settings.apiBaseUrl}/api/admin/shipments failed (${refreshResponse?.status ?? "unknown"}): ${refreshResponse?.error || refreshResponse?.message || refreshResponse?.raw || "Unknown error"}`;
    Logger.log("Shipment refresh warning: %s", refreshWarning);
  }
  const automaticLabelErrors = Array.isArray(refreshResponse?.automatic_label_errors)
    ? refreshResponse.automatic_label_errors
    : [];
  if (automaticLabelErrors.length > 0) {
    const message = automaticLabelErrors
      .map((entry) => String(entry?.error || "Automatic label refresh failed."))
      .join(" | ");
    Logger.log("Shipment refresh warning: %s", message);
    toastIfAvailable_(
      "Shipments loaded, but one or more labels need attention. See the Label Error column or execution log.",
      "Shipment warning",
      8
    );
  }
  const response = getJson_(
    `${settings.apiBaseUrl}/api/admin/shipments?limit=1000`,
    settings
  );

  if (refreshWarning) {
    toastIfAvailable_(
      "Shipments were loaded, but synchronization needs attention. See the execution log.",
      "Shipment warning",
      8
    );
  }

  const shipments = Array.isArray(response?.shipments) ? response.shipments : [];
  const sheet = ensureShipmentsSheet_();
  sheet.clearContents();
  sheet
    .getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns())
    .clearDataValidations();

  const headerValues = [[
    "Name",
    "Address",
    "Prepaid Shipping Label",
    "Created At",
    "Items",
    "Shipping Method",
    "Shipping Tier",
    "Order Note",
    "Status",
    "Label Error",
    "Parcel Summary",
    "Total Postage",
    "Total Shipping Cost (Postage + Boxes)",
    "Customer Shipping Charge",
    "Carrier",
    "Service",
    "Tracking",
    "Shipment ID",
    "Order ID",
    "Payment ID",
    "Email",
    "Phone",
    "Units",
    "Order Total",
    "Sauerkraut Units",
    "Hot Sauce Units"
  ]];
  if (sheet.getMaxColumns() < headerValues[0].length) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      headerValues[0].length - sheet.getMaxColumns()
    );
  }
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
        String(shipment?.customer_name || ""),
        formatShipmentAddress_(shipment),
        formatShipmentLabelText_(shipment),
        createdAt,
        formatShipmentItems_(shipment),
        String(shipment?.shipping_option_label || ""),
        String(shipment?.shipping_tier || ""),
        String(shipment?.notes || ""),
        String(shipment?.status || ""),
        String(shipment?.label_purchase_error || ""),
        formatShipmentParcels_(shipment?.parcels),
        (Array.isArray(shipment?.parcels) ? shipment.parcels : []).reduce(
          (sum, parcel) => sum + Number(parcel?.postage_cents || 0),
          0
        ) / 100,
        (Array.isArray(shipment?.parcels) ? shipment.parcels : []).reduce(
          (sum, parcel) => sum + Number(parcel?.postage_cents || 0) + Number(parcel?.box_cost_cents || 0),
          0
        ) / 100,
        Number(shipment?.customer_shipping_charge_cents || 0) / 100,
        String(shipment?.carrier || ""),
        String(shipment?.service || ""),
        String(shipment?.tracking_number || ""),
        String(shipment?.id || ""),
        String(shipment?.order_id || ""),
        String(shipment?.payment_session_id || ""),
        String(shipment?.customer_email || ""),
        formatPhoneForSheet_(shipment?.customer_phone),
        Number(shipment?.item_count || 0),
        amountDollars,
        Number(shipment?.sauerkraut_count || 0),
        Number(shipment?.hot_sauce_count || 0)
      ];
    });

    sheet
      .getRange(CONFIG.SHIPMENTS.START_ROW, 1, rows.length, rows[0].length)
      .setValues(sanitizeSheetRows_(rows));

    sheet
      .getRange(CONFIG.SHIPMENTS.START_ROW, 4, rows.length, 1)
      .setNumberFormat("yyyy-mm-dd hh:mm");
    sheet
      .getRange(CONFIG.SHIPMENTS.START_ROW, 23, rows.length, 1)
      .setNumberFormat("0");
    sheet
      .getRange(CONFIG.SHIPMENTS.START_ROW, 24, rows.length, 1)
      .setNumberFormat("$#,##0.00");
    sheet
      .getRange(CONFIG.SHIPMENTS.START_ROW, 25, rows.length, 2)
      .setNumberFormat("0");
    sheet
      .getRange(CONFIG.SHIPMENTS.START_ROW, 12, rows.length, 3)
      .setNumberFormat("$#,##0.00");
    sheet
      .getRange(CONFIG.SHIPMENTS.START_ROW, 3, rows.length, 1)
      .setRichTextValues(shipments.map((shipment) => [buildShipmentLabelRichText_(shipment)]));
  }

  sheet
    .getRange(CONFIG.SHIPMENTS.HEADER_ROW, 1, 1, headerValues[0].length)
    .setFontWeight("bold")
    .setWrap(true)
    .setVerticalAlignment("middle");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headerValues[0].length);
  sheet.getRange(CONFIG.SHIPMENTS.HEADER_ROW, 3, Math.max(sheet.getLastRow(), 1), 1).setWrap(true);
  sheet.setColumnWidth(3, 190);
  sheet.setColumnWidth(23, 70);
  sheet.setColumnWidth(24, 105);
  sheet.setColumnWidth(25, 120);
  sheet.setColumnWidth(26, 120);
  sheet.setRowHeight(CONFIG.SHIPMENTS.HEADER_ROW, 44);
  sheet.showColumns(1, headerValues[0].length);
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
  const doNotMarket = Array.isArray(response?.do_not_market)
    ? response.do_not_market
    : [];
  const sheet = ensureEmailSignupsSheet_();
  sheet.getDataRange().clearDataValidations();
  sheet.clear();

  const headerValues = [[
    "Signed Up At",
    "Email",
    "Source",
    "Remove",
    "",
    "Unsubscribed At",
    "Email",
    "Reason",
    "Add Back",
    "",
    "Confirm Changes"
  ]];
  sheet
    .getRange(CONFIG.EMAIL_SIGNUPS.HEADER_ROW, 1, 1, headerValues[0].length)
    .setValues(headerValues);

  const activeRows = emailSignups.map((signup) => ([
    signup?.created_at ? new Date(signup.created_at) : "",
    String(signup?.email || ""),
    String(signup?.source || "website"),
    false
  ]));
  const suppressedRows = doNotMarket.map((entry) => ([
    entry?.unsubscribed_at ? new Date(entry.unsubscribed_at) : "",
    String(entry?.email || ""),
    String(entry?.reason || "manual") === "stop_reply"
      ? "STOP reply"
      : "Removed from Email List",
    false
  ]));

  if (activeRows.length === 0) {
    sheet.getRange(CONFIG.EMAIL_SIGNUPS.START_ROW, 1).setValue("No active subscribers.");
  } else {
    sheet
      .getRange(CONFIG.EMAIL_SIGNUPS.START_ROW, 1, activeRows.length, 4)
      .setValues(sanitizeSheetRows_(activeRows));

    sheet
      .getRange(CONFIG.EMAIL_SIGNUPS.START_ROW, 1, activeRows.length, 1)
      .setNumberFormat("yyyy-mm-dd hh:mm");
    sheet
      .getRange(CONFIG.EMAIL_SIGNUPS.START_ROW, CONFIG.EMAIL_SIGNUPS.REMOVE_COL, activeRows.length, 1)
      .insertCheckboxes();
  }

  if (suppressedRows.length === 0) {
    sheet.getRange(CONFIG.EMAIL_SIGNUPS.START_ROW, 6).setValue("No suppressed addresses.");
  } else {
    sheet
      .getRange(CONFIG.EMAIL_SIGNUPS.START_ROW, 6, suppressedRows.length, 4)
      .setValues(sanitizeSheetRows_(suppressedRows))
      .setBackground("#f4cccc");
    sheet
      .getRange(CONFIG.EMAIL_SIGNUPS.START_ROW, 6, suppressedRows.length, 1)
      .setNumberFormat("yyyy-mm-dd hh:mm");
    sheet
      .getRange(CONFIG.EMAIL_SIGNUPS.START_ROW, CONFIG.EMAIL_SIGNUPS.RESTORE_COL, suppressedRows.length, 1)
      .insertCheckboxes();
  }

  sheet
    .getRange(CONFIG.EMAIL_SIGNUPS.HEADER_ROW, 1, 1, 11)
    .setFontWeight("bold");
  sheet
    .getRange(CONFIG.EMAIL_SIGNUPS.CONFIRM_ROW, CONFIG.EMAIL_SIGNUPS.CONFIRM_COL)
    .insertCheckboxes()
    .setValue(false)
    .setBackground("#b6d7a8")
    .setNote("Select all Remove and Add Back checkboxes first, then check here to apply every change together.");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 11);
  sheet.setColumnWidth(5, 30);
  sheet.setColumnWidth(10, 30);
  removeLegacyDoNotMarketSheet_();
}

function confirmEmailListChanges_(sheet) {
  const confirmCell = sheet.getRange(
    CONFIG.EMAIL_SIGNUPS.CONFIRM_ROW,
    CONFIG.EMAIL_SIGNUPS.CONFIRM_COL
  );
  const lock = LockService.getDocumentLock() || LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const lastRow = Math.max(sheet.getLastRow(), CONFIG.EMAIL_SIGNUPS.START_ROW);
    const rows = sheet
      .getRange(CONFIG.EMAIL_SIGNUPS.START_ROW, 1, lastRow - 1, 9)
      .getValues();
    const removeEmails = rows
      .filter((row) => row[3] === true)
      .map((row) => String(row[1] || "").trim().toLowerCase())
      .filter(Boolean);
    const restoreEmails = rows
      .filter((row) => row[8] === true)
      .map((row) => String(row[6] || "").trim().toLowerCase())
      .filter(Boolean);

    if (removeEmails.length === 0 && restoreEmails.length === 0) {
      toastIfAvailable_("Select at least one Remove or Add Back checkbox first.", "Vida Verde", 5);
      return;
    }

    const settings = getSettings_();
    const response = putJson_(
      `${settings.apiBaseUrl}/api/admin/email-signups`,
      settings,
      {
        remove_emails: removeEmails,
        restore_emails: restoreEmails
      }
    );

    if (!response?.ok) {
      throw new Error(response?.error || "Could not apply the selected email-list changes.");
    }

    syncEmailSignups();
    toastIfAvailable_(
      `${Number(response?.removed_count || 0)} removed; ${Number(response?.restored_count || 0)} added back.`,
      "Vida Verde",
      5
    );
  } finally {
    confirmCell.setValue(false);
    lock.releaseLock();
  }
}

function processEmailUnsubscribeReplies() {
  const inboxAddress = "vvsauerkraut@gmail.com";
  const processedProperty = "PROCESSED_STOP_REPLY_MESSAGE_IDS";
  const props = PropertiesService.getScriptProperties();
  const processedIds = new Set(
    JSON.parse(props.getProperty(processedProperty) || "[]")
  );
  const messages = GmailApp.search(
    `to:${inboxAddress} -from:${inboxAddress} newer_than:30d`,
    0,
    100
  ).flatMap((thread) => thread.getMessages());
  const inspectedIds = [];
  const unsubscribeEmails = new Set();

  for (const message of messages) {
    const messageId = String(message.getId() || "");
    if (!messageId || processedIds.has(messageId)) continue;

    inspectedIds.push(messageId);
    const firstReplyLine = String(message.getPlainBody() || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (String(firstReplyLine || "").toLowerCase() !== "stop") continue;

    const from = String(message.getFrom() || "");
    const angleMatch = from.match(/<([^<>]+)>/);
    const senderEmail = String(angleMatch?.[1] || from).trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
      unsubscribeEmails.add(senderEmail);
    }
  }

  if (unsubscribeEmails.size > 0) {
    const settings = getSettings_();
    const response = deleteJson_(
      `${settings.apiBaseUrl}/api/admin/email-signups`,
      settings,
      { emails: [...unsubscribeEmails], reason: "stop_reply" }
    );
    if (!response?.ok) {
      throw new Error(response?.error || "Could not process STOP replies.");
    }
    syncEmailSignups();
  }

  const nextProcessedIds = [...processedIds, ...inspectedIds].slice(-1000);
  props.setProperty(processedProperty, JSON.stringify(nextProcessedIds));
  Logger.log(
    "Processed %s new email reply message(s); removed %s subscriber(s).",
    inspectedIds.length,
    unsubscribeEmails.size
  );
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
      response?.preorder_ready_emails_sent ??
        response?.preorder_ready_pickup_emails_sent ??
        0
    );
    const preorderReadyShippingEmailCount = Number(
      response?.preorder_ready_shipping_emails_sent || 0
    );
    if (Number.isFinite(preorderReadyEmailCount) && preorderReadyEmailCount > 0) {
      toastIfAvailable_(
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

    if (
      Number.isFinite(preorderReadyShippingEmailCount) &&
      preorderReadyShippingEmailCount > 0
    ) {
      try {
        syncShipments();
      } catch (error) {
        Logger.log(
          "Shipment sync after shipped preorder restock failed for %s: %s",
          sku,
          error && error.message ? error.message : String(error)
        );
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function formatShipmentParcels_(parcels) {
  if (!Array.isArray(parcels) || parcels.length === 0) return "";
  return parcels.map((parcel) => {
    const tracking = String(parcel?.tracking_number || "");
    return `${parcel?.package_code || "Parcel"}: ${parcel?.carrier || ""} ${parcel?.service || ""}${tracking ? ` (${tracking})` : ""}`.trim();
  }).join(" | ");
}

function getShipmentLabelLinks_(shipment) {
  const parcels = Array.isArray(shipment?.parcels) ? shipment.parcels : [];
  const links = parcels.map((parcel) =>
    String(parcel?.label_pdf_url || parcel?.label_url || "").trim()
  ).filter(Boolean);
  const fallback = String(shipment?.label_url || "").trim();
  if (links.length === 0 && fallback) links.push(fallback);
  return [...new Set(links)];
}

function formatShipmentLabelText_(shipment) {
  const links = getShipmentLabelLinks_(shipment);
  if (links.length === 1) return "Open prepaid label";
  if (links.length > 1) {
    return links.map((unused, index) => `Open label ${index + 1}`).join(" | ");
  }
  const labelError = String(shipment?.label_purchase_error || "");
  if (/financial test order/i.test(labelError)) return "Not applicable — test order";
  if (shipment?.status === "cancelled") return "No label — cancelled";
  if (shipment?.status === "purchasing_label") return "Purchasing label...";
  return labelError ? "Automatic retry pending" : "Label pending";
}

function buildShipmentLabelRichText_(shipment) {
  const links = getShipmentLabelLinks_(shipment);
  const text = formatShipmentLabelText_(shipment);
  const builder = SpreadsheetApp.newRichTextValue().setText(text);
  if (links.length === 1) {
    builder.setLinkUrl(0, text.length, links[0]);
  } else if (links.length > 1) {
    let offset = 0;
    links.forEach((url, index) => {
      const label = `Open label ${index + 1}`;
      builder.setLinkUrl(offset, offset + label.length, url);
      offset += label.length + 3;
    });
  }
  return builder.build();
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
  toastIfAvailable_(
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

function ensureFinancialDistributionsSheet_() {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName(CONFIG.FINANCIAL_DISTRIBUTIONS_SHEET_NAME);

  if (!sheet) {
    sheet = book.insertSheet(CONFIG.FINANCIAL_DISTRIBUTIONS_SHEET_NAME);
  }

  return sheet;
}

function sendQueuedPreorderReadyEmails() {
  const settings = getSettings_();
  const response = postJson_(
    `${settings.apiBaseUrl}/api/admin/preorder-ready-emails`,
    settings,
    {}
  );

  if (!response?.ok) {
    const firstError = Array.isArray(response?.errors) ? response.errors[0]?.error : "";
    throw new Error(
      `Preorder-ready email delivery failed: ${response?.error || firstError || response?.message || response?.raw || "unknown error"}`
    );
  }

  Logger.log(
    "Sent %s consolidated preorder-ready email(s).",
    Number(response?.sentCount || 0)
  );
}

function ensurePunitMonthlyPayoutsSheet_() {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName(CONFIG.PUNIT_MONTHLY_PAYOUTS_SHEET_NAME);

  if (!sheet) {
    sheet = book.insertSheet(CONFIG.PUNIT_MONTHLY_PAYOUTS_SHEET_NAME);
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

function ensureHealthSheet_() {
  const book = SpreadsheetApp.getActive();
  let sheet = book.getSheetByName(CONFIG.HEALTH_SHEET_NAME);

  if (!sheet) {
    sheet = book.insertSheet(CONFIG.HEALTH_SHEET_NAME);
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

function sanitizeSheetText_(value) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function sanitizeSheetRows_(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) =>
    (Array.isArray(row) ? row : []).map((value) =>
      typeof value === "string" ? sanitizeSheetText_(value) : value
    )
  );
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
  const adminJwtSecret = props.getProperty("ADMIN_JWT_SECRET");
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
      "Missing API_BASE_URL or ADMIN_JWT_SECRET script properties."
    );
  }
  if (Utilities.newBlob(adminJwtSecret).getBytes().length < 32) {
    throw new Error(
      "ADMIN_JWT_SECRET must contain at least 32 bytes from a cryptographically random source."
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
      `GET ${url} failed (404): Route not found on the deployed site. Redeploy ${settings.apiBaseUrl} with the latest code.`
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

function removeLegacyDoNotMarketSheet_() {
  const book = SpreadsheetApp.getActive();
  const sheet = book.getSheetByName("Do Not Market");

  if (sheet && book.getSheets().length > 1) {
    book.deleteSheet(sheet);
  }
}

function deleteJson_(url, settings, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: "delete",
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

function putJson_(url, settings, payload) {
  const response = UrlFetchApp.fetch(url, {
    method: "put",
    contentType: "application/json",
    headers: buildAdminAuthHeaders_(settings),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  return parseJsonResponse_(response);
}
