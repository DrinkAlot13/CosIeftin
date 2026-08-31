// The census arithmetic must close, and "no reason found" must always be zero.
//
// This exists because a reported drop from ~32,000 to ~24,000 live offers could not be
// attributed. Several deliberate changes were supposed to reduce the number, and together they
// over-explained it — which is worse than either explanation alone, because a system that
// cannot account for its own missing rows will hide a genuine data loss inside a legitimate
// one. It did, exactly once: Carrefour's alcohol range collapsed from 1,196 live offers to 550
// and the drop-guard let it through by NINE offers.
//
// The property that makes the census trustworthy is boring and absolute: every offer lands in
// exactly one bucket, and the buckets sum to the total. If that ever stops holding, the census
// is lying and the number it prints means nothing.
import { describe, it, expect } from "./run";
import { classifyOffer, tally, BUCKETS, STALE_AFTER_DAYS, type CensusRow } from "../src/lib/offer-census";

const NOW = new Date("2026-08-31T12:00:00Z");
const ago = (days: number): Date => new Date(NOW.getTime() - days * 86_400_000);

const row = (over: Partial<CensusRow> = {}): CensusRow => ({
  merchantActive: true,
  merchantScrapedRecently: true,
  anomalies: 0,
  flagged: false,
  isExpired: false,
  promoValidTo: null,
  isStale: false,
  lastSeenAt: ago(0),
  lastSeen: ago(0),
  availability: "in stock",
  stockStatus: "IN_STOCK",
  vatBasis: "WITH_VAT",
  ...over,
});

describe("census — a healthy offer is live", () => {
  it("classifies a fresh in-stock offer from an active, scraped merchant as live", () => {
    expect(classifyOffer(row(), NOW)).toBe("live");
  });
});

describe("census — every non-live reason is recognised", () => {
  const cases: [string, Partial<CensusRow>, string][] = [
    ["inactive merchant", { merchantActive: false }, "merchant inactive"],
    ["merchant not scraped", { merchantScrapedRecently: false }, "merchant not scraped in last run"],
    ["unresolved anomaly", { anomalies: 1 }, "quarantined (unresolved PriceAnomaly)"],
    ["flagged", { flagged: true }, "flagged by a sanity gate"],
    ["expired flag", { isExpired: true }, "expired (past promoValidTo)"],
    ["promo window passed", { promoValidTo: ago(1) }, "expired (past promoValidTo)"],
    ["stale flag", { isStale: true }, "stale (not seen in a feed)"],
    ["stale by age", { lastSeenAt: ago(STALE_AFTER_DAYS + 1) }, "stale (not seen in a feed)"],
    ["out of stock", { availability: "out of stock" }, "out of stock"],
    ["stock status OOS", { stockStatus: "OUT_OF_STOCK" }, "out of stock"],
    ["VAT basis unknown", { vatBasis: "WITHOUT_VAT" }, "price basis unknown (WITHOUT_VAT)"],
  ];
  for (const [name, over, want] of cases) {
    it(name, () => expect(classifyOffer(row(over), NOW)).toBe(want));
  }

  it("NOTHING ever lands in 'no reason found' — every path is covered", () => {
    // Exhaustive-ish sweep over the fields that decide the outcome.
    const flags = [true, false];
    let noReason = 0;
    let n = 0;
    for (const merchantActive of flags)
      for (const merchantScrapedRecently of flags)
        for (const flagged of flags)
          for (const isExpired of flags)
            for (const isStale of flags)
              for (const availability of ["in stock", "out of stock"])
                for (const vatBasis of ["WITH_VAT", "WITHOUT_VAT"])
                  for (const anomalies of [0, 1]) {
                    n++;
                    const b = classifyOffer(
                      row({ merchantActive, merchantScrapedRecently, flagged, isExpired, isStale, availability, vatBasis, anomalies }),
                      NOW,
                    );
                    if (b === "no reason found") noReason++;
                  }
    expect(n).toBe(256);
    if (noReason > 0) throw new Error(`${noReason}/${n} combinations fell through to "no reason found"`);
    expect(noReason).toBe(0);
  });
});

describe("census — the arithmetic closes", () => {
  it("buckets sum to the total", () => {
    const rows = [
      row(), row(), row(),
      row({ isStale: true }), row({ isStale: true }),
      row({ availability: "out of stock" }),
      row({ flagged: true }),
      row({ anomalies: 2 }),
      row({ merchantActive: false }),
      row({ merchantScrapedRecently: false }),
    ];
    const { totals, total, closes } = tally(rows, NOW);
    expect(total).toBe(10);
    expect(closes).toBeTruthy();
    expect(Object.values(totals).reduce((a, b) => a + b, 0)).toBe(10);
    expect(totals["live"]).toBe(3);
    expect(totals["no reason found"]).toBe(0);
  });

  it("an empty database closes too", () => {
    const { total, closes } = tally([], NOW);
    expect(total).toBe(0);
    expect(closes).toBeTruthy();
  });

  it("every declared bucket is reachable except 'no reason found'", () => {
    const reachable = new Set<string>();
    for (const over of [
      {}, { merchantActive: false }, { merchantScrapedRecently: false }, { anomalies: 1 },
      { flagged: true }, { isExpired: true }, { isStale: true },
      { availability: "out of stock" }, { vatBasis: "WITHOUT_VAT" },
    ] as Partial<CensusRow>[]) {
      reachable.add(classifyOffer(row(over), NOW));
    }
    const unreachable = BUCKETS.filter((b) => b !== "no reason found" && !reachable.has(b));
    if (unreachable.length) throw new Error(`bucket(s) no input can reach: ${unreachable.join(", ")}`);
    expect(unreachable.length).toBe(0);
  });
});

describe("census — precedence is deliberate, not accidental", () => {
  it("a merchant we never scraped is not blamed for being out of stock", () => {
    expect(classifyOffer(row({ merchantScrapedRecently: false, availability: "out of stock" }), NOW))
      .toBe("merchant not scraped in last run");
  });

  it("stale beats out of stock — we stopped seeing it, which is the bigger fact", () => {
    expect(classifyOffer(row({ isStale: true, availability: "out of stock" }), NOW))
      .toBe("stale (not seen in a feed)");
  });

  it("a quarantined price outranks every availability signal", () => {
    expect(classifyOffer(row({ anomalies: 1, isStale: true, availability: "out of stock" }), NOW))
      .toBe("quarantined (unresolved PriceAnomaly)");
  });
});
