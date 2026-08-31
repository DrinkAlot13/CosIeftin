// The aisle test: what a shopper sees when the signal dies mid-shop.
//
// The app exists to be used in a shop, which is where signal is worst. Before this, offline
// meant the basket request failed and the totals panel stayed empty — the service worker made
// the PAGE load without a connection and did nothing for the only thing on it anyone needs.
//
// Serving a cached total is only acceptable under two rules, and both are tested here:
//   1. NEVER another list's totals. The cache is keyed by the exact list.
//   2. NEVER without its age. Age comes back with the data, so the UI cannot omit it.
import { describe, it, expect } from "./run";
import {
  saveBasket, loadBasket, clearBasketCache, describeAge, MAX_CACHE_AGE_MS,
} from "../src/lib/offline-cache";

// Minimal localStorage, including the throwing variety (private mode, blocked site data).
function installStorage(opts: { throws?: boolean } = {}): Map<string, string> {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => { if (opts.throws) throw new Error("blocked"); return map.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (opts.throws) throw new Error("blocked"); map.set(k, v); },
    removeItem: (k: string) => { if (opts.throws) throw new Error("blocked"); map.delete(k); },
  };
  (globalThis as { window?: unknown }).window = { localStorage: store };
  return map;
}

type Basket = { splitTotal: number; bestStore: string };
const basket: Basket = { splitTotal: 13750, bestStore: "Kaufland" };

describe("offline basket — a cached total is served only for the SAME list", () => {
  it("round-trips the result for the list it was saved under", () => {
    installStorage();
    saveBasket("lapte:1|paine:2", basket, 1000);
    const got = loadBasket<Basket>("lapte:1|paine:2", 1000 + 60_000);
    expect(got !== null).toBeTruthy();
    expect(got!.result.splitTotal).toBe(13750);
  });

  it("REFUSES to serve it to a different list", () => {
    installStorage();
    saveBasket("lapte:1|paine:2", basket, 1000);
    expect(loadBasket<Basket>("lapte:1|paine:3", 61_000)).toBe(null);
    expect(loadBasket<Basket>("ulei:1", 61_000)).toBe(null);
  });

  it("an empty list key never reads or writes anything", () => {
    installStorage();
    saveBasket("", basket, 1000);
    expect(loadBasket<Basket>("", 2000)).toBe(null);
  });

  it("nothing cached means null, not a crash", () => {
    installStorage();
    expect(loadBasket<Basket>("lapte:1", 1000)).toBe(null);
  });
});

describe("offline basket — the age always comes with the data", () => {
  it("returns an age label alongside the result", () => {
    installStorage();
    saveBasket("k", basket, 0);
    const got = loadBasket<Basket>("k", 20 * 60_000)!;
    expect(got.freshness.label).toBe("acum 20 de minute");
    expect(got.freshness.ageMs).toBe(20 * 60_000);
  });

  it("speaks Romanian across the whole range", () => {
    expect(describeAge(30_000).label).toBe("acum câteva secunde");
    expect(describeAge(60_000).label).toBe("acum un minut");
    expect(describeAge(45 * 60_000).label).toBe("acum 45 de minute");
    expect(describeAge(60 * 60_000).label).toBe("acum o oră");
    expect(describeAge(5 * 3600_000).label).toBe("acum 5 ore");
    expect(describeAge(26 * 3600_000).label).toBe("ieri");
    expect(describeAge(3 * 86_400_000).label).toBe("acum 3 zile");
  });
});

describe("offline basket — stale beyond usefulness is not served at all", () => {
  it("a result older than the maximum age is refused, however it would be labelled", () => {
    installStorage();
    saveBasket("k", basket, 0);
    expect(loadBasket<Basket>("k", MAX_CACHE_AGE_MS + 1)).toBe(null);
  });

  it("just inside the maximum age is still served", () => {
    installStorage();
    saveBasket("k", basket, 0);
    expect(loadBasket<Basket>("k", MAX_CACHE_AGE_MS - 1) !== null).toBeTruthy();
  });

  it("a clock that moved backwards is not trusted", () => {
    installStorage();
    saveBasket("k", basket, 10_000);
    expect(loadBasket<Basket>("k", 5_000)).toBe(null);
  });
});

describe("offline basket — storage that is unavailable or hostile", () => {
  it("localStorage that throws on every access degrades silently", () => {
    installStorage({ throws: true });
    saveBasket("k", basket, 0);            // must not throw
    expect(loadBasket<Basket>("k", 1000)).toBe(null);
    clearBasketCache();                    // must not throw
  });

  it("no window at all (server render) is safe", () => {
    delete (globalThis as { window?: unknown }).window;
    saveBasket("k", basket, 0);
    expect(loadBasket<Basket>("k", 1000)).toBe(null);
  });

  it("corrupt JSON in storage is ignored rather than thrown", () => {
    const map = installStorage();
    map.set("cosmic_basket_cache_v1", "{not json");
    expect(loadBasket<Basket>("k", 1000)).toBe(null);
  });

  it("a payload missing its timestamp is ignored", () => {
    const map = installStorage();
    map.set("cosmic_basket_cache_v1", JSON.stringify({ itemsKey: "k", result: basket }));
    expect(loadBasket<Basket>("k", 1000)).toBe(null);
  });
});
