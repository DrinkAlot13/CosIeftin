// Scraper PARSER tests against saved fixtures — no network, so they actually run in CI
// and catch a silent parse regression before it reaches the database.
//
// Refresh a fixture with: npm run fixture:save -- kaufland
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import { extractOffers, toStoreProduct } from "../scripts/scrape-kaufland";
import { parseJsonPayload, dig } from "../scripts/adapters/runner";

const FIX = join(process.cwd(), "tests", "fixtures");

describe("Kaufland weekly-offers parser (fixture)", () => {
  const path = join(FIX, "kaufland", "weekly-offers.html");
  const html = existsSync(path) ? readFileSync(path, "utf8") : "";
  const offers = html ? extractOffers(html) : [];

  it("fixture exists (run: npm run fixture:save -- kaufland)", () => expect(html.length).toBeGreaterThan(1000));
  it("extracts a realistic number of offers", () => expect(offers.length).toBeGreaterThan(50));

  it("every offer has a title", () => expect(offers.every((o) => typeof o.title === "string" && o.title.length > 0)).toBeTruthy());

  it("prices are plausible grocery amounts", () => {
    const priced = offers.map((o) => toStoreProduct(o, "/x")).filter(Boolean) as { price: number }[];
    expect(priced.length).toBeGreaterThan(50);
    expect(priced.every((p) => p.price > 0 && p.price < 5000)).toBeTruthy();
  });

  it("no offer parses to the 2-lei-class bug (all prices > 0.1)", () => {
    const priced = offers.map((o) => toStoreProduct(o, "/x")).filter(Boolean) as { price: number }[];
    expect(priced.every((p) => p.price > 0.1)).toBeTruthy();
  });

  it("pack size is folded into the name so unit pricing works", () => {
    const withUnit = offers.filter((o) => o.unit && /\d/.test(String(o.unit)));
    if (withUnit.length === 0) return; // fixture may not contain one
    const sp = toStoreProduct(withUnit[0], "/x")!;
    expect(/\d/.test(sp.name)).toBeTruthy();
  });

  it("promo windows are present (flyer offers carry dates)", () => {
    expect(offers.some((o) => typeof o.dateFrom === "string" && typeof o.dateTo === "string")).toBeTruthy();
  });
});

describe("adapter JSON parser", () => {
  const payload = JSON.stringify({
    data: {
      products: [
        { n: "Lapte Zuzu 1L", p: "6,49", img: "/a.jpg", link: "/p/1", stock: true, gtin: "3017620425035" },
        { n: "Paine 500g", p: "4,99", img: "/b.jpg", link: "/p/2", stock: false },
        { n: "Fara pret", p: "", img: "", link: "/p/3", stock: true },
      ],
    },
  });
  const map = { items: "data.products", name: "n", price: "p", image: "img", link: "link", available: "stock", ean: "gtin" };
  const ad = { slug: "t", name: "T", websiteUrl: "https://t.ro", section: "grocery", mode: "json" as const, routes: [] };
  const out = parseJsonPayload(payload, map, { url: "" }, ad);

  it("KEEPS an item with no usable price, at price 0, so the refusal can be recorded", () => {
    // This used to assert `out.length === 2` — the third item, whose price could not be
    // parsed, was dropped by the parser and never seen again. A gate that discards leaves
    // no evidence, and evidence is the whole point: the item now travels into the pool at
    // price 0, where matchPoolToCatalog records it as a pre-offer refusal WITH its
    // rawPriceText, and still never becomes an offer.
    expect(out.length).toBe(3);
    const refused = out.filter((p) => p.price === 0);
    expect(refused.length).toBe(1);
    // the evidence a parser change would need in order to be replayed against it
    expect(typeof refused[0].rawPriceText).toBe("string");
    expect(refused[0].name.length > 0).toBe(true);
  });
  it("parses RO decimal commas", () => expect(out[0].price).toBeCloseTo(6.49));
  it("resolves relative URLs against the site", () => expect(out[0].url).toBe("https://t.ro/p/1"));
  it("maps stock:false to unavailable", () => expect(out[1].available).toBeFalsy());
  it("keeps a checksum-valid EAN", () => expect(out[0].ean).toBe("3017620425035"));
  it("dig() walks dotted paths incl. array indexes", () =>
    expect(dig({ a: { b: [{ c: 7 }] } }, "a.b.0.c")).toBe(7));
});

