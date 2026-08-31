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

  it("drops items with no usable price", () => expect(out.length).toBe(2));
  it("parses RO decimal commas", () => expect(out[0].price).toBeCloseTo(6.49));
  it("resolves relative URLs against the site", () => expect(out[0].url).toBe("https://t.ro/p/1"));
  it("maps stock:false to unavailable", () => expect(out[1].available).toBeFalsy());
  it("keeps a checksum-valid EAN", () => expect(out[0].ean).toBe("3017620425035"));
  it("dig() walks dotted paths incl. array indexes", () =>
    expect(dig({ a: { b: [{ c: 7 }] } }, "a.b.0.c")).toBe(7));
});
