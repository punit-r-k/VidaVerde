import assert from "node:assert/strict";
import test from "node:test";

import {
  getAssignedPickupDateKey,
  getPickupDetails,
  getPrepSheetWeekInfo
} from "../lib/pickupDetails.js";

const timezone = "America/Chicago";

const getPickupDate = (iso) =>
  getPickupDetails({
    timeZone: timezone,
    now: new Date(iso)
  }).market_date;

test("pickup date rolls at Friday noon Central", () => {
  assert.equal(getPickupDate("2026-04-24T16:59:00Z"), "2026-04-25");
  assert.equal(getPickupDate("2026-04-24T17:00:00Z"), "2026-05-02");
});

test("Saturday orders are scheduled for the following Saturday", () => {
  assert.equal(getPickupDate("2026-04-25T14:00:00Z"), "2026-05-02");
  assert.equal(getPickupDate("2026-04-25T17:00:00Z"), "2026-05-02");
});

test("prep sheet keeps current pickup visible until Saturday 2pm Central", () => {
  const beforeRoll = getPrepSheetWeekInfo(timezone, new Date("2026-04-25T18:59:00Z"));
  assert.equal(beforeRoll.market_date, "2026-04-25");
  assert.equal(beforeRoll.collection_start_label, "Fri, Apr 17, 12:00pm");
  assert.equal(beforeRoll.collection_end_label, "Fri, Apr 24, 11:59am");

  const atRoll = getPrepSheetWeekInfo(timezone, new Date("2026-04-25T19:00:00Z"));
  assert.equal(atRoll.market_date, "2026-05-02");
  assert.equal(atRoll.collection_start_label, "Fri, Apr 24, 12:00pm");
  assert.equal(atRoll.collection_end_label, "Fri, May 1, 11:59am");
});

test("Friday noon cutoff handles spring DST offset", () => {
  assert.equal(getPickupDate("2026-03-13T16:59:00Z"), "2026-03-14");
  assert.equal(getPickupDate("2026-03-13T17:00:00Z"), "2026-03-21");
});

test("Friday noon cutoff handles fall DST offset", () => {
  assert.equal(getPickupDate("2026-11-06T17:59:00Z"), "2026-11-07");
  assert.equal(getPickupDate("2026-11-06T18:00:00Z"), "2026-11-14");
});

test("assigned pickup date keys are only returned for market orders", () => {
  assert.equal(
    getAssignedPickupDateKey({
      fulfillment: "market",
      placedAt: "2026-04-24T16:59:00Z",
      timeZone: timezone
    }),
    "2026-04-25"
  );
  assert.equal(
    getAssignedPickupDateKey({
      fulfillment: "market",
      placedAt: "2026-04-24T17:00:00Z",
      timeZone: timezone
    }),
    "2026-05-02"
  );
  assert.equal(
    getAssignedPickupDateKey({
      fulfillment: "ship",
      placedAt: "2026-04-24T16:59:00Z",
      timeZone: timezone
    }),
    ""
  );
});

