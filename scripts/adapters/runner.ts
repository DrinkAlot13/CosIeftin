// Shared adapter pipeline: fetch → parse → normalize → validate → match.
// Every declarative store runs through here, so a fix lands for all of them at once.
//
// Fixtures: set FIXTURE_SAVE=1 to write each raw response to tests/fixtures/<slug>/,
// which makes the parse stage testable offline (no network in tests).
import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../../src/lib/db";
import { matchPoolToCatalog, type StoreProduct } from "../../src/lib/scrape-util";
import { recordScraperRun } from "../../src/lib/scraper-run";
import { toPriceSource } from "../../src/lib/price-source";
import { parsePriceLei, parsePriceDetailed, baniToLei } from "../../src/lib/price/parsePrice";
import { ParseTally } from "../../src/lib/price/parseTally";
import { parseEan } from "../../src/lib/product/ean";
import type { Adapter, DomMap, JsonMap, Route } from "./types";

// No request may hang forever. `fetch` waits on a stalled connection indefinitely, and one
// such socket in the DCNeu detail pass stopped the whole nightly dead at 5,500 of 6,034
// products with the process using zero CPU — and because scrape-all runs stores in sequence,
// the three stores queued behind it never ran at all. Nothing crashed, so nothing reported it.
const REQUEST_TIMEOUT_MS = 20_000;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FIXTURE_DIR = join(process.cwd(), "tests", "fixtures");

