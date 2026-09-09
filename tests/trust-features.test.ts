// Discount verification and shrinkflation detection.
//
// Both features make claims about a retailer's pricing, so every test here is written from
// the same stance: a false accusation is worse than a missed one. Where evidence is thin,
// the expected answer is "we don't know", not a verdict.
import { describe, it, expect } from "./run";
import { verifyDiscount, priorMinimum, verdictLabel } from "../src/lib/discount-verify";
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

  it("copy is factual, not accusatory", () => {
    expect(verdictLabel("FARA_REDUCERE").label).toBe("Fără reducere față de ultimele 30 de zile");
  });

  // The label may not claim thirty days of evidence when the baseline is our own shorter history.
  it("names the window we actually have, not the legal one", () => {
    expect(verdictLabel("FARA_REDUCERE", 18).label).toBe("Fără reducere față de ultimele 18 de zile");
  });
});

// ── PriceHistory APPENDS ON CHANGE ONLY, and the first version of this module read it as if
// it were a nightly sample. These four cases are the three defects that produced, each with the
// wrong answer the naive filter gave.
describe("discount verification — reading an append-on-change series", () => {
  // THIS CASE PREVIOUSLY ASSERTED THE BUG. It expected 900 — "observations outside the window
  // are ignored" — but 5,00 was the price IN FORCE from day 60 until day 5, which is most of
  // the window. The true floor is 500 and the price went UP, which the old reading could not
  // see at all. A fixture can encode a defect as confidently as code can.
  it("carries the price INTO the window instead of dropping it", () => {
    const r = priorMinimum([{ priceBani: 500, recordedAt: day(60) }, { priceBani: 900, recordedAt: day(5) }], 900);
    expect(r.minBani).toBe(500);
    expect(r.carriedIn).toBeTruthy();
    expect(r.count).toBe(0); // no points INSIDE the window — and that is not the same as no evidence
  });

  // The dangerous direction: a genuine cut classified as "the price only came back to normal".
  it("excludes the current price's own run, so a real cut is visible", () => {
    const e = verifyDiscount({
      currentBani: 900, advertisedWasBani: 1100,
      history: [
        { priceBani: 1100, recordedAt: day(25) }, { priceBani: 1100, recordedAt: day(18) },
        { priceBani: 900, recordedAt: day(1) },
      ],
    });
    expect(e.ourMin30dBani).toBe(1100);
    expect(e.verdict).toBe("REDUCERE_REALA");
    expect(e.realSavingBani).toBe(200);
  });

  // A steady price is perfectly known, and used to report zero observations.
  it("treats a long-unchanged price as evidence, not as silence", () => {
    const e = verifyDiscount({ currentBani: 1000, history: [{ priceBani: 1000, recordedAt: day(45) }] });
    expect(e.coverageDays).toBe(30); // capped at the window
    expect(e.ourMin30dBani).toBe(1000);
    expect(e.verdict).toBe("FARA_REDUCERE");
  });

  // Confidence is TIME WATCHED, not rows recorded. A price that thrashed four times in three
  // days is not better evidence about a 30-day floor than one watched for three weeks.
  it("gates on days watched, not on how often the price moved", () => {
    const thrashy = verifyDiscount({
      currentBani: 800, advertisedWasBani: 1200,
      history: [
        { priceBani: 1000, recordedAt: day(3) }, { priceBani: 900, recordedAt: day(2) },
        { priceBani: 1000, recordedAt: day(2) }, { priceBani: 950, recordedAt: day(1) },
      ],
    });
    expect(thrashy.ourObservations).toBe(4);
    expect(thrashy.verdict).toBe("NECUNOSCUT");
    expect(thrashy.baselineSource).toBe("NONE");
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