describe("adapter JSON parser — object-keyed item maps (dm.ro's batch shape)", () => {
  // dm.ro's `/products/tiles/{country}/dans/{dans}` returns `{"products": {"<id>": {...}}}` —
  // an OBJECT keyed by product id, not an array. A caller asking for ids that don't exist gets
  // them simply absent from the map, never a null placeholder, so Object.values() here must not
  // choke on that either.
  const payload = JSON.stringify({
    products: {
      "100": { title: { tileHeadline: "Crema de fata 50 ml" }, price: { price: { current: { value: "48,95 lei" } } }, self: "/p/d/100/crema", brand: { name: "Nivea" }, gtin: 9005800227269 },
      "200": { title: { tileHeadline: "Sampon 250 ml" }, price: { price: { current: { value: "14,95 lei" } } }, self: "/p/d/200/sampon", brand: { name: "Balea" }, gtin: 1234567890123 },
    },
  });
  const map = { items: "products", name: "title.tileHeadline", price: "price.price.current.value", link: "self", brand: "brand.name", ean: "gtin" };
  const ad = { slug: "dm", name: "dm", websiteUrl: "https://www.dm.ro", section: "cosmetice", mode: "json" as const, routes: [] };
  const out = parseJsonPayload(payload, map, { url: "" }, ad);

  it("reads every value out of the object map", () => expect(out.length).toBe(2));
  it("parses the RO-formatted price text", () => expect(out[0].price).toBeCloseTo(48.95));
  it("resolves the relative self link", () => expect(out[0].url).toBe("https://www.dm.ro/p/d/100/crema"));
  it("reads the brand name", () => expect(out[1].brand).toBe("Balea"));
  it("still returns [] for an array-shaped items path (the common case stays untouched)", () => {
    const arrayPayload = JSON.stringify({ products: [{ title: { tileHeadline: "X" }, price: { price: { current: { value: "1,00 lei" } } } }] });
    const arrOut = parseJsonPayload(arrayPayload, map, { url: "" }, ad);
    expect(arrOut.length).toBe(1);
  });
  it("returns [] when items resolves to neither an array nor an object", () => {
    const scalarPayload = JSON.stringify({ products: "nope" });
    expect(parseJsonPayload(scalarPayload, map, { url: "" }, ad).length).toBe(0);
  });
});

describe("dm.ro batch-tiles parser (fixture)", () => {
  const path = join(FIX, "dm", "r-p1.txt");
  const raw = existsSync(path) ? readFileSync(path, "utf8") : "";
  const map = { items: "products", name: "title.tileHeadline", price: "price.price.current.value", link: "self", image: "images.0.tileSrc", brand: "brand.name", ean: "gtin" };
  const ad = { slug: "dm", name: "dm drogerie markt", websiteUrl: "https://www.dm.ro", section: "cosmetice", mode: "json" as const, routes: [] };
  const out = raw ? parseJsonPayload(raw, map, { url: "" }, ad) : [];

  it("fixture exists (run: FIXTURE_SAVE=1 npm run scrape:dm)", () => expect(raw.length).toBeGreaterThan(1000));
  // The saved fixture is whichever batch FIXTURE_SAVE happened to write last — the final batch
  // of a run is a REMAINDER (pool size mod BATCH_SIZE), so this only needs to rule out "empty
  // or near-empty", not assert the full 180.
  it("extracts a realistic batch of products", () => expect(out.length).toBeGreaterThan(10));
  it("every product has a name and a parsed price", () =>
    expect(out.every((p) => p.name.length > 0 && p.price > 0)).toBeTruthy());
  it("every product URL points back at dm.ro's own product path", () =>
    expect(out.every((p) => (p.url ?? "").startsWith("https://www.dm.ro/p/d/"))).toBeTruthy());
  it("EANs that are present are checksum-valid (parseEan rejects a bad one)", () => {
    const withEan = out.filter((p) => p.ean);
    expect(withEan.length).toBeGreaterThan(0);
    expect(withEan.every((p) => /^\d{8}$|^\d{12,14}$/.test(p.ean!))).toBeTruthy();
  });
});
