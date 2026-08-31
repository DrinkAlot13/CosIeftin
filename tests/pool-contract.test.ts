// THE POOL CONTRACT.
//
// Metro and Mega Image both wrote thousands of offers with no `productUrl` and no
// `rawPriceText`. The scrapers set both fields correctly. What destroyed them was one line at
// the matcher call:
//
//     pool.map((c) => ({ name: c.name, brand: c.brand, price: c.price, ... }))
//
// TypeScript cannot object to that, because a narrower object literal is a perfectly valid
// StoreProduct. Nothing failed, nothing warned, and the loss was only found by querying the
// database for a field the writing code believed it was setting. Carrefour had the same line
// and lost its reference prices to it as well.
//
// Two defences, both tested here:
//   1. every scraper passes its pool UNMAPPED, so the compiler is on our side; and
//   2. `assertPoolContract` refuses a pool that has lost rawPriceText anyway — enforced inside
//      matchPoolToCatalog, before any database work, so a mangled run writes nothing at all.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import {
  poolCompleteness, assertPoolContract, MIN_RAW_PRICE_TEXT_PCT, type StoreProduct,
} from "../src/lib/scrape-util";

const p = (over: Partial<StoreProduct> = {}): StoreProduct => ({
  name: "Lapte Zuzu 1,5% 1 L",
  brand: "Zuzu",
  price: 7.99,
  available: true,
  url: "https://example.ro/p/lapte",
  image: null,
  productUrl: "https://example.ro/p/lapte",
  rawPriceText: "7,99 lei",
  ...over,
});

describe("pool contract — completeness is measured, not assumed", () => {
  it("reports coverage per field", () => {
    const c = poolCompleteness([p(), p({ rawPriceText: null }), p({ productUrl: null }), p({ ean: "5941234567890" })]);
    expect(c.total).toBe(4);
    expect(c.withRawPriceText).toBe(3);
    expect(c.withProductUrl).toBe(3);
    expect(c.withEan).toBe(1);
    expect(c.rawPriceTextPct).toBe(75);
  });

  it("an empty string is not provenance", () => {
    expect(poolCompleteness([p({ rawPriceText: "" }), p({ rawPriceText: "   " })]).withRawPriceText).toBe(0);
  });

  it("an empty pool does not divide by zero", () => {
    const c = poolCompleteness([]);
    expect(c.total).toBe(0); expect(c.rawPriceTextPct).toBe(0);
  });
});

describe("pool contract — a mangled pool is refused before it can write", () => {
  it("accepts a pool that carries its source strings", () => {
    expect(assertPoolContract([p(), p(), p()], "test").rawPriceTextPct).toBe(100);
  });

  it("REJECTS the exact failure Metro and Mega Image shipped", () => {
    // The historical bug, reproduced: the scraper sets the fields, the call site drops them.
    const pool = [p(), p(), p()];
    const mangled = pool.map((c) => ({
      name: c.name, brand: c.brand, price: c.price, available: c.available, url: c.url, image: c.image,
    })) as StoreProduct[];
    let threw = false;
    try { assertPoolContract(mangled, "metro"); } catch (e) { threw = true; expect((e as Error).message.includes("rawPriceText")).toBeTruthy(); }
    expect(threw).toBeTruthy();
  });

  it("tolerates a few gaps but not a systematic loss", () => {
    const ok = [...Array(96)].map(() => p()).concat([...Array(4)].map(() => p({ rawPriceText: null })));
    expect(assertPoolContract(ok, "test").rawPriceTextPct >= MIN_RAW_PRICE_TEXT_PCT).toBeTruthy();

    const bad = [...Array(90)].map(() => p()).concat([...Array(10)].map(() => p({ rawPriceText: null })));
    let threw = false;
    try { assertPoolContract(bad, "test"); } catch { threw = true; }
    expect(threw).toBeTruthy();
  });

  it("does NOT enforce productUrl — flyer sources genuinely have no per-product link", () => {
    expect(assertPoolContract([p({ productUrl: null }), p({ productUrl: null })], "kaufland").productUrlPct).toBe(0);
  });

  it("an empty pool is not a contract violation (that is the drop-guard's job)", () => {
    expect(assertPoolContract([], "test").total).toBe(0);
  });
});

// The structural half. A test that only checks the runtime guard would let the re-mapping
// pattern creep back in everywhere except the one path the guard covers.
describe("pool contract — no scraper re-maps its pool at the matcher call", () => {
  const dir = join(process.cwd(), "scripts");
  const files = readdirSync(dir).filter((f) => f.startsWith("scrape-") && f.endsWith(".ts"))
    .map((f) => join(dir, f))
    .concat([join(dir, "adapters", "runner.ts")]);

  it("finds the scrapers", () => expect(files.length > 8).toBeTruthy());

  it("no file contains a pool.map() feeding the matcher", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/matchPoolToCatalog\([\s\S]{0,400}?pool\s*\.\s*map\s*\(/.test(src)) offenders.push(f.split(/[\\/]/).pop()!);
    }
    if (offenders.length) {
      throw new Error(
        `${offenders.length} scraper(s) re-map the pool at the matcher call, which is how ` +
        `productUrl and rawPriceText were silently dropped: ${offenders.join(", ")}. ` +
        `Build StoreProduct[] at the read site and pass the pool unmapped.`,
      );
    }
    expect(offenders.length).toBe(0);
  });

  it("every scraper that matches a pool also sets rawPriceText somewhere", () => {
    const missing: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (src.includes("matchPoolToCatalog(") && !src.includes("rawPriceText")) {
        missing.push(f.split(/[\\/]/).pop()!);
      }
    }
    if (missing.length) {
      throw new Error(`scraper(s) never set rawPriceText: ${missing.join(", ")}`);
    }
    expect(missing.length).toBe(0);
  });
});
