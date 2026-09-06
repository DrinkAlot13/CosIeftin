// ── SCOPE: USER-FACING ────────────────────────────────────────────────────────
// No page may render the offline fallback while the server is reachable.
//
// The service worker once did exactly that, on every page, persistently: it treated "this
// fetch failed" and "we are offline" as one fact, so a dead dev server, a moved port or a
// failed cache.put all rendered "Ești offline" to an online browser. This verifies the three
// states BY RENDERED OUTPUT, in a real browser with the real worker installed:
//
//   1. online   → five pages, none may contain the offline marker
//   2. offline  → the fallback appears, and its "Deschide lista" link works
//   3. online again → normal pages return, with NO manual unregistration
//
// Boots its own `next start` on a spare port, so it needs a production build. A missing build
// fails loudly rather than skipping: a site check that quietly skips is a check that quietly
// stops checking.
//
// Run: npm run verify:offline   (part of verify:site)

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const OFFLINE_MARKER = "Ești offline";
const PAGES = ["/", "/lista", "/oferte", "/necategorisate", "/c/lapte"];

function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`server did not come up on :${PORT}`);
}

async function main(): Promise<void> {
  console.log("\n════ OFFLINE FALLBACK — VERIFIED BY RENDERED OUTPUT ═════════════════════════");
  if (!existsSync(".next/BUILD_ID")) {
    fail("no production build (.next/BUILD_ID missing) — run `npm run build` first. Not skipped: a skipped check is a stopped one.");
  }

  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    shell: true,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "production" },
  });
  try {
    await waitForServer();
    const browser = await chromium.launch();
    // A persistent context is not needed; one context keeps the SW alive across the three states.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    // Install the worker and give it control (skipWaiting + clients.claim make this one visit).
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return { registered: Boolean(reg), controlling: Boolean(navigator.serviceWorker.controller) };
    });
    if (!sw.registered) fail("service worker did not register in production");
    // First load may not be controlled yet; reload once so the claimed worker handles navigations.
    await page.reload({ waitUntil: "load" });

    // ── 1. ONLINE: no page may show the fallback.
    for (const path of PAGES) {
      await page.goto(BASE + path, { waitUntil: "load" });
      const body = await page.evaluate(() => document.body.innerText);
      if (body.includes(OFFLINE_MARKER)) fail(`ONLINE page ${path} rendered the offline fallback`);
    }
    console.log(`  ✓ online: ${PAGES.length} pages, none rendered "${OFFLINE_MARKER}"`);

    // ── 2. OFFLINE: the fallback must appear, and its list link must work.
    await ctx.setOffline(true);
    await page.goto(`${BASE}/p/some-page-nobody-precached`, { waitUntil: "load" }).catch(() => {});
    const offlineBody = await page.evaluate(() => document.body.innerText);
    if (!offlineBody.includes(OFFLINE_MARKER)) fail(`OFFLINE navigation did not render the fallback (got: ${offlineBody.slice(0, 80)})`);
    const listLink = page.locator('a:has-text("Deschide lista")').first();
    if (!(await listLink.isVisible())) fail('offline fallback has no visible "Deschide lista" link');
    await listLink.click();
    await page.waitForTimeout(1200);
    const listBody = await page.evaluate(() => document.body.innerText);
    if (listBody.includes(OFFLINE_MARKER)) fail('"Deschide lista" led back to the offline page — /lista is not cached');
    console.log('  ✓ offline: fallback rendered, "Deschide lista" opened the cached list');

    // ── 3. BACK ONLINE: normal pages return without anyone unregistering anything.
    await ctx.setOffline(false);
    for (const path of PAGES.slice(0, 3)) {
      await page.goto(BASE + path, { waitUntil: "load" });
      const body = await page.evaluate(() => document.body.innerText);
      if (body.includes(OFFLINE_MARKER)) fail(`page ${path} still rendered the fallback AFTER coming back online`);
    }
    console.log("  ✓ back online: normal pages returned, no manual unregistration needed\n");

    await browser.close();
  } finally {
    // `shell: true` on Windows means server.pid is the cmd wrapper; kill the whole tree, or
    // the next-server keeps the port and the next run's waitForServer talks to a stale build —
    // the exact class of bug this script exists to catch.
    if (server.pid != null && process.platform === "win32") {
      spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
    } else {
      server.kill();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
