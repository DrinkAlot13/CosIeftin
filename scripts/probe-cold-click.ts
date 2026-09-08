// WHAT A COLD CLICK ACTUALLY COSTS, in a real browser, on the server the owner browses.
//
// `verify:perf` measures `curl` against `next start`: server think-time only. A person's
// experience is a browser — HTML, then CSS, then every JS chunk, then hydration, then whatever
// the page fetches after that — and, in production, a SERVICE WORKER that intercepts all of it.
// Those two numbers can differ by an order of magnitude and the gap is not a mystery, it is
// everything curl does not do.
//
// Three passes per route, and the difference between them IS the finding:
//
//   COLD    a brand-new browser profile: no HTTP cache, no service worker, nothing precached.
//           This is a first-time visitor, and it is the slowest honest number.
//   WARM    same profile, second visit: HTTP cache and the service worker's static cache are
//           populated. This is a returning visitor.
//   SPA     an in-page click from the homepage, no document reload. This is what most
//           navigation on the site actually is.
//
//   npm run probe:cold

import { chromium, type Browser } from "playwright";

const BASE = process.env.PROBE_BASE ?? "http://localhost:3000";
const ROUTES = ["/", "/oferte", "/c/lapte", "/search?q=lapte", "/index-cosmic", "/lista", "/admin"];

type Timing = { route: string; cold: number; warm: number; swControlled: boolean; status: number; chunk404: number };

async function measure(browser: Browser, route: string): Promise<Timing> {
  // A FRESH CONTEXT IS A FRESH VISITOR: its own cache, its own service-worker registration.
  const ctx = await browser.newContext({ locale: "ro-RO", viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  let chunk404 = 0;
  page.on("response", (r) => { if (r.status() === 404 && r.url().includes("/_next/static/")) chunk404++; });

  const url = `${BASE}${route}`;
  const t0 = Date.now();
  const resp = await page.goto(url, { waitUntil: "load", timeout: 60_000 }).catch(() => null);
  const cold = Date.now() - t0;

  // Let the worker register and settle, then visit again from the same profile.
  await page.waitForTimeout(2500);
  const swControlled = await page.evaluate(() => !!navigator.serviceWorker?.controller).catch(() => false);

  const t1 = Date.now();
  await page.goto(url, { waitUntil: "load", timeout: 60_000 }).catch(() => null);
  const warm = Date.now() - t1;

  await ctx.close();
  return { route, cold, warm, swControlled, status: resp?.status() ?? 0, chunk404 };
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

  console.log("═".repeat(96));
  console.log(`A COLD CLICK, IN A BROWSER — ${BASE}`);
  console.log(`curl measures the server. This measures the visitor.`);
  console.log("═".repeat(96));
  console.log(`  ${"route".padEnd(20)} ${"status".padStart(6)} ${"COLD".padStart(8)} ${"WARM".padStart(8)} ${"sw?".padStart(5)} ${"chunk404".padStart(9)}`);

  const rows: Timing[] = [];
  for (const r of ROUTES) {
    const t = await measure(browser, r);
    rows.push(t);
    console.log(`  ${r.padEnd(20)} ${String(t.status).padStart(6)} ${(t.cold + "ms").padStart(8)} ${(t.warm + "ms").padStart(8)} ${(t.swControlled ? "yes" : "no").padStart(5)} ${String(t.chunk404).padStart(9)}`);
  }

  // ── An in-page click, which is what navigation on the site mostly is.
  const ctx = await browser.newContext({ locale: "ro-RO", viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60_000 }).catch(() => null);
  await page.waitForTimeout(2500);
  console.log(`\n  IN-PAGE CLICKS from the homepage (no document reload):`);
  for (const [label, sel] of [["Oferte", 'a[href="/oferte"]'], ["Lista", 'a[href="/lista"]']] as const) {
    const t0 = Date.now();
    const ok = await page.click(sel, { timeout: 8000 }).then(() => true).catch(() => false);
    if (!ok) { console.log(`    ${label.padEnd(10)} link not found on the homepage`); continue; }
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    console.log(`    ${label.padEnd(10)} ${Date.now() - t0}ms`);
    await page.goBack({ waitUntil: "load" }).catch(() => {});
    await page.waitForTimeout(600);
  }
  await ctx.close();
  await browser.close();

  const worstCold = rows.reduce((a, b) => (b.cold > a.cold ? b : a));
  const total404 = rows.reduce((a, b) => a + b.chunk404, 0);
  console.log(`\n  worst cold load: ${worstCold.route} at ${worstCold.cold}ms`);
  console.log(`  stale-chunk 404s across every route: ${total404}${total404 ? "  ← A STALE BUILD IS BEING SERVED" : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
