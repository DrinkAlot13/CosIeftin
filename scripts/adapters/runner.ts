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
import { parsePriceLei, parsePriceDetailed, baniToLei } from "../../src/lib/price/parsePrice";
import { ParseTally } from "../../src/lib/price/parseTally";
import { parseEan } from "../../src/lib/product/ean";
import type { Adapter, DomMap, JsonMap, Route } from "./types";

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

/** Turn a JSON payload into normalized store products. */
export function parseJsonPayload(raw: string, map: JsonMap, route: Route, ad: Adapter, tally?: ParseTally): StoreProduct[] {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  const arr = dig(data, map.items);
  if (!Array.isArray(arr)) return [];
  const out: StoreProduct[] = [];
  for (const it of arr) {
    const name = String(dig(it, map.name) ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    // null = ambiguous → skip the item rather than publish a wrong price
    const rawPrice = String(dig(it, map.price) ?? "");
    const det = parsePriceDetailed(rawPrice);
    const price = tally ? tally.record(rawPrice, det.priceBani) : det.priceBani;
    if (price == null) continue;
    let available = true;
    if (map.available) {
      const v = dig(it, map.available);
      const bad = map.unavailableWhen ?? [false, 0, "false", "out of stock", "OUT_OF_STOCK", "unavailable"];
      available = !bad.includes(v as string | number | boolean);
    }
    const p: StoreProduct = {
      name,
      brand: map.brand ? String(dig(it, map.brand) ?? "") : "",
      price: baniToLei(price),
      rawPriceText: rawPrice,
      rawSourceBlob: JSON.stringify(it).slice(0, 4096),
      referencePriceBani: det.referencePriceBani ?? null,
      referencePriceKind: det.referencePriceKind ?? null,
      available,
      url: map.link ? abs(ad.websiteUrl, String(dig(it, map.link) ?? "")) : ad.websiteUrl,
      productUrl: map.link ? abs(ad.websiteUrl, String(dig(it, map.link) ?? "")) : null,
      image: map.image ? (String(dig(it, map.image) ?? "") || null) : null,
      category: route.cat,
      ean: map.ean ? parseEan(String(dig(it, map.ean) ?? "")) || null : null,
      priceSource: ad.priceSource,
    };
    out.push(ad.refine ? ad.refine(p) : p);
  }
  return out;
}

/** Extract cards from a live page using a DOM map. Runs in the browser context. */
async function parseDom(page: Page, map: DomMap, route: Route, ad: Adapter, tally?: ParseTally): Promise<StoreProduct[]> {
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
    const price = tally ? tally.record(r.priceText, det.priceBani) : det.priceBani;
    if (price == null) continue;
    const p: StoreProduct = {
      name,
      brand: r.brand || "",
      price: baniToLei(price),
      rawPriceText: r.priceText,
      referencePriceBani: det.referencePriceBani ?? null,
      referencePriceKind: det.referencePriceKind ?? null,
      available: !r.unavailable,
      url: r.link ? abs(ad.websiteUrl, r.link) : ad.websiteUrl,
      productUrl: r.link ? abs(ad.websiteUrl, r.link) : null,
      image: r.img ? abs(ad.websiteUrl, r.img) : null,
      category: route.cat,
      ean: parseEan(r.ean) || null,
      priceSource: ad.priceSource,
    };
    out.push(ad.refine ? ad.refine(p) : p);
  }
  return out;
}

// ─── the runner ───────────────────────────────────────────────────────────────────

export async function runAdapter(ad: Adapter): Promise<void> {
  const delay = ad.delayMs ?? 1200;
  const maxPages = ad.maxPages ?? 1;
  const pool: StoreProduct[] = [];
  const seen = new Set<string>();
  const tally = new ParseTally(ad.name);
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
      const url = route.url.includes("{page}") ? route.url.replace("{page}", String(pg)) : route.url;
      if (pg > 1 && !route.url.includes("{page}")) break;
      let items: StoreProduct[] = [];
      try {
        if (ad.mode === "json") {
          const init: RequestInit = { headers: { "User-Agent": UA, Accept: "application/json", ...(ad.headers ?? {}) } };
          if (ad.body) { init.method = "POST"; init.body = ad.body.replace(/\{page\}/g, String(pg)); (init.headers as Record<string, string>)["Content-Type"] = "application/json"; }
          const res = await fetch(url, init);
          if (!res.ok) { if (pg === 1) console.log(`  ${url.slice(0, 60)} → HTTP ${res.status}`); break; }
          const raw = await res.text();
          saveFixture(ad.slug, `${(route.cat ?? "r")}-p${pg}`, raw);
          items = parseJsonPayload(raw, ad.json!, route, ad, tally);
        } else {
          await page!.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
          await page!.waitForSelector(ad.dom!.card, { timeout: 15000 }).catch(() => {});
          await page!.waitForTimeout(pg === 1 ? 3500 : 2000);
          if (process.env.FIXTURE_SAVE) saveFixture(ad.slug, `${(route.cat ?? "r")}-p${pg}`, await page!.content());
          items = await parseDom(page!, ad.dom!, route, ad, tally);
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
  tally.reportAndRaise();
  console.log(`Pooled ${pool.length} ${ad.name} products.`);
  if (pool.length === 0) {
    console.error(`[${ad.slug}] no products — refusing to touch the database.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const merchant = await prisma.merchant.upsert({
    where: { slug: ad.slug },
    update: { active: true, name: ad.name, websiteUrl: ad.websiteUrl, color: ad.color, storeType: ad.storeType ?? "online", priceSource: ad.priceSource ?? "shelf" },
    create: { slug: ad.slug, name: ad.name, websiteUrl: ad.websiteUrl, color: ad.color, storeType: ad.storeType ?? "online", priceSource: ad.priceSource ?? "shelf" },
  });
  const r = await matchPoolToCatalog(merchant.id, pool, { section: ad.section, addNew: ad.addNew ?? true });
  if (r.aborted) console.error(`\n${ad.name}: ABORTED — ${r.reason}`);
  else console.log(`\n${ad.name}: ${r.offers} offers (${r.created} new, ${r.flagged} flagged) from pool ${pool.length}.`);
  await prisma.$disconnect();
}
