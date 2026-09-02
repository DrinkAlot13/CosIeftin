// Delivery-platform prices: written correctly, and hidden by default.
//
// The bug these exist for was silent and serious. `matchPoolToCatalog` resolved the price source
// with `toPriceSource(sp.priceSource ?? merchant.priceChannel)` — but `toPriceSource` translates
// the MERCHANT vocabulary, and handed the OFFER value "DELIVERY_PLATFORM" it matched no case and
// returned SHELF from its default branch. All 2,217 Glovo offers were written as SHELF prices, so
// every exclusion keyed on DELIVERY_PLATFORM passed them straight through and a marked-up
// platform price was competing in "cel mai mic preț" against real shelf prices — the exact thing
// CLAUDE.md's ninth invariant forbids.
//
// It is the same class of mistake lib/price-source was created to end: a value copied across a
// vocabulary boundary because two fields share a name.

import { describe, it, expect } from "./run";
import { isPriceSource, toPriceSource, PRICE_SOURCES } from "../src/lib/price-source";
import {
  deliveryPlatformEnabledByEnv, deliveryPlatformWhere, isDeliveryPlatform,
  showDeliveryPlatform, DELIVERY_PLATFORM, DELIVERY_PLATFORM_LABEL,
} from "../src/lib/platform/visibility";
import { STOREFRONTS, enabledStorefronts, storeUrl, storefrontByKey } from "../src/lib/platform/config";
import { isCurrent } from "../src/lib/pricing";

describe("price-source vocabularies do not leak into each other", () => {
  it("the MERCHANT translator has no case for an OFFER value", () => {
    // This is the trap, asserted so nobody 'fixes' it by adding a case and hiding the boundary.
    expect(toPriceSource("DELIVERY_PLATFORM")).toBe("SHELF");
    expect(toPriceSource("aggregator")).toBe("DELIVERY_PLATFORM");
  });

  it("an OFFER value is recognisable as one", () => {
    expect(isPriceSource("DELIVERY_PLATFORM")).toBeTruthy();
    expect(isPriceSource("aggregator")).toBeFalsy();
    expect(isPriceSource("shelf")).toBeFalsy();
  });

  it("the vocabulary still contains the value every exclusion keys on", () => {
    expect((PRICE_SOURCES as readonly string[]).includes(DELIVERY_PLATFORM)).toBeTruthy();
  });
});

describe("delivery-platform prices are hidden by default", () => {
  const platformOffer = {
    availability: "in stock", isStale: false, flagged: false,
    lastObservedAt: new Date(), priceSource: "DELIVERY_PLATFORM",
  };
  const shelfOffer = { ...platformOffer, priceSource: "SHELF" };

  it("isCurrent refuses a platform price unless explicitly enabled", () => {
    expect(isCurrent(platformOffer as never)).toBeFalsy();
    expect(isCurrent(platformOffer as never, new Date(), true)).toBeTruthy();
    expect(isCurrent(shelfOffer as never)).toBeTruthy();
  });

  it("the query filter excludes them by default and admits them when shown", () => {
    expect(JSON.stringify(deliveryPlatformWhere(false))).toContain("DELIVERY_PLATFORM");
    expect(JSON.stringify(deliveryPlatformWhere(true))).toBe("{}");
  });

  it("the filter is a NOT, so a future fifth price source stays visible", () => {
    // Expressed as an exclusion rather than an allow-list on purpose: an allow-list silently
    // hides anything added later, which is how five spellings of this column coexisted unseen.
    const w = JSON.stringify(deliveryPlatformWhere(false));
    expect(w.includes("NOT")).toBeTruthy();
    expect(w.includes("SHELF")).toBeFalsy();
  });

  it("the environment default is OFF", () => {
    expect(deliveryPlatformEnabledByEnv({} as NodeJS.ProcessEnv)).toBeFalsy();
    expect(deliveryPlatformEnabledByEnv({ SHOW_DELIVERY_PLATFORM: "0" } as never)).toBeFalsy();
    expect(deliveryPlatformEnabledByEnv({ SHOW_DELIVERY_PLATFORM: "1" } as never)).toBeTruthy();
  });

  it("a per-request ?dp=1 opts one page in and nothing else", () => {
    expect(showDeliveryPlatform(null)).toBeFalsy();
    expect(showDeliveryPlatform({ dp: "1" })).toBeTruthy();
    expect(showDeliveryPlatform({ dp: "0" })).toBeFalsy();
    expect(showDeliveryPlatform(new URLSearchParams("dp=1"))).toBeTruthy();
    expect(showDeliveryPlatform(new URLSearchParams(""))).toBeFalsy();
  });

  it("recognises a platform offer for labelling", () => {
    expect(isDeliveryPlatform({ priceSource: "DELIVERY_PLATFORM" })).toBeTruthy();
    expect(isDeliveryPlatform({ priceSource: "SHELF" })).toBeFalsy();
    expect(isDeliveryPlatform({})).toBeFalsy();
  });

  it("the required Romanian label names the platform and the markup", () => {
    expect(DELIVERY_PLATFORM_LABEL).toContain("Glovo");
    expect(DELIVERY_PLATFORM_LABEL).toContain("adaosul platformei");
  });
});

describe("storefronts are config rows", () => {
  it("only Kaufland is enabled — the brief asked for one store", () => {
    expect(enabledStorefronts().length).toBe(1);
    expect(enabledStorefronts()[0].storeSlug).toBe("kaufland-buc");
  });

  it("all six discovered storefronts are recorded", () => {
    expect(STOREFRONTS.length).toBe(6);
  });

  it("keys and merchant slugs are unique", () => {
    expect(new Set(STOREFRONTS.map((s) => s.key)).size).toBe(STOREFRONTS.length);
    expect(new Set(STOREFRONTS.map((s) => s.merchantSlug)).size).toBe(STOREFRONTS.length);
  });

  it("the city slug is bucharest, not bucuresti", () => {
    // Glovo's own supermarket-category page links /bucuresti/ URLs that 302 into a soft 404.
    // The live path uses the English city slug; trusting the site's own links cost a recon pass.
    for (const s of STOREFRONTS) expect(s.city).toBe("bucharest");
    expect(storeUrl(STOREFRONTS[0])).toBe("https://glovoapp.com/ro/ro/bucharest/stores/kaufland-buc");
  });

  it("an unknown key resolves to nothing rather than a default", () => {
    expect(storefrontByKey("glovo-kaufland-buc")?.merchantSlug).toBe("glovo-kaufland");
    expect(storefrontByKey("nope")).toBe(undefined);
  });
});
