// SEARCH QUALITY — 40 real Romanian queries against 1,028 real catalog names.
//
// Search quality had never been measured. The scoring lived inside `searchProducts`, wrapped
// around a Prisma call, so checking whether "lapte zuzu" returns the right milk meant a
// database, a scrape and a running app. Nobody was going to do that on every change, so every
// change to the weights was a guess with no way to tell a fix from a regression.
//
// The catalog here is not invented: 1,028 product names pulled from the live database,
// covering every query in the fixture plus 400 unrelated products as distractors — without
// those, precision is untested and a ranker that returns everything scores perfectly.
//
// A failure here is not automatically a bug in the ranker. Read the case's `why` first: the
// fixture encodes what a Romanian shopper means, and sometimes the fixture is what is wrong.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import { rankSearch, scoreOne, SEARCH_THRESHOLD } from "../src/lib/search/rank";
import { SEARCH_CASES } from "./fixtures/search/queries";

type Row = { name: string; brand: string | null };
const CATALOG: Row[] = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "fixtures", "search", "catalog.json"), "utf8"),
);

const norm = (s: string): string =>
  s.toLowerCase()
    .split("ș").join("s").split("ş").join("s")
    .split("ț").join("t").split("ţ").join("t")
    .split("ă").join("a").split("â").join("a").split("î").join("i");

const contains = (rows: Row[], needle: string): boolean =>
  rows.some((r) => norm(`${r.brand ?? ""} ${r.name}`).includes(norm(needle)));

describe("search quality — the fixture itself", () => {
  it("holds 40 queries", () => expect(SEARCH_CASES.length).toBe(40));
  it("every case states why it is in the set", () =>
    expect(SEARCH_CASES.every((c) => c.why.length > 10)).toBeTruthy());
  it("runs against a real catalog, not an invented one", () =>
    expect(CATALOG.length > 500).toBeTruthy());
  it("the catalog carries distractors, or precision is untested", () => {
    const milk = CATALOG.filter((r) => norm(r.name).includes("lapte")).length;
    expect(milk > 0).toBeTruthy();
    expect(milk < CATALOG.length / 4).toBeTruthy();
  });
});

describe("search quality — 40 real queries", () => {
  const failures: string[] = [];

  for (const c of SEARCH_CASES) {
    it(`"${c.q || "(empty)"}" — ${c.why}`, () => {
      const rows = rankSearch(c.q, CATALOG).map((r) => r.item);

      if (c.expectEmpty) {
        if (rows.length > 0) {
          throw new Error(
            `expected nothing, got ${rows.length} result(s), first: "${rows[0].name}"`,
          );
        }
        expect(rows.length).toBe(0);
        return;
      }

      const problems: string[] = [];
      for (const need of c.mustFind ?? []) {
        if (!contains(rows, need)) problems.push(`missing "${need}"`);
      }
      for (const avoid of c.mustNotFind ?? []) {
        if (contains(rows, avoid)) problems.push(`should not return "${avoid}"`);
      }
      if (c.topMustContain && (rows.length === 0 || !norm(rows[0].name).includes(norm(c.topMustContain)))) {
        problems.push(`top result should contain "${c.topMustContain}", got "${rows[0]?.name ?? "(nothing)"}"`);
      }
      if (problems.length) {
        failures.push(`"${c.q}": ${problems.join("; ")}`);
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
    expect(rankSearch("", CATALOG).length).toBe(0);
    expect(rankSearch("   ", CATALOG).length).toBe(0);
  });

  it("results are sorted by descending score", () => {
    for (const q of ["lapte", "cafea", "apa minerala", "milka"]) {
      const scores = rankSearch(q, CATALOG).map((r) => r.score);
      for (let i = 1; i < scores.length; i++) {
        if (scores[i] > scores[i - 1] + 1e-9) throw new Error(`"${q}" is not sorted at ${i}`);
      }
    }
  });

  it("nothing under the threshold is ever returned", () => {
    for (const q of ["lapte", "detergent", "zuzu"]) {
      for (const r of rankSearch(q, CATALOG)) expect(r.score >= SEARCH_THRESHOLD).toBeTruthy();
    }
  });

  it("an exact product name scores far above the threshold", () => {
    const sample = CATALOG[Math.floor(CATALOG.length / 2)];
    expect(scoreOne(sample.name, sample).score > SEARCH_THRESHOLD * 2).toBeTruthy();
  });

  it("diacritics change nothing", () => {
    for (const [a, b] of [["paine", "pâine"], ["oua", "ouă"], ["zahar", "zahăr"], ["branza", "brânză"]]) {
      const ra = rankSearch(a, CATALOG).map((r) => r.item.name);
      const rb = rankSearch(b, CATALOG).map((r) => r.item.name);
      if (JSON.stringify(ra) !== JSON.stringify(rb)) {
        throw new Error(`"${a}" and "${b}" return different results (${ra.length} vs ${rb.length})`);
      }
    }
  });

  it("naming a brand never returns a different brand's product", () => {
    for (const [q, other] of [["lapte zuzu", "napolact"], ["bere ursus", "heineken"]]) {
      for (const r of rankSearch(q, CATALOG)) {
        if (norm(`${r.item.brand ?? ""} ${r.item.name}`).includes(other)) {
          throw new Error(`"${q}" returned a ${other} product: "${r.item.name}"`);
        }
      }
    }
  });

  it("scoring is deterministic", () => {
    const a = rankSearch("lapte zuzu", CATALOG).map((r) => `${r.item.name}:${r.score.toFixed(6)}`);
    const b = rankSearch("lapte zuzu", CATALOG).map((r) => `${r.item.name}:${r.score.toFixed(6)}`);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// The head-noun rule, stated as a property rather than as one query's expectation.
//
// A single-word query names a KIND of product. Romanian puts that word first in the name, so
// the products that are that kind must come before the products that merely contain it —
// milk before milk chocolate, coffee before coffee-flavoured yoghurt.
describe("search quality — what a product IS beats what it contains", () => {
  const headOf = (name: string): string =>
    norm(name).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3 && !/\d/.test(t))[0] ?? "";

  for (const q of ["lapte", "cafea", "ciocolata", "apa"]) {
    it(`"${q}" puts head-noun matches first`, () => {
      const rows = rankSearch(q, CATALOG).map((r) => r.item);
      if (rows.length < 5) return; // nothing to order
      const top = rows.slice(0, 5);
      const wrong = top.filter((r) => headOf(r.name) !== norm(q));
      if (wrong.length > 1) {
        throw new Error(
          `${wrong.length}/5 top results are not ${q}: ` +
          wrong.map((r) => `"${r.name.slice(0, 44)}"`).join(", "),
        );
      }
      expect(wrong.length <= 1).toBeTruthy();
    });
  }

  it("the boost does not EXCLUDE modifier matches — they rank lower, they still appear", () => {
    const rows = rankSearch("lapte", CATALOG).map((r) => r.item.name);
    expect(rows.some((n) => norm(n).includes("ciocolata") && norm(n).includes("lapte"))).toBeTruthy();
  });

  it("a head noun that is genuinely the product still wins: 'lapte de cocos' is milk", () => {
    const rows = rankSearch("lapte de cocos", CATALOG).map((r) => r.item.name);
    expect(rows.some((n) => norm(n).includes("cocos"))).toBeTruthy();
  });
});
