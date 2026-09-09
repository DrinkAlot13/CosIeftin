// SEARCH QUALITY — 40 real Romanian queries against 1,444 real catalog names.
//
// Search quality had never been measured. The scoring lived inside `searchProducts`, wrapped
// around a Prisma call, so checking whether "lapte zuzu" returns the right milk meant a
// database, a scrape and a running app. Nobody was going to do that on every change, so every
// change to the weights was a guess with no way to tell a fix from a regression.
//
// The catalog here is not invented: product names pulled from the live database, covering every
// term in the fixture plus deterministic distractors — without those, precision is untested and
// a ranker that returns everything scores perfectly.
//
// A failure here is not automatically a bug in the ranker. Read the case's `why` first: the
// fixture encodes what a Romanian shopper means, and sometimes the fixture is what is wrong.
// Two cases in this very set were wrong and are annotated where they sit.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import { searchCatalog, scoreOne, SEARCH_THRESHOLD, type Searchable } from "../src/lib/search/search";
import { isKnownBrand } from "../src/lib/search/brands";
import { normalizeRo } from "../src/lib/text/normalizeRo";
import { SEARCH_CASES } from "./fixtures/search/queries";

type Row = Searchable & { name: string; brand: string | null };
const CATALOG: Row[] = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "fixtures", "search", "catalog.json"), "utf8"),
);

const hay = (r: Row): string => normalizeRo(`${r.brand ?? ""} ${r.name}`);
const contains = (rows: Row[], needle: string): boolean => rows.some((r) => hay(r).includes(normalizeRo(needle)));

describe("search quality — the fixture itself", () => {
  // 58, not 40: eighteen staples were added after somebody actually used the site and found
  // the FIRST suggestion was the wrong KIND of product for seven of twenty ordinary shopping
  // words. The count is pinned rather than loosened to `>= 40`, because a case silently
  // disappearing is exactly what pinning it prevents.
  it("holds 58 queries", () => expect(SEARCH_CASES.length).toBe(58));
  it("every case states why it is in the set", () =>
    expect(SEARCH_CASES.every((c) => c.why.length > 10)).toBeTruthy());
  it("runs against a real catalog, not an invented one", () =>
    expect(CATALOG.length > 900).toBeTruthy());
  it("the catalog carries distractors, or precision is untested", () => {
    const milk = CATALOG.filter((r) => normalizeRo(r.name).includes("lapte")).length;
    expect(milk > 0).toBeTruthy();
    expect(milk < CATALOG.length / 4).toBeTruthy();
  });
  it("covers queries for brands we do NOT stock — the class the old fixture had none of", () =>
    expect(SEARCH_CASES.filter((c) => c.expectBrandMiss).length >= 5).toBeTruthy());
});

describe("search quality — 40 real queries", () => {
  for (const c of SEARCH_CASES) {
    it(`"${c.q || "(empty)"}" — ${c.why}`, () => {
      const out = searchCatalog(c.q, CATALOG);
      const rows = out.results.map((r) => r.item);
      const problems: string[] = [];

      if (c.expectEmpty) {
        if (out.kind !== "empty" || rows.length > 0) {
          problems.push(`expected nothing, got kind=${out.kind} with ${rows.length} result(s)`);
        }
      }

      if (c.expectBrandMiss) {
        if (out.kind !== "brand-miss") {
          problems.push(`expected a brand-miss naming "${c.expectBrandMiss}", got kind=${out.kind} with ${rows.length} results`);
        } else if (!out.missing.map(normalizeRo).includes(normalizeRo(c.expectBrandMiss))) {
          problems.push(`brand-miss reported [${out.missing.join(", ")}], expected "${c.expectBrandMiss}"`);
        }
        // Whatever is shown is an ALTERNATIVE and must never claim the term that failed.
        const liar = rows.find((r) => hay(r).includes(normalizeRo(c.expectBrandMiss!)));
        if (liar) problems.push(`an "alternative" contains the missing term: ${liar.name}`);
      } else if (out.kind === "brand-miss") {
        problems.push(`unexpected brand-miss on [${out.missing.join(", ")}]`);
      }

      for (const need of c.mustFind ?? []) {
        if (!contains(rows, need)) problems.push(`missing "${need}"`);
      }
      for (const avoid of c.mustNotFind ?? []) {
        if (contains(rows, avoid)) problems.push(`should not return "${avoid}"`);
      }
      for (const avoid of c.mustNotFindInTop ?? []) {
        if (contains(rows.slice(0, 5), avoid)) problems.push(`"${avoid}" must not be in the top 5`);
      }
      // The first result specifically. Most "wrong kind of product" complaints are about
      // position one: a shopper typing "zahar" can live with icing sugar fourth, not first.
      for (const avoid of c.topMustNotContain ?? []) {
        if (rows.length > 0 && hay(rows[0]).includes(normalizeRo(avoid))) {
          problems.push(`top result must not contain "${avoid}", got "${rows[0].name}"`);
        }
      }
      if (c.topMustContain && (rows.length === 0 || !hay(rows[0]).includes(normalizeRo(c.topMustContain)))) {
        problems.push(`top result should contain "${c.topMustContain}", got "${rows[0]?.name ?? "(nothing)"}"`);
      }
      if (c.brandRequired) {
        const wrong = rows.filter((r) => !hay(r).includes(normalizeRo(c.brandRequired!)));
        if (rows.length === 0) problems.push(`no results at all for brand "${c.brandRequired}"`);
        if (wrong.length) problems.push(`${wrong.length}/${rows.length} results are not ${c.brandRequired} (e.g. "${wrong[0].name}")`);
      }

      if (problems.length) {
        throw new Error(
          `${problems.join("; ")}\n      returned ${rows.length}: ` +
          rows.slice(0, 5).map((r) => `"${r.name.slice(0, 46)}"`).join(", "),
        );
      }
      expect(problems.length).toBe(0);
    });
  }
});

