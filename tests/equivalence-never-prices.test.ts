// AN EQUIVALENT MAY NEVER SET ANOTHER PRODUCT'S PRICE.
//
// Equivalence classes make Auchan's own 500 g brown sugar comparable with Mega Image's own
// 500 g brown sugar. They are DIFFERENT PRODUCTS — different brands, different recipes,
// different names — and calling them interchangeable for a shopping list is a claim the site
// can defend. Letting one of them supply the other's "cel mai mic preț" is not.
//
// The failure would be silent and severe: a product page showing 4,35 lei as this product's
// best price when this product has never been sold at 4,35 anywhere. The number would be real,
// the attribution false, and nothing on the page would say which product it came from.
//
// So this pins the boundary structurally, in the two places it could be crossed:
//
//   1. `getItemPage`, which computes `summary.lowest` and `bestOffer`, must derive them from
//      the product's OWN offers. It must not read equivalenceClass at all.
//   2. `getClassEquivalents`, which does read the class, must feed a display table only — it
//      returns rows carrying their own product name, slug, shop and unit price, so every price
//      on screen is attributed to the product that actually carries it.
//
// A structural test rather than a data one, because the risk is a future edit joining the two,
// and no fixture would catch that.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";

const queries = readFileSync(join(process.cwd(), "src/lib/queries.ts"), "utf8");

/** The body of a top-level exported async function, by name. */
function bodyOf(src: string, fn: string): string {
  const start = src.indexOf(`export async function ${fn}(`);
  if (start === -1) throw new Error(`${fn} not found in queries.ts`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

describe("equivalence never prices another product", () => {
  it("getItemPage does not read the equivalence class at all", () => {
    const body = bodyOf(queries, "getItemPage");
    expect(/equivalenceClass/i.test(body)).toBe(false);
  });

  it("getClassEquivalents returns per-shop rows that name their own product", () => {
    const body = bodyOf(queries, "getClassEquivalents");
    // Each row must carry the identity of the product it priced, or the table could show a
    // price without saying whose it is.
    for (const field of ["slug", "name", "merchantName", "priceBani", "pricePerUnit"]) {
      expect(body.includes(`${field}:`)).toBe(true);
    }
    // …and it must mark which row is the product being viewed, so "this one" is never implied.
    expect(body.includes("isSelf")).toBe(true);
  });

  it("the item page renders equivalents as equivalents, never as the same product", () => {
    const page = readFileSync(join(process.cwd(), "src/app/p/[slug]/page.tsx"), "utf8");
    expect(page.includes("Produse echivalente la alte magazine")).toBe(true);
    // The old heading claimed sameness. If it ever returns, this fails.
    expect(page.includes("Același lucru, la alt magazin")).toBe(false);
    expect(page.includes("Nu sunt același produs")).toBe(true);
  });

  it("the equivalents heading is chosen from the data, never asserted", () => {
    // `crenvursti-450g` had three live members and ALL THREE were at Mega Image, so the page
    // printed "la alte magazine" over a table where every row was the shop the reader was
    // already looking at. The old guard was `rows.length > 1`, and a row is per (product,
    // shop) — two rows can be one product at two shops, or two products at one.
    const page = readFileSync(join(process.cwd(), "src/app/p/[slug]/page.tsx"), "utf8");
    expect(page.includes("equivalents.rows.length > 1")).toBe(false);
    expect(page.includes("equivalents.otherShopCount > 0")).toBe(true);
    expect(page.includes("Produse echivalente în același magazin")).toBe(true);

    // …and both counts must exist on EVERY return path of the query, or the page compares
    // `undefined > 0`, which is false, and the section silently never renders.
    const body = bodyOf(queries, "getClassEquivalents");
    expect(body.includes("otherShopCount: 0, equivalentCount: 0")).toBe(true);
  });

  it("countStats keeps comparable and comparable-or-equivalent as SEPARATE numbers", () => {
    const body = bodyOf(queries, "countStats");
    expect(body.includes("comparable,")).toBe(true);
    expect(body.includes("comparableOrEquivalent")).toBe(true);
    // The strict count must still be the plain 2-merchant depth test — if a future edit folds
    // equivalence into it, the headline changes meaning without changing its name.
    expect(body.includes("depth.filter((d) => d._count._all >= 2).length")).toBe(true);
  });

  it("the homepage prints the INCLUSIVE number, and says what it includes", () => {
    // Two counts side by side read as a contradiction to a shopper. The homepage carries the
    // broader one with its meaning attached; the strict one moved to where the distinction is
    // explained. What must never happen is the strict number disappearing — see the next test.
    const home = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");
    expect(home.includes("stats.comparableOrEquivalent")).toBe(true);
    expect(home.includes("de comparat între magazine")).toBe(true);
    expect(home.includes("echivalente")).toBe(true); // the title explains the word
  });

  it("the STRICT number still exists, on the pages that explain the difference", () => {
    // It is how we tell whether the catalog improved or the metric loosened. Deleting it
    // everywhere would make the headline unfalsifiable.
    const method = readFileSync(join(process.cwd(), "src/app/metodologie/page.tsx"), "utf8");
    const stats = readFileSync(join(process.cwd(), "src/app/admin/stats/page.tsx"), "utf8");
    expect(method.includes("comparable")).toBe(true);
    expect(stats.includes("comparable")).toBe(true);
  });
});
