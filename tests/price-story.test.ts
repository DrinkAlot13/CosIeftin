// The price story is a claim made to a shopper about whether a price is good. Every branch here
// is a sentence that would appear on a page, so every branch is pinned.
import { describe, it, expect } from "./run";
import {
  priceStory, spanLabelRo, aboveLowLabelRo, observedDaysOf,
  MIN_DAYS_FOR_A_CLAIM, MIN_POINTS_FOR_A_TREND,
} from "../src/lib/price-story";

const NOW = new Date("2026-09-10T12:00:00Z");
const daysAgo = (n: number) => new Date(+NOW - n * 86_400_000);

describe("price story — refuses to speak without evidence", () => {
  it("says nothing when there is no current price", () => {
    expect(priceStory(null, [{ priceBani: 500, at: daysAgo(30) }], NOW).kind).toBe("no-price");
    expect(priceStory(0, [{ priceBani: 500, at: daysAgo(30) }], NOW).kind).toBe("no-price");
  });

  it("says TOO NEW under 14 days, however many observations", () => {
    const s = priceStory(500, [
      { priceBani: 520, at: daysAgo(10) },
      { priceBani: 500, at: daysAgo(3) },
    ], NOW);
    expect(s.kind).toBe("too-new");
  });

  // THE RULE THAT MATTERS MOST. History is change-only, so one row is not "no data".
  it("one observation over 14 days means the price has NOT MOVED, not that we know nothing", () => {
    const s = priceStory(500, [{ priceBani: 500, at: daysAgo(35) }], NOW);
    expect(s.kind).toBe("unchanged");
    if (s.kind === "unchanged") expect(s.observedDays).toBe(35);
  });

  it("one observation UNDER 14 days is still too new", () => {
    expect(priceStory(500, [{ priceBani: 500, at: daysAgo(5) }], NOW).kind).toBe("too-new");
  });

  it("ignores junk observations rather than letting them set a low", () => {
    const s = priceStory(500, [
      { priceBani: 0, at: daysAgo(30) },
      { priceBani: -5, at: daysAgo(29) },
      { priceBani: 600, at: daysAgo(28) },
      { priceBani: 500, at: daysAgo(2) },
    ], NOW);
    expect(s.kind).toBe("story");
    if (s.kind === "story") expect(s.lowBani).toBe(500);
  });
});

describe("price story — the numbers", () => {
  const obs = [
    { priceBani: 700, at: daysAgo(30) },
    { priceBani: 600, at: daysAgo(20) },
    { priceBani: 650, at: daysAgo(5) },
  ];

  it("finds the observed low and high with their dates", () => {
    const s = priceStory(650, obs, NOW);
    expect(s.kind).toBe("story");
    if (s.kind !== "story") return;
    expect(s.lowBani).toBe(600);
    expect(s.highBani).toBe(700);
    expect(s.lowAt.toISOString().slice(0, 10)).toBe(daysAgo(20).toISOString().slice(0, 10));
  });

  it("states how far above the low the CURRENT price is", () => {
    const s = priceStory(650, obs, NOW);
    if (s.kind !== "story") throw new Error("expected a story");
    // 650 vs a 600 low is 8.33%
    expect(Math.round(s.pctAboveLow * 100)).toBe(8);
    expect(s.atLow).toBe(false);
  });

  // The current price comes from the OFFER, not from the last history row: history records what
  // the price was when it last CHANGED.
  it("uses the passed current price, not the newest observation", () => {
    const s = priceStory(590, obs, NOW);
    if (s.kind !== "story") throw new Error("expected a story");
    expect(s.currentBani).toBe(590);
    expect(s.atLow).toBe(true); // below the observed low
  });
});

describe("price story — 'un moment bun' is narrow on purpose", () => {
  it("fires when at the low, with movement, over a long enough span", () => {
    const s = priceStory(600, [
      { priceBani: 700, at: daysAgo(30) },
      { priceBani: 650, at: daysAgo(20) },
      { priceBani: 600, at: daysAgo(4) },
    ], NOW);
    if (s.kind !== "story") throw new Error("expected a story");
    expect(s.goodTime).toBe(true);
  });

  // Otherwise every never-changed product would carry the badge, which makes it meaningless.
  it("does NOT fire when the price never moved", () => {
    const s = priceStory(600, [
      { priceBani: 600, at: daysAgo(30) },
      { priceBani: 600, at: daysAgo(10) },
      { priceBani: 600, at: daysAgo(2) },
    ], NOW);
    if (s.kind !== "story") throw new Error("expected a story");
    expect(s.atLow).toBe(true);
    expect(s.goodTime).toBe(false); // high === low, so there is no "good" to be at
  });

  it("does NOT fire on two observations", () => {
    const s = priceStory(600, [
      { priceBani: 700, at: daysAgo(30) },
      { priceBani: 600, at: daysAgo(2) },
    ], NOW);
    if (s.kind !== "story") throw new Error("expected a story");
    expect(s.points < MIN_POINTS_FOR_A_TREND).toBe(true);
    expect(s.goodTime).toBe(false);
  });

  it("does NOT fire when the price is above the low", () => {
    const s = priceStory(690, [
      { priceBani: 700, at: daysAgo(30) },
      { priceBani: 600, at: daysAgo(20) },
      { priceBani: 690, at: daysAgo(2) },
    ], NOW);
    if (s.kind !== "story") throw new Error("expected a story");
    expect(s.goodTime).toBe(false);
  });
});

describe("price story — the window is measured, never named", () => {
  it("reports the span actually observed", () => {
    expect(observedDaysOf([{ priceBani: 1, at: daysAgo(35) }], NOW)).toBe(35);
    expect(observedDaysOf([], NOW)).toBe(0);
  });

  // The whole point: we hold 35 days, so no label may claim 30 or 90 days.
  it("labels weeks once past 14 days, days below it", () => {
    expect(spanLabelRo(1)).toBe("de o zi");
    expect(spanLabelRo(9)).toBe("de 9 zile");
    expect(spanLabelRo(35)).toBe("de 5 săptămâni");
    expect(spanLabelRo(7 * 1 + 7)).toBe("de 2 săptămâni");
  });

  it("never emits the strings '30 de zile' or '90 de zile'", () => {
    for (const d of [1, 5, 13, 14, 21, 35, 60, 89, 90]) {
      const l = spanLabelRo(d);
      expect(l.includes("90 de zile")).toBe(false);
      expect(l.includes("30 de zile")).toBe(false);
    }
  });

  it("phrases the gap to the low, and says so plainly at the low", () => {
    expect(aboveLowLabelRo(0)).toBe("cel mai mic preț observat");
    expect(aboveLowLabelRo(-0.01)).toBe("cel mai mic preț observat");
    expect(aboveLowLabelRo(0.12)).toBe("cu 12% peste minimul observat");
  });

  it("MIN_DAYS_FOR_A_CLAIM is 14 — a fortnight, not a nominal month", () => {
    expect(MIN_DAYS_FOR_A_CLAIM).toBe(14);
  });
});
