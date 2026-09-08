// INFERRED FAVOURITES COUNT DISTINCT DAYS, NOT CLICKS.
//
// `resolveLine` ranks an INFERRED favourite above everything except the heart, so promoting one
// is a real claim about what this shopper keeps buying. It used to read `count`, which the API
// increments on every add — so three clicks in three seconds, a double-submit, or a stuck
// button manufactured a preference out of a single decision.
//
// These tests are about the DAY BOUNDARY logic rather than the database: `utcDay` is the whole
// rule, and an off-by-one there either promotes on one day's clicks or never promotes at all.
//
// The per-caller add cap is tested here too, because it is the same shape of defect from the
// anonymous side: one visitor moving a public ranking on their own.

import { describe, it, expect } from "./run";
import { utcDay, INFERRED_AFTER_ADDS } from "../src/lib/favourites";
import {
  callerMayCount, MAX_ADDS_PER_CALLER_PER_PRODUCT, __resetCallerCountsForTest,
} from "../src/lib/list-adds";

describe("utcDay — the boundary the day counter turns on", () => {
  it("two times on the same UTC day are the same day", () => {
    expect(utcDay(new Date("2026-09-08T00:00:00.000Z"))).toBe("2026-09-08");
    expect(utcDay(new Date("2026-09-08T23:59:59.999Z"))).toBe("2026-09-08");
  });

  it("one millisecond later is the next day", () => {
    expect(utcDay(new Date("2026-09-09T00:00:00.000Z"))).toBe("2026-09-09");
  });

  it("is UTC, not local — so the boundary does not move with the server's timezone", () => {
    // 23:30 in Bucharest (UTC+3 in summer) is already the next day in UTC. Whichever answer
    // is 'right', it must be the SAME answer on every machine, which is the point of fixing it
    // to UTC rather than reading the host's clock settings.
    expect(utcDay(new Date("2026-09-08T21:30:00.000Z"))).toBe("2026-09-08");
    expect(utcDay(new Date("2026-09-08T22:30:00.000Z"))).toBe("2026-09-08");
  });

  it("the threshold is still three — the evidence changed, not the bar", () => {
    expect(INFERRED_AFTER_ADDS).toBe(3);
  });
});

describe("per-caller add cap — one visitor may not rank a product alone", () => {
  it("allows the cap and refuses beyond it", () => {
    __resetCallerCountsForTest();
    for (let i = 0; i < MAX_ADDS_PER_CALLER_PER_PRODUCT; i++) {
      expect(callerMayCount("1.2.3.4", 42)).toBe(true);
    }
    expect(callerMayCount("1.2.3.4", 42)).toBe(false);
  });

  it("is per PRODUCT, not per caller — a real shopper fills a whole basket", () => {
    __resetCallerCountsForTest();
    for (let i = 0; i < MAX_ADDS_PER_CALLER_PER_PRODUCT; i++) callerMayCount("1.2.3.4", 42);
    expect(callerMayCount("1.2.3.4", 42)).toBe(false);
    // A different product from the same shopper is unaffected.
    expect(callerMayCount("1.2.3.4", 43)).toBe(true);
  });

  it("is per CALLER — one exhausted visitor does not stop everyone else counting", () => {
    __resetCallerCountsForTest();
    for (let i = 0; i < MAX_ADDS_PER_CALLER_PER_PRODUCT; i++) callerMayCount("1.2.3.4", 42);
    expect(callerMayCount("1.2.3.4", 42)).toBe(false);
    expect(callerMayCount("5.6.7.8", 42)).toBe(true);
  });

  it("caps unidentifiable callers too, which is the deliberate cost of not seeing an IP", () => {
    __resetCallerCountsForTest();
    // Everyone we cannot identify shares one cap per product. That UNDERSTATES a ranking, which
    // is the safe direction: an uncapped one lets a single caller invent it.
    for (let i = 0; i < MAX_ADDS_PER_CALLER_PER_PRODUCT; i++) {
      expect(callerMayCount(null, 99)).toBe(true);
    }
    expect(callerMayCount(null, 99)).toBe(false);
  });
});