describe("search quality — properties that must hold for any query", () => {
  it("an empty or whitespace query never returns the catalog", () => {
    expect(searchCatalog("", CATALOG).results.length).toBe(0);
    expect(searchCatalog("   ", CATALOG).results.length).toBe(0);
  });

  it("results are sorted by tier, then score", () => {
    for (const q of ["lapte", "cafea", "apa minerala", "milka"]) {
      const rs = searchCatalog(q, CATALOG).results;
      for (let i = 1; i < rs.length; i++) {
        const prev = rs[i - 1];
        const cur = rs[i];
        if (cur.tier > prev.tier) throw new Error(`"${q}" tier out of order at ${i}`);
        if (cur.tier === prev.tier && cur.score > prev.score + 1e-9) throw new Error(`"${q}" score out of order at ${i}`);
      }
    }
  });

  it("ties break toward the product priced in more shops", () => {
    // The whole point of a comparison site: an item you can compare beats one you cannot.
    const a: Row = { name: "Lapte Test Unu 1 l", brand: null, merchantCount: 1 };
    const b: Row = { name: "Lapte Test Unu 1 l", brand: null, merchantCount: 4 };
    const rs = searchCatalog("lapte test unu", [a, b]).results;
    expect(rs[0].item.merchantCount).toBe(4);
  });

  it("nothing under the threshold is ever returned", () => {
    for (const q of ["lapte", "detergent", "zuzu"]) {
      for (const r of searchCatalog(q, CATALOG).results) expect(r.score >= SEARCH_THRESHOLD).toBeTruthy();
    }
  });

  it("an exact product name outranks everything else", () => {
    const sample = CATALOG[Math.floor(CATALOG.length / 2)];
    const rs = searchCatalog(sample.name, CATALOG).results;
    expect(rs.length > 0).toBeTruthy();
    expect(normalizeRo(rs[0].item.name)).toBe(normalizeRo(sample.name));
  });

  it("scoreOne gives an exact name the exact tier", () => {
    const sample = CATALOG[10];
    const tokens = normalizeRo(sample.name).split(/\s+/).filter(Boolean);
    expect(scoreOne(tokens, normalizeRo(sample.name), sample, []).tier).toBe(400);
  });

  it("DIACRITICS CHANGE NOTHING — including the cedilla encodings", () => {
    // ș U+0219 vs ş U+015F, ț U+021B vs ţ U+0163. Both appear in scraped Romanian data and
    // NFD does not unify them; unfolded, "Făgăraș" and "Făgăraş" are simply different strings.
    const pairs: [string, string][] = [
      ["paine", "pâine"], ["oua", "ouă"], ["zahar", "zahăr"], ["branza", "brânză"],
      ["sunca", "șuncă"], ["sunca", "şuncă"], ["carnati", "cârnați"], ["carnati", "cârnaţi"],
      ["telina", "țelină"], ["telina", "ţelină"],
    ];
    for (const [a, b] of pairs) {
      const ra = searchCatalog(a, CATALOG).results.map((r) => r.item.name);
      const rb = searchCatalog(b, CATALOG).results.map((r) => r.item.name);
      if (JSON.stringify(ra) !== JSON.stringify(rb)) {
        throw new Error(`"${a}" and "${b}" return different results (${ra.length} vs ${rb.length})`);
      }
    }
  });

  it("a brand we do not stock is never silently answered with its category", () => {
    for (const q of ["illy", "yakult", "kelloggs"]) {
      const out = searchCatalog(q, CATALOG);
      expect(out.kind).toBe("brand-miss");
      expect(out.missing.includes(q)).toBeTruthy();
    }
  });

  it("the known-brand list never claims we stock anything", () => {
    // It exists only to let us say "no" precisely. If it ever gated what we SHOW, a brand
    // missing from the list would silently hide real products.
    expect(isKnownBrand("illy")).toBeTruthy();
    expect(searchCatalog("illy", CATALOG).results.length).toBe(0);
  });
});
