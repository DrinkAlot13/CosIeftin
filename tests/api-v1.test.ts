// The /api/v1 contract, offline. `probe:api` checks the live responses; these check the rules
// that produce them, on inputs a live catalog may not happen to contain today.
//
// The three cases worth the most are the ones a client cannot recover from:
//   · a withheld row reaching a caller
//   · a single-shop product rendered as though it were a comparison
//   · a price with no observation date, so "acum" and "acum șase zile" look identical
import { describe, it, expect } from "./run";
import { comparisonOf, publishableOffers, serializeOffer, summaryOf, type OfferLike } from "../src/lib/api/serialize";
import { readParams, toOpenApiParams } from "../src/lib/api/schema";
import { SEARCH_PARAMS, LOOKUP_PARAMS, ROUTES } from "../src/lib/api/routes";
import { normalizeProductUrl } from "../src/lib/api/queries";
import { LIMITS } from "../src/lib/rate-limit";

const HOUR = 3_600_000;

const offer = (o: Partial<OfferLike> = {}): OfferLike => ({
  id: 1, price: 8.99, priceBani: 899, pricePerUnit: 8.99, pricePerUnitBani: 899,
  availability: "in stock", isStale: false, flagged: false, priceSource: "SHELF",
  productUrl: "https://shop.example/p/1", url: "https://shop.example/p/1",
  lastObservedAt: new Date(Date.now() - 3 * HOUR),
  requiresLoyaltyCard: false, loyaltyPriceBani: null,
  merchant: { slug: "auchan", name: "Auchan", storeType: "hybrid" },
  ...o,
});

describe("api/v1 — every price says when it was checked", () => {
  it("carries observedAt and a computed age", () => {
    const s = serializeOffer(offer());
    expect(s.observedAt !== null).toBe(true);
    expect(s.observedAgeHours! >= 2.9 && s.observedAgeHours! <= 3.1).toBe(true);
  });

  // NULL, never 0. A zero age reads as "just now" and is this project's most repeated defect —
  // a value never observed, read as an observation.
  it("reports a missing date as null rather than as zero hours old", () => {
    const s = serializeOffer(offer({ lastObservedAt: null }));
    expect(s.observedAt).toBe(null);
    expect(s.observedAgeHours).toBe(null);
  });

  it("a six-day-old price is visibly six days old", () => {
    const s = serializeOffer(offer({ lastObservedAt: new Date(Date.now() - 6 * 24 * HOUR) }));
    expect(s.observedAgeHours! > 143).toBe(true);
  });
});

describe("api/v1 — withheld rows never leave the building", () => {
  it("drops a flagged offer whatever the caller asked for", () => {
    const kept = publishableOffers([offer(), offer({ id: 2, flagged: true })], true);
    expect(kept.length).toBe(1);
    expect(kept[0].id).toBe(1);
  });

  // Delivery-platform rows are DIFFERENT: real prices with a measured +11.5% median markup.
  // Excluded by default, returnable on request — and flagged either way.
  it("excludes delivery-platform offers by default and returns them on request", () => {
    const rows = [offer(), offer({ id: 2, priceSource: "DELIVERY_PLATFORM" })];
    expect(publishableOffers(rows, false).length).toBe(1);
    expect(publishableOffers(rows, true).length).toBe(2);
    expect(serializeOffer(rows[1]).isDeliveryPlatform).toBe(true);
  });
});

describe("api/v1 — 'no comparison' is an answer, not an empty array", () => {
  it("one shop is single-shop, with copy a client can print", () => {
    const c = comparisonOf([{ merchant: { slug: "auchan" } }]);
    expect(c.status).toBe("single-shop");
    expect(c.shopCount).toBe(1);
    expect(c.reason.length > 10).toBe(true);
  });

  it("no shops is no-price, which is not the same as not existing", () => {
    expect(comparisonOf([]).status).toBe("no-price");
  });

  it("two shops is comparable", () => {
    expect(comparisonOf([{ merchant: { slug: "a" } }, { merchant: { slug: "b" } }]).status).toBe("comparable");
  });

  // Two offers from ONE merchant are not a comparison, however many rows there are.
  it("counts shops, not offers", () => {
    const c = comparisonOf([{ merchant: { slug: "auchan" } }, { merchant: { slug: "auchan" } }]);
    expect(c.status).toBe("single-shop");
    expect(c.shopCount).toBe(1);
  });
});

