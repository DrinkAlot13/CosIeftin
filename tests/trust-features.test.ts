// Discount verification and shrinkflation detection.
//
// Both features make claims about a retailer's pricing, so every test here is written from
// the same stance: a false accusation is worse than a missed one. Where evidence is thin,
// the expected answer is "we don't know", not a verdict.
import { describe, it, expect } from "./run";
import { verifyDiscount, ourMinimum, verdictLabel } from "../src/lib/discount-verify";
import { detectShrinkflation, type PackObservation } from "../src/lib/shrinkflation";

const day = (n: number) => new Date(Date.now() - n * 864e5);

describe("discount verification — verdicts", () => {
  it("REDUCERE_REALA when the price is below the 30-day minimum", () => {
    const e = verifyDiscount({ currentBani: 900, advertisedWasBani: 1500, omnibus30dBani: 1100 });
    expect(e.verdict).toBe("REDUCERE_REALA");
    expect(e.realSavingBani).toBe(200);
  });

  // The headline case: a struck price that only returns to where it recently was.
  it("REDUCERE_MICA when the 'discount' does not beat the 30-day minimum", () => {
    const e = verifyDiscount({ currentBani: 1100, advertisedWasBani: 1500, omnibus30dBani: 1100 });
    expect(e.verdict).toBe("REDUCERE_MICA");
    expect(e.realSavingBani).toBe(0);
    expect(e.advertisedSavingBani).toBe(400); // what the sticker implies
  });

  it("FARA_REDUCERE when the price is at or above its recent floor and nothing is struck", () => {
    const e = verifyDiscount({ currentBani: 1200, omnibus30dBani: 1100 });
    expect(e.verdict).toBe("FARA_REDUCERE");
  });

  it("NECUNOSCUT with no Omnibus figure and no usable history — never a guess", () => {
    const e = verifyDiscount({ currentBani: 1000, advertisedWasBani: 1500 });
    expect(e.verdict).toBe("NECUNOSCUT");
  });

  it("NECUNOSCUT when our own history is too thin to stand in", () => {
    const e = verifyDiscount({
      currentBani: 900, advertisedWasBani: 1500,
      history: [{ priceBani: 1100, recordedAt: day(5) }, { priceBani: 1100, recordedAt: day(3) }],
    });
    expect(e.ourObservations).toBe(2);
    expect(e.verdict).toBe("NECUNOSCUT");
  });

  it("falls back to our own history once it is well-evidenced", () => {
    const e = verifyDiscount({
      currentBani: 900, advertisedWasBani: 1500,
      history: [
        { priceBani: 1100, recordedAt: day(20) }, { priceBani: 1150, recordedAt: day(12) },
        { priceBani: 1100, recordedAt: day(4) }, { priceBani: 1200, recordedAt: day(2) },
      ],
    });
    expect(e.verdict).toBe("REDUCERE_REALA");
    expect(e.ourMin30dBani).toBe(1100);
  });
});

describe("discount verification — cross-checking the retailer's own figure", () => {
  it("flags a material disagreement for review rather than publishing it", () => {
    const e = verifyDiscount({
      currentBani: 900, omnibus30dBani: 1400,
      history: [
        { priceBani: 1000, recordedAt: day(20) }, { priceBani: 1000, recordedAt: day(10) },
        { priceBani: 1000, recordedAt: day(3) },
      ],
    });
    expect(e.disagreesWithOurHistory).toBeTruthy();
    expect(e.needsReview).toBeTruthy();
  });

  it("does not flag agreement within tolerance", () => {
    const e = verifyDiscount({
      currentBani: 900, omnibus30dBani: 1000,
      history: [
        { priceBani: 1010, recordedAt: day(20) }, { priceBani: 1020, recordedAt: day(10) },
        { priceBani: 1010, recordedAt: day(3) },
      ],
    });
    expect(e.disagreesWithOurHistory).toBeFalsy();
  });

  it("ourMinimum ignores observations outside the window", () => {
    const r = ourMinimum([{ priceBani: 500, recordedAt: day(60) }, { priceBani: 900, recordedAt: day(5) }]);
    expect(r.minBani).toBe(900);
    expect(r.count).toBe(1);
  });

  it("copy is factual, not accusatory", () => {
    expect(verdictLabel("FARA_REDUCERE").label).toBe("Fără reducere față de ultimele 30 de zile");
  });
});