function saveFixture(slug: string, key: string, body: string) {
  if (!process.env.FIXTURE_SAVE) return;
  const dir = join(FIXTURE_DIR, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.txt`), body, "utf8");
}

/** Read a dot path ("results.0.hits") out of an object. */
/** Does this route template ask to be walked more than once? */
const PAGED = /\{page\}|\{from\}|\{to\}/;

/**
 * Substitute the pagination tokens for the pg-th request (pg is 1-based).
 *
 * {page} is the page number. {from}/{to} are INCLUSIVE row offsets, which is what VTEX's
 * catalog_system search takes — page 1 is _from=0&_to=49. Auchan is VTEX, and so are several
 * other Romanian retailers, so this belongs in the runner rather than in one adapter.
 */
export function pageUrl(template: string, pg: number, pageSize?: number): string {
  let u = template.replace(/\{page\}/g, String(pg));
  if (/\{from\}|\{to\}/.test(template)) {
    if (!pageSize || pageSize < 1) throw new Error("a route using {from}/{to} needs adapter.pageSize");
    const from = (pg - 1) * pageSize;
    u = u.replace(/\{from\}/g, String(from)).replace(/\{to\}/g, String(from + pageSize - 1));
  }
  return u;
}

export function dig(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc == null) return undefined;
    if (Array.isArray(acc)) return acc[Number(k)];
    return (acc as Record<string, unknown>)[k];
  }, obj);
}

function abs(base: string, u: string): string {
  if (!u) return base;
  if (u.startsWith("http")) return u;
  return base.replace(/\/$/, "") + (u.startsWith("/") ? u : "/" + u);
}

// ─── pure parse stages (unit-testable against fixtures, no network) ────────────────

/**
 * How often each mapped FIELD actually yielded a value across a run.
 *
 * A selector or JSON path that matches nothing looks EXACTLY like a field the page does not
 * have. That confusion is expensive: `doseTokens()` carried a regex that could never match,
 * and the only reason anyone found it was a hygiene check looking for a stray control
 * character. A field map deserves the same treatment — measure it, do not assume it.
 *
 * Zero is not automatically a bug (Kaufland genuinely publishes no EAN), but zero is the only
 * state worth looking at, and nothing was reporting it.
 */
export class FieldCoverage {
  private readonly hits = new Map<string, number>();
  private items = 0;

  note(field: string, got: boolean): void {
    if (!this.hits.has(field)) this.hits.set(field, 0);
    if (got) this.hits.set(field, (this.hits.get(field) ?? 0) + 1);
  }

  countItem(): void {
    this.items++;
  }

  report(label: string): void {
    if (this.items === 0) return;
    const rows = [...this.hits.entries()].sort((a, b) => b[1] - a[1]);
    const line = rows
      .map(([f, n]) => `${f}=${((n / this.items) * 100).toFixed(0)}%${n === 0 ? " ⚠" : ""}`)
      .join("  ");
    console.log(`  field coverage (${label}, ${this.items} items): ${line}`);
    const dead = rows.filter(([, n]) => n === 0).map(([f]) => f);
    if (dead.length > 0) {
      console.log(
        `    ⚠ extracted NOTHING all run: ${dead.join(", ")} — a dead selector and an absent ` +
        `field look identical, so check the map before assuming the page lacks it.`,
      );
    }
  }
}

/** Turn a JSON payload into normalized store products. */
export function parseJsonPayload(raw: string, map: JsonMap, route: Route, ad: Adapter, tally?: ParseTally, cov?: FieldCoverage): StoreProduct[] {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  const arr = dig(data, map.items);
  if (!Array.isArray(arr)) return [];
  const out: StoreProduct[] = [];
  for (const it of arr) {
    const name = String(dig(it, map.name) ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;

    // AVAILABILITY IS READ BEFORE THE PRICE, and the order is the point.
    //
    // VTEX writes Price: 0 for anything not currently sellable — 17.3% of Auchan's catalog,
    // and across 304 sampled products Price===0 and IsAvailable===false agreed every single
    // time, with no exceptions in either direction. Parsing first made every one of those a
    // "null price" and tripped the 5% tripwire on a perfectly healthy run.
    //
    // An item its own store says is unavailable is a legitimate skip, so it is counted as
    // one — but counted, and bounded by its own threshold, because "everything is
    // unavailable" is what a broken availability read also looks like.
    let available = true;
    if (map.available) {
      const v = dig(it, map.available);
      const bad = map.unavailableWhen ?? [false, 0, "false", "out of stock", "OUT_OF_STOCK", "unavailable"];
      available = !bad.includes(v as string | number | boolean);
    }

    // null = ambiguous → skip the item rather than publish a wrong price
    const rawPrice = String(dig(it, map.price) ?? "");
    const det = parsePriceDetailed(rawPrice);
    if (det.priceBani == null && !available) {
      tally?.recordUnavailable();
      continue;
    }
    const price = tally ? tally.record(rawPrice, det.priceBani) : det.priceBani;
    // NOT a `continue`. An unparseable price is a REFUSAL, and refusals are recorded rather
    // than dropped — the item goes into the pool carrying price 0, and matchPoolToCatalog
    // records it as a pre-offer refusal with its rawPriceText intact. It still never becomes
    // an offer, and the 5% tripwire above still counts it, so nothing is weakened; what
    // changes is that the exact string that could not be read survives the run instead of
    // vanishing beyond ParseTally's 20 samples.
    const p: StoreProduct = {
      name,
      brand: map.brand ? String(dig(it, map.brand) ?? "") : "",
      price: price == null ? 0 : baniToLei(price),
      rawPriceText: rawPrice,
      rawSourceBlob: JSON.stringify(it).slice(0, 4096),
      referencePriceBani: det.referencePriceBani ?? null,
      referencePriceKind: det.referencePriceKind ?? null,
      available,
      url: map.link ? abs(ad.websiteUrl, String(dig(it, map.link) ?? "")) : ad.websiteUrl,
      productUrl: map.link ? abs(ad.websiteUrl, String(dig(it, map.link) ?? "")) : null,
      image: map.image ? (String(dig(it, map.image) ?? "") || null) : null,
      category: route.cat,
      // The route IS a merchant category listing — that is how these products were found.
      categoryPath: route.cat ?? null,
      ean: map.ean ? parseEan(String(dig(it, map.ean) ?? "")) || null : null,
      priceSource: toPriceSource(ad.priceChannel),
    };
    if (cov) {
      cov.countItem();
      cov.note("name", p.name.length > 0);
      cov.note("price", p.price > 0);
      cov.note("rawPriceText", (p.rawPriceText ?? "").length > 0);
      cov.note("url", p.url.length > 0);
      if (map.image) cov.note("image", (p.image ?? "").length > 0);
      if (map.link) cov.note("productUrl", (p.productUrl ?? "").length > 0);
      if (map.brand) cov.note("brand", p.brand.length > 0);
      if (map.ean) cov.note("ean", (p.ean ?? "").length > 0);
      if (map.available) cov.note("available-read", true);
    }
    out.push(ad.refine ? ad.refine(p) : p);
  }
  return out;
}

/** Extract cards from a live page using a DOM map. Runs in the browser context. */
async function parseDom(page: Page, map: DomMap, route: Route, ad: Adapter, tally?: ParseTally, cov?: FieldCoverage): Promise<StoreProduct[]> {
  const rows = await page.$$eval(map.card, (els, m) => {
    const pick = (el: Element, sels: string[] | undefined): string => {
      if (!sels) return "";
      for (const s of sels) {
        const n = el.querySelector(s);
        const v = (n?.textContent || "").replace(/\s+/g, " ").trim();
        if (v) return v;
      }
      return "";
    };
    const pickAttr = (el: Element, sel: string, attr: string): string => {
      const n = sel ? el.querySelector(sel) : el;
      return (n?.getAttribute(attr) || "").trim();
    };
    const mm = m as DomMap;
    return els.map((el) => {
      const nameAttr = mm.name.map((s) => el.querySelector(s)?.getAttribute("title") || "").find(Boolean) || "";
      const img = mm.image ? mm.image.map((s) => el.querySelector(s)?.getAttribute("src") || el.querySelector(s)?.getAttribute("data-src") || "").find(Boolean) || "" : "";
      const link = mm.link ? mm.link.map((s) => el.querySelector(s)?.getAttribute("href") || "").find(Boolean) || "" : "";
      const brand = mm.brand ? mm.brand.map((b) => pickAttr(el, b.sel, b.attr)).find(Boolean) || "" : "";
      const ean = mm.ean ? mm.ean.map((b) => pickAttr(el, b.sel, b.attr)).find(Boolean) || "" : "";
      const priceText = mm.priceAttr ? pickAttr(el, mm.priceAttr.sel, mm.priceAttr.attr) : pick(el, mm.price);
      let unavailable = false;
      if (mm.unavailable) unavailable = pickAttr(el, mm.unavailable.sel, mm.unavailable.attr) === mm.unavailable.equals;
      return { name: nameAttr || pick(el, mm.name), priceText, img, link, brand, ean, unavailable };
    });
  }, map as unknown as Record<string, unknown>);

  const out: StoreProduct[] = [];
  for (const r of rows) {
    const name = String(r.name || "").trim();
    if (!name) continue;
    const det = parsePriceDetailed(r.priceText);
    // Same rule as the JSON path: an unparseable price is refused and RECORDED, not dropped.
    const price = tally ? tally.record(r.priceText, det.priceBani) : det.priceBani;
    const p: StoreProduct = {
      name,
      brand: r.brand || "",
      price: price == null ? 0 : baniToLei(price),
      rawPriceText: r.priceText,
      referencePriceBani: det.referencePriceBani ?? null,
      referencePriceKind: det.referencePriceKind ?? null,
      available: !r.unavailable,
      url: r.link ? abs(ad.websiteUrl, r.link) : ad.websiteUrl,
      productUrl: r.link ? abs(ad.websiteUrl, r.link) : null,
      image: r.img ? abs(ad.websiteUrl, r.img) : null,
      category: route.cat,
      // The route IS a merchant category listing — that is how these products were found.
      categoryPath: route.cat ?? null,
      ean: parseEan(r.ean) || null,
      priceSource: toPriceSource(ad.priceChannel),
    };
    if (cov) {
      cov.countItem();
      cov.note("name", p.name.length > 0);
      cov.note("price", p.price > 0);
      cov.note("rawPriceText", (p.rawPriceText ?? "").length > 0);
      if (map.image) cov.note("image", (p.image ?? "").length > 0);
      if (map.link) cov.note("productUrl", (p.productUrl ?? "").length > 0);
      if (map.brand) cov.note("brand", p.brand.length > 0);
      if (map.ean) cov.note("ean", (p.ean ?? "").length > 0);
      if (map.unavailable) cov.note("unavailable-read", true);
    }
    out.push(ad.refine ? ad.refine(p) : p);
  }
  return out;
}

// ─── the runner ───────────────────────────────────────────────────────────────────

export async function runAdapter(ad: Adapter): Promise<void> {
  const startedAt = new Date();
  const delay = ad.delayMs ?? 1200;
  const maxPages = ad.maxPages ?? 1;
  const pool: StoreProduct[] = [];
  const seen = new Set<string>();
  const tally = new ParseTally(ad.name);
  const coverage = new FieldCoverage();
  let browser: Browser | null = null;
  let page: Page | null = null;

  if (ad.mode === "dom") {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const ctx = await browser.newContext({ userAgent: UA, locale: "ro-RO", viewport: { width: 1366, height: 900 } });
    page = await ctx.newPage();
    // tsx/esbuild helper shim — some bundled page scripts expect __name to exist
    await page.addInitScript(() => { (globalThis as unknown as { __name: (f: unknown) => unknown }).__name = (f) => f; });
  }

  for (const route of ad.routes) {
    let added = 0;
    for (let pg = 1; pg <= maxPages; pg++) {
      const url = pageUrl(route.url, pg, ad.pageSize);
      if (pg > 1 && !PAGED.test(route.url)) break;
      let items: StoreProduct[] = [];
      try {
        if (ad.mode === "json") {
          const init: RequestInit = { headers: { "User-Agent": UA, Accept: "application/json", ...(ad.headers ?? {}) } };
          if (ad.body) { init.method = "POST"; init.body = ad.body.replace(/\{page\}/g, String(pg)); (init.headers as Record<string, string>)["Content-Type"] = "application/json"; }
          const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
          if (!res.ok) { if (pg === 1) console.log(`  ${url.slice(0, 60)} → HTTP ${res.status}`); break; }
          const raw = await res.text();
          saveFixture(ad.slug, `${(route.cat ?? "r")}-p${pg}`, raw);
          items = parseJsonPayload(raw, ad.json!, route, ad, tally, coverage);
        } else {
          await page!.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
          await page!.waitForSelector(ad.dom!.card, { timeout: 15000 }).catch(() => {});
          await page!.waitForTimeout(pg === 1 ? 3500 : 2000);
          if (process.env.FIXTURE_SAVE) saveFixture(ad.slug, `${(route.cat ?? "r")}-p${pg}`, await page!.content());
          items = await parseDom(page!, ad.dom!, route, ad, tally, coverage);
        }
      } catch (e) {
        console.log(`  ${url.slice(0, 55)} error: ${(e as Error).message.slice(0, 50)}`);
        break;
      }
      if (items.length === 0) break;
      let pageAdded = 0;
      for (const it of items) {
        const key = `${it.url}|${it.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pool.push(it);
        pageAdded++; added++;
      }
      if (pageAdded === 0) break;
      await sleep(delay);
    }
    console.log(`  ${(route.cat ?? route.url.slice(-28)).padEnd(26)} +${added} (pool ${pool.length})`);
  }
  if (browser) await browser.close();

  // A run that could not READ most of its prices is not a run with fewer products —
  // it is a broken selector. Raise rather than write thin data.
  coverage.report(ad.slug);
  tally.reportAndRaise();
  console.log(`Pooled ${pool.length} ${ad.name} products.`);
  if (pool.length === 0) {
    // REFUSING TO WRITE OFFERS IS RIGHT. REFUSING TO RECORD THE FAILURE IS NOT.
    //
    // Penny found 0 products on 2026-09-02 and exited here, so no ScraperRun row existed and
    // nothing in the run ledger knew it had failed. The stored offers stayed live and correct,
    // and the only signal left was the 48-hour silence clock — a day and a half after the
    // scraper actually broke. That is the Metro/Mega failure exactly: correct data and a
    // silent absence, with every correctness check still green.
    //
    // So the run is recorded as aborted with its reason. The offers are still untouched.
    const dead = await prisma.merchant.findUnique({ where: { slug: ad.slug }, select: { id: true, lastOfferCount: true } });
    if (dead) {
      await recordScraperRun({
        merchantId: dead.id, startedAt, aborted: true,
        abortReason: "0 products pooled — scraper read nothing",
        previousRunCount: dead.lastOfferCount ?? 0,
      });
    }
    console.error(`[${ad.slug}] no products — refusing to touch the database (run recorded as aborted).`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const merchant = await prisma.merchant.upsert({
    where: { slug: ad.slug },
    update: { active: true, name: ad.name, websiteUrl: ad.websiteUrl, color: ad.color, storeType: ad.storeType ?? "online", priceChannel: ad.priceChannel ?? "shelf" },
    create: { slug: ad.slug, name: ad.name, websiteUrl: ad.websiteUrl, color: ad.color, storeType: ad.storeType ?? "online", priceChannel: ad.priceChannel ?? "shelf" },
  });
  const r = await matchPoolToCatalog(merchant.id, pool, { section: ad.section, addNew: ad.addNew ?? true, label: ad.slug ?? ad.section });
  if (r.aborted) console.error(`\n${ad.name}: ABORTED — ${r.reason}`);
  else console.log(`\n${ad.name}: ${r.offers} offers (${r.created} new, ${r.flagged} flagged) from pool ${pool.length}.`);
  await prisma.$disconnect();
}
