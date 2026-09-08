// ── SCOPE: RENDERED-PAGE AUDIT ────────────────────────────────────────────────
// CRAWL THE SITE AS A BROWSER, not as a query. READ-ONLY.
//
// Every check we own reads the database or the source. This one reads what a person sees:
// the HTTP status, the time to first byte and to a finished page, whatever the console says,
// every request the page made that failed, and whether the rendered TEXT contains any of the
// values that mean a computation went wrong — NaN, undefined, Infinity, an empty price.
//
// That last one matters more than it looks. `{price.toFixed(2)}` on a null renders "NaN" and
// nothing throws; a component that maps over an absent array renders nothing and nothing
// throws. Neither is visible to a test that checks HTTP 200, and both are visible here.
//
//   npm run audit:crawl                      the fixed routes
//   npm run audit:crawl -- --products=200 --categories=50 --searches=30
//   npm run audit:crawl -- --json logs/crawl.json

import { PrismaClient } from "@prisma/client";
import { chromium, type Browser, type ConsoleMessage } from "playwright";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const BASE = process.env.AUDIT_BASE ?? "http://localhost:3000";

/** Values that mean a computation produced nothing and rendered it anyway. */
const POISON = [
  { re: /\bNaN\b/, name: "NaN" },
  { re: /\bundefined\b/, name: "undefined" },
  { re: /\bInfinity\b/, name: "Infinity" },
  { re: /\[object Object\]/, name: "[object Object]" },
  // "null" as a standalone word in visible text. Romanian has no such word, so any hit is ours.
  { re: /(^|\s)null(\s|$|,|\.)/, name: "null" },
];

/** A price that rendered with no number in it. */
const EMPTY_PRICE = /(?:RON|lei)\s*(?:$|[^0-9])|(?:^|\s)(?:—|-)\s*(?:RON|lei)/;

type Result = {
  path: string;
  kind: string;
  status: number;
  ttfbMs: number;
  loadMs: number;
  consoleErrors: string[];
  hydration: string[];
  pageErrors: string[];
  failedRequests: string[];
  badResponses: string[];
  poison: string[];
  emptyPrice: boolean;
  textLen: number;
};

