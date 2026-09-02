// Auchan on the shared write path — parsed offline, from a real captured payload.
//
// Auchan was the one merchant whose scraper upserted Offer rows itself, so it was the one
// merchant with no price sanity gate. Moving it onto the declarative runner is only worth
// anything if the config reads the same fields the bespoke scraper read; this test is the
// proof, and it runs with zero network access.
//
// The fixtures in tests/fixtures/auchan/ are the first six products of two real category
// responses, unmodified.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import { auchan, categoryRoute } from "../scripts/adapters/auchan";
import { parseJsonPayload, pageUrl } from "../scripts/adapters/runner";
import type { Route } from "../scripts/adapters/types";

const fixture = (name: string): string =>
  readFileSync(join(process.cwd(), "tests", "fixtures", "auchan", `${name}.txt`), "utf8");

const ROUTE: Route = { url: "https://www.auchan.ro/x", cat: "bauturi" };
const parse = (name: string) => parseJsonPayload(fixture(name), auchan.json!, ROUTE, auchan);

describe("Auchan adapter — VTEX offset pagination", () => {
  it("page 1 asks for rows 0-49, not page=1", () => {
    const r = categoryRoute(5010000, "bauturi");
    expect(pageUrl(r.url, 1, auchan.pageSize)).toContain("_from=0&_to=49");
  });

  it("page 2 continues at the next offset", () => {
    const r = categoryRoute(5010000, "bauturi");
    expect(pageUrl(r.url, 2, auchan.pageSize)).toContain("_from=50&_to=99");
  });

  it("uses the FULL category path, because VTEX gates the single segment", () => {
    // fq=C:5010000 alone returns [] — the parent must be the id rounded down to 1e6.
    expect(categoryRoute(5010000, "bauturi").url).toContain("fq=C:5000000/5010000");
    expect(categoryRoute(2030000, "lactate").url).toContain("fq=C:2000000/2030000");
    expect(categoryRoute(8070000, "menaj").url).toContain("fq=C:8000000/8070000");
  });

  it("refuses an offset route with no pageSize rather than fetching page 1 forever", () => {
    let threw = false;
    try { pageUrl(categoryRoute(5010000, "b").url, 2, undefined); } catch { threw = true; }
    expect(threw).toBe(true);
  });
});

describe("Auchan adapter — field map against a real payload", () => {
  it("reads every product in the fixture", () => {
    expect(parse("bauturi-p1").length).toBe(6);
    expect(parse("lactate-p1").length).toBe(1);
  });

  it("reads the price from the VTEX seller offer, misspelling and all", () => {
    // items[0].sellers[0].commertialOffer.Price — 'commertial' is VTEX's own typo.
    const p = parse("bauturi-p1")[0];
    expect(p.price > 0).toBe(true);
    expect(p.rawPriceText !== null && p.rawPriceText !== "").toBe(true);
  });

  it("every parsed offer carries a price, a name and a URL", () => {
    for (const p of [...parse("bauturi-p1"), ...parse("lactate-p1")]) {
      expect(p.name.length > 0).toBe(true);
      expect(p.price > 0).toBe(true);
      expect(p.url.startsWith("https://www.auchan.ro/")).toBe(true);
    }
  });

  it("builds the VTEX product URL with its /p suffix", () => {
    // abs() alone yields /{linkText}; the real page is /{linkText}/p. The bespoke scraper
    // appended it inline, so a config that forgot would have written 9,112 dead links.
    for (const p of parse("bauturi-p1")) {
      expect(p.url.endsWith("/p")).toBe(true);
      expect(!p.productUrl || p.productUrl.endsWith("/p")).toBe(true);
    }
  });

  it("does not double the /p suffix", () => {
    const refined = auchan.refine!({
      ...parse("bauturi-p1")[0],
      url: "https://www.auchan.ro/thing/p",
      productUrl: "https://www.auchan.ro/thing/p",
    });
    expect(refined.url).toBe("https://www.auchan.ro/thing/p");
  });

  it("keeps rawPriceText AND rawSourceBlob — the bespoke scraper kept neither reliably", () => {
    // 3,524 of 9,112 Auchan offers have no rawPriceText and ZERO have a rawSourceBlob, so
    // the 28,14 -> 12,00 write could not be audited after the fact. The shared path records
    // the whole source item.
    for (const p of parse("bauturi-p1")) {
      expect(typeof p.rawPriceText).toBe("string");
      expect(typeof p.rawSourceBlob).toBe("string");
      expect((p.rawSourceBlob ?? "").length > 50).toBe(true);
    }
  });

  it("reads the EAN when VTEX gives one", () => {
    const withEan = parse("bauturi-p1").filter((p) => p.ean);
    expect(withEan.length > 0).toBe(true);
    for (const p of withEan) expect(/^\d{8,14}$/.test(p.ean!)).toBe(true);
  });

  it("carries the category through from the route", () => {
    for (const p of parse("bauturi-p1")) expect(p.category).toBe("bauturi");
  });

  it("translates the merchant channel into the OFFER vocabulary", () => {
    // priceChannel "shelf" is the merchant word; the offer column takes "SHELF". These were
    // the same field name once, and the copy across them cost 10,731 rows.
    for (const p of parse("bauturi-p1")) expect(p.priceSource).toBe("SHELF");
  });

  it("marks IsAvailable=false as unavailable rather than dropping the row", () => {
    // unavailableWhen: [false]. A dropped row would silently shrink the run and trip the
    // 60%-of-previous abort for the wrong reason.
    const all = parse("bauturi-p1");
    expect(all.every((p) => typeof p.available === "boolean")).toBe(true);
  });
});

describe("Auchan adapter — the gates it now inherits", () => {
  it("declares addNew, so pool items that match nothing become catalog products", () => {
    expect(auchan.addNew).toBe(true);
  });

  it("is a json adapter, so it never renders a page to read a price", () => {
    expect(auchan.mode).toBe("json");
    expect(auchan.dom === undefined).toBe(true);
  });

  it("covers every category the bespoke scraper covered", () => {
    // The bespoke scraper walked 44 VTEX subcategory ids. Losing any of them would look
    // like a price drop in coverage, not a bug.
    expect(auchan.routes.length).toBe(44);
    const cats = new Set(auchan.routes.map((r) => r.cat));
    for (const c of ["lactate", "mezeluri", "panificatie", "legume-fructe", "bauturi", "bacanie", "menaj"]) {
      expect(cats.has(c)).toBe(true);
    }
  });
});