describe("shrinkflation — only on strong evidence", () => {
  const obs = (name: string, priceBani: number, daysAgo: number): PackObservation =>
    ({ name, priceBani, observedAt: day(daysAgo) });

  it("detects a smaller pack at a higher per-unit price, confirmed twice", () => {
    const f = detectShrinkflation([
      obs("Cafea Jacobs 500 g", 3000, 40),
      obs("Cafea Jacobs 450 g", 3000, 20),
      obs("Cafea Jacobs 450 g", 3000, 5),
    ])!;
    expect(f.oldPackSize).toBe(500);
    expect(f.newPackSize).toBe(450);
    expect(f.confirmations).toBe(2);
    expect(f.unitPriceRiseBp > 1000).toBeTruthy(); // ~11% more per kg
    expect(f.needsReview).toBeTruthy();
  });

  it("does NOT fire on a single unconfirmed observation", () => {
    expect(detectShrinkflation([
      obs("Cafea Jacobs 500 g", 3000, 40),
      obs("Cafea Jacobs 500 g", 3000, 20),
      obs("Cafea Jacobs 450 g", 3000, 5),
    ])).toBe(null);
  });

  it("does NOT fire when the price fell in proportion — that is just a smaller pack", () => {
    expect(detectShrinkflation([
      obs("Cafea Jacobs 500 g", 3000, 40),
      obs("Cafea Jacobs 450 g", 2700, 20),
      obs("Cafea Jacobs 450 g", 2700, 5),
    ])).toBe(null);
  });

  it("does NOT fire on a trivial size change", () => {
    expect(detectShrinkflation([
      obs("Cafea Jacobs 500 g", 3000, 40),
      obs("Cafea Jacobs 495 g", 3000, 20),
      obs("Cafea Jacobs 495 g", 3000, 5),
    ])).toBe(null);
  });

  // A g -> ml reparse is a bug in our own parser, not a retailer shrinking a pack.
  it("REFUSES to judge when the unit family changed (parse bug, not shrinkflation)", () => {
    expect(detectShrinkflation([
      obs("Sos 500 g", 1000, 40),
      obs("Sos 450 ml", 1000, 20),
      obs("Sos 450 ml", 1000, 5),
    ])).toBe(null);
  });

  it("does NOT fire when the pack grew", () => {
    expect(detectShrinkflation([
      obs("Cafea 450 g", 3000, 40),
      obs("Cafea 500 g", 3000, 20),
      obs("Cafea 500 g", 3000, 5),
    ])).toBe(null);
  });

  it("needs at least three observations", () => {
    expect(detectShrinkflation([obs("Cafea 500 g", 3000, 40), obs("Cafea 450 g", 3000, 5)])).toBe(null);
  });

  it("ignores products whose size cannot be parsed", () => {
    expect(detectShrinkflation([obs("Cafea", 3000, 40), obs("Cafea", 3000, 20), obs("Cafea", 3000, 5)])).toBe(null);
  });

  // The reason parseQuantity had to learn promo packs BEFORE this feature could ship.
  it("REFUSES to judge a promo pack ending — that is expiry, not shrinkflation", () => {
    // 8 pots for the price of 7, then back to the ordinary 6-pack. Pack down 25%, per-unit
    // price up: every numeric bar for shrinkflation is cleared, and it did not happen.
    const f = detectShrinkflation([
      obs("Iaurt natur Activia, (7+1) x 125 g", 1600, 40),
      obs("Iaurt natur Activia, (7+1) x 125 g", 1600, 30),
      obs("Iaurt natur Activia, 6 x 125 g", 1500, 12),
      obs("Iaurt natur Activia, 6 x 125 g", 1500, 4),
    ]);
    expect(f).toBe(null);
  });

  it("REFUSES when a promo pack STARTS mid-window too", () => {
    expect(detectShrinkflation([
      obs("Bere blonda Ciuc, 8 x 0.5 l", 4000, 40),
      obs("Bere blonda Ciuc, 5+1 x 0.5 l", 3600, 20),
      obs("Bere blonda Ciuc, 5+1 x 0.5 l", 3600, 5),
    ])).toBe(null);
  });

  it("still fires on a genuine shrink between two NON-promo packs", () => {
    const f = detectShrinkflation([
      obs("Ciocolata Milka 100 g", 800, 40),
      obs("Ciocolata Milka 85 g", 800, 20),
      obs("Ciocolata Milka 85 g", 800, 5),
    ]);
    expect(f).toBeTruthy();
    expect(f!.oldPackSize).toBe(100);
    expect(f!.newPackSize).toBe(85);
  });
});