async function visit(browser: Browser, path: string, kind: string): Promise<Result> {
  const ctx = await browser.newContext({ locale: "ro-RO", viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  const hydration: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const badResponses: string[] = [];

  page.on("console", (m: ConsoleMessage) => {
    const t = m.text();
    if (/hydrat|did not match|Text content does not match/i.test(t)) hydration.push(t.slice(0, 300));
    else if (m.type() === "error") consoleErrors.push(t.slice(0, 300));
  });
  page.on("pageerror", (e) => pageErrors.push(`${e.name}: ${e.message}`.slice(0, 300)));
  page.on("requestfailed", (r) => {
    // RSC prefetches are aborted by design when the browser moves on; not a defect.
    if (r.url().includes("_rsc=")) return;
    failedRequests.push(`${r.url().replace(BASE, "")} — ${r.failure()?.errorText ?? "?"}`);
  });
  page.on("response", (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().replace(BASE, "")}`); });

  const t0 = Date.now();
  let ttfbMs = 0;
  const resp = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
  ttfbMs = Date.now() - t0;
  await page.waitForLoadState("load", { timeout: 30_000 }).catch(() => {});
  const loadMs = Date.now() - t0;
  // A moment for client components to render; a poison value often appears only after hydration.
  await page.waitForTimeout(900);

  const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
  const poison = POISON.filter((p) => p.re.test(text)).map((p) => p.name);
  const emptyPrice = EMPTY_PRICE.test(text);

  await ctx.close();
  return {
    path, kind, status: resp?.status() ?? 0, ttfbMs, loadMs,
    consoleErrors, hydration, pageErrors, failedRequests, badResponses,
    poison, emptyPrice, textLen: text.length,
  };
}

async function main(): Promise<void> {
  const num = (k: string, d: number) => Number((process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split("=")[1]);
  const nProducts = num("products", 200);
  const nCategories = num("categories", 50);
  const nSearches = num("searches", 30);

  const STATIC_ROUTES = [
    "/", "/oferte", "/categorii", "/lista", "/retete", "/carduri", "/favorite", "/alerte",
    "/cont", "/login", "/index-cosmic", "/shrinkflation", "/despre", "/metodologie",
    "/termeni", "/confidentialitate", "/alcool", "/cosmetice", "/farmacie", "/dcneu",
    "/necategorisate", "/robots.txt", "/sitemap.xml",
  ];
  const ADMIN_ROUTES = [
    "/admin", "/admin/stats", "/admin/health", "/admin/matches", "/admin/matches/stats",
    "/admin/anomalies", "/admin/review",
  ];

  const live = {
    merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
    NOT: { priceSource: "DELIVERY_PLATFORM" },
    lastObservedAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
  } as const;

  // Sample WIDELY rather than by id order: an audit that only ever reads the first 200 rows
  // tests the oldest data, which is the least likely to be broken by anything recent.
  const allProducts = await prisma.product.findMany({
    where: { offers: { some: live } }, select: { slug: true }, orderBy: { id: "asc" },
  });
  const step = Math.max(1, Math.floor(allProducts.length / nProducts));
  const products = allProducts.filter((_, i) => i % step === 0).slice(0, nProducts);

  const cats = await prisma.category.findMany({ select: { slug: true }, orderBy: { id: "asc" } });
  const cstep = Math.max(1, Math.floor(cats.length / nCategories));
  const categories = cats.filter((_, i) => i % cstep === 0).slice(0, nCategories);

  const TERMS = [
    "lapte", "paine", "oua", "unt", "zahar", "faina", "ulei", "apa", "cafea", "bere",
    "ciocolata", "iaurt", "branza", "cascaval", "sunca", "pui", "porc", "rosii", "cartofi",
    "mere", "banane", "detergent", "sampon", "pasta de dinti", "hartie igienica",
    "illy", "qwertyuiop", "", "   ", "lapte 3.5",
  ].slice(0, nSearches);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const results: Result[] = [];

  const run = async (paths: string[], kind: string) => {
    for (const p of paths) {
      const r = await visit(browser, p, kind);
      results.push(r);
      const flags = [
        r.status >= 400 ? `HTTP ${r.status}` : "",
        r.pageErrors.length ? `${r.pageErrors.length} exception` : "",
        r.hydration.length ? `${r.hydration.length} hydration` : "",
        r.consoleErrors.length ? `${r.consoleErrors.length} console` : "",
        r.badResponses.length ? `${r.badResponses.length} bad-req` : "",
        r.poison.length ? `POISON ${r.poison.join(",")}` : "",
        r.loadMs > 1000 ? `SLOW ${r.loadMs}ms` : "",
      ].filter(Boolean).join(" · ");
      if (flags) console.log(`  ${r.status} ${String(r.loadMs).padStart(5)}ms  ${p.slice(0, 58).padEnd(58)} ${flags}`);
    }
    console.log(`  ── ${kind}: ${paths.length} pages done`);
  };

  console.log("═".repeat(104));
  console.log(`RENDERED CRAWL — ${BASE}`);
  console.log(`Only pages with something to report are printed. Totals at the end.`);
  console.log("═".repeat(104));

  await run(STATIC_ROUTES, "static");
  await run(ADMIN_ROUTES, "admin");
  await run(categories.map((c) => `/c/${c.slug}`), "category");
  await run(TERMS.map((t) => `/search?q=${encodeURIComponent(t)}`), "search");
  await run(products.map((p) => `/p/${p.slug}`), "product");

  await browser.close();

  // ── SUMMARY, grouped by CAUSE rather than by page.
  const withException = results.filter((r) => r.pageErrors.length);
  const withHydration = results.filter((r) => r.hydration.length);
  const withPoison = results.filter((r) => r.poison.length);
  const withBad = results.filter((r) => r.badResponses.length);
  const slow = results.filter((r) => r.loadMs > 1000);
  const errored = results.filter((r) => r.status >= 400 || r.status === 0);
  const emptyPrice = results.filter((r) => r.emptyPrice);

  console.log(`\n${"═".repeat(104)}\nSUMMARY — ${results.length} pages crawled\n${"═".repeat(104)}`);
  console.log(`  HTTP >= 400 or unreachable      ${errored.length}`);
  console.log(`  uncaught client exceptions      ${withException.length}`);
  console.log(`  hydration warnings              ${withHydration.length}`);
  console.log(`  console errors                  ${results.filter((r) => r.consoleErrors.length).length}`);
  console.log(`  failed sub-requests (non-RSC)   ${withBad.length}`);
  console.log(`  rendered NaN/undefined/null/…   ${withPoison.length}`);
  console.log(`  a price rendered with no number ${emptyPrice.length}`);
  console.log(`  slower than 1s to load          ${slow.length}`);

  const show = (label: string, rows: Result[], f: (r: Result) => string) => {
    if (!rows.length) return;
    console.log(`\n── ${label} ──`);
    for (const r of rows.slice(0, 25)) console.log(`  ${r.path.slice(0, 62).padEnd(62)} ${f(r)}`);
    if (rows.length > 25) console.log(`  … and ${rows.length - 25} more`);
  };
  show("HTTP errors", errored, (r) => `HTTP ${r.status}`);
  show("uncaught exceptions", withException, (r) => r.pageErrors[0]);
  show("hydration", withHydration, (r) => r.hydration[0].slice(0, 90));
  show("rendered poison values", withPoison, (r) => r.poison.join(", "));
  show("failed sub-requests", withBad, (r) => r.badResponses.slice(0, 2).join(" · "));
  show("slowest", [...slow].sort((a, b) => b.loadMs - a.loadMs), (r) => `${r.loadMs}ms (ttfb ${r.ttfbMs}ms)`);

  emitJson({ crawled: results.length, results, pass: errored.length === 0 && withException.length === 0 });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