describe("api/v1 — a deep link is real or an explicit absence", () => {
  it("names the reason when a merchant publishes no product page", () => {
    // Kaufland's flyer genuinely has none — declared in lib/source-capabilities.
    const s = serializeOffer(offer({ productUrl: null, merchant: { slug: "kaufland", name: "Kaufland" } }));
    expect(s.productUrl).toBe(null);
    expect(s.productUrlAbsent).toBe("merchant-publishes-none");
  });

  // A merchant that DOES publish links, missing one, is our bug — and says so rather than
  // borrowing the other merchant's excuse.
  it("says 'unknown' when a link-publishing merchant is missing one", () => {
    const s = serializeOffer(offer({ productUrl: null, merchant: { slug: "auchan", name: "Auchan" } }));
    expect(s.productUrlAbsent).toBe("unknown");
  });
});

describe("api/v1 — parameters", () => {
  it("requires q and names the field it is missing", () => {
    const r = readParams(SEARCH_PARAMS, () => null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe("q");
  });

  // An over-large limit is a client asking for more than we serve, not a malformed request.
  it("clamps an over-large limit instead of refusing it", () => {
    const r = readParams<{ limit: number }>(SEARCH_PARAMS, (n) => (n === "q" ? "lapte" : n === "limit" ? "9999" : null));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.limit).toBe(50);
  });

  it("still refuses a limit that is not a number", () => {
    const r = readParams(SEARCH_PARAMS, (n) => (n === "q" ? "lapte" : n === "limit" ? "abc" : null));
    expect(r.ok).toBe(false);
  });

  it("applies defaults without being asked", () => {
    const r = readParams<{ section: string; limit: number }>(SEARCH_PARAMS, (n) => (n === "q" ? "x" : null));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.section).toBe("grocery"); expect(r.value.limit).toBe(20); }
  });

  it("rejects a section outside the enum", () => {
    const r = readParams(SEARCH_PARAMS, (n) => (n === "q" ? "x" : n === "section" ? "electronice" : null));
    expect(r.ok).toBe(false);
  });
});

describe("api/v1 — URL normalisation is narrow, not fuzzy", () => {
  it("strips scheme, www and a trailing slash", () => {
    expect(normalizeProductUrl("https://www.shop.ro/p/1/")).toBe("shop.ro/p/1");
    expect(normalizeProductUrl("http://shop.ro/p/1")).toBe("shop.ro/p/1");
  });

  it("strips tracking parameters a shopper's URL picks up", () => {
    expect(normalizeProductUrl("https://shop.ro/p/1?utm_source=x&gclid=y")).toBe("shop.ro/p/1");
    expect(normalizeProductUrl("https://www.penny.ro/products/lamai-rr100218?from=plp")).toBe("penny.ro/products/lamai-rr100218");
  });

  // It must NOT collapse things that identify different products.
  it("keeps a query parameter that is part of the identity", () => {
    expect(normalizeProductUrl("https://shop.ro/p?id=7")).toBe("shop.ro/p?id=7");
  });

  it("refuses a non-http scheme rather than normalising it", () => {
    expect(normalizeProductUrl("javascript:alert(1)")).toBe(null);
    expect(normalizeProductUrl("not a url")).toBe(null);
  });
});

describe("api/v1 — the registry is the single source for the document", () => {
  it("every route names a limit that exists in LIMITS", () => {
    for (const r of ROUTES) expect(r.limit in LIMITS).toBe(true);
  });

  it("every declared parameter has a description the document can print", () => {
    for (const r of ROUTES) {
      for (const [name, spec] of Object.entries(r.params)) {
        expect(spec.describe.length > 10).toBe(true);
        void name;
      }
    }
  });

  it("emits OpenAPI parameters from the same objects the routes validate with", () => {
    const params = toOpenApiParams(LOOKUP_PARAMS) as { name: string; required: boolean }[];
    expect(params.some((p) => p.name === "url")).toBe(true);
    // `url` is the PRIMARY key but not required on its own — merchant+sku and name are the
    // alternatives, and the route checks that one of the three arrived.
    expect(params.find((p) => p.name === "url")!.required).toBe(false);
  });
});

describe("api/v1 — summary", () => {
  it("prefers in-stock rows for the headline price", () => {
    const s = summaryOf([
      serializeOffer(offer({ priceBani: 500, availability: "out of stock" })),
      serializeOffer(offer({ id: 2, priceBani: 900 })),
    ]);
    expect(s.lowestBani).toBe(900);
  });

  it("falls back to every row when nothing is in stock", () => {
    const s = summaryOf([serializeOffer(offer({ priceBani: 500, availability: "out of stock" }))]);
    expect(s.lowestBani).toBe(500);
  });

  it("has no opinion about an empty list", () => {
    expect(summaryOf([]).lowestBani).toBe(null);
  });
});
