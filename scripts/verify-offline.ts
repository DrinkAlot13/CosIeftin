// ── SCOPE: USER-FACING ────────────────────────────────────────────────────────
// "The server is down" and "you are offline" must never render as the same page.
//
// The v1 service worker treated them as one fact: any navigation fetch failure rendered
// "Ești offline". So a dev server that had simply stopped showed an offline page to an online
// browser, on every route, persistently — and that has now misled a diagnosis five times in
// this project (the ChunkLoadError, two "old copy still rendering" confusions, the smoke-test
// noise, and this). The v2 worker distinguishes them. This verifies the distinction BY
// RENDERED OUTPUT, in a real browser, with the real worker installed.
//
// FIVE STATES, and the last two are the ones that matter most:
//
//   1. online, server up            → five pages, none may show any fallback
//   2. DevTools offline             → "Ești offline", and "Deschide lista" works
//   3. online again                 → normal pages, with NO manual unregistration
//   4. SERVER DEAD, browser online  → "Serverul nu răspunde", NOT "Ești offline",
//                                      and the worker logs it as a bug
//   5. SERVER DEAD, browser offline → "Ești offline"
//
// 4 and 5 are the whole point of v2 and were previously untested: the first version of this
// script only ever used DevTools offline mode, which is state 2. A fix verified only against
// the state it was not written for is not verified.
//
// Boots its own `next start` on a spare port, so it needs a production build. A missing build
// fails loudly rather than skipping: a site check that quietly skips is a check that quietly
// stopped checking.
//
// Run: npm run verify:offline   (part of verify:site)

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const OFFLINE_MARKER = "Ești offline";
const SERVER_DOWN_MARKER = "Serverul nu răspunde";
const PAGES = ["/", "/lista", "/oferte", "/necategorisate", "/c/lapte"];

/**
 * The server this run owns, so `fail()` can take it down with it.
 *
 * `fail()` calls process.exit, which SKIPS the finally block — so every failed run used to
 * leak a `next start` holding the port. The next run then spawned a second server that could
 * not bind, talked to the LEAKED one instead, and "killed the server" by killing a process
 * that never owned the port. State 4 then tested a live server and reported the v1 bug had
 * returned. That is the sixth time a stale server has produced a false diagnosis in this
 * project, and the first time inside the script written to prevent it.
 */
let owned: ChildProcess | null = null;

function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  if (owned?.pid != null) {
    // Synchronous, because process.exit will not wait for anything asynchronous.
    try {
      if (process.platform === "win32") execSync(`taskkill /pid ${owned.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-owned.pid, "SIGKILL");
    } catch { /* already gone */ }
  }
  process.exit(1);
}

/**
 * REFUSE TO RUN AGAINST SOMEONE ELSE'S SERVER.
 *
 * If the port already answers, this script cannot tell its own build from whatever is there —
 * and the whole point of it is to distinguish a live server from a dead one. Talking to a
 * stranger's process is how the previous run concluded the worker was broken when it was not.
 */
async function refuseIfPortBusy(): Promise<void> {
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(1500) });
  } catch {
    return; // nothing there — good
  }
  fail(
    `something is already listening on :${PORT}. This script must own its server, or it cannot ` +
    `tell "the server is down" from "a different server is up". Kill it and re-run.`,
  );
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

/**
 * Kill the whole process tree and WAIT until the port actually refuses connections.
 *
 * `shell: true` on Windows means the spawned pid is the cmd wrapper, not next-server, so
 * killing the pid alone leaves the real server holding the port. State 4 then tests nothing,
 * because the "dead" server is still answering — the same stale-server confusion this script
 * exists to make impossible.
 */
async function killServer(server: ChildProcess): Promise<void> {
  if (server.pid != null && process.platform === "win32") {
    spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
  } else {
    server.kill("SIGKILL");
  }
  for (let i = 0; i < 30; i++) {
    try {
      await fetch(BASE, { signal: AbortSignal.timeout(1000) });
    } catch {
      return; // refused — genuinely dead
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail("server would not die — state 4 would have tested a live server");
}

async function main(): Promise<void> {
  console.log("\n════ OFFLINE vs SERVER-DOWN — VERIFIED BY RENDERED OUTPUT ═══════════════════");
  if (!existsSync(".next/BUILD_ID")) {
    fail("no production build (.next/BUILD_ID missing) — run `npm run build` first. Not skipped: a skipped check is a stopped one.");
  }

  await refuseIfPortBusy();

  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    shell: true,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "production" },
  });
  owned = server;
  let killed = false;
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    // Install the worker and give it control (skipWaiting + clients.claim make this one visit).
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const registered = await page.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration()));
    if (!registered) fail("service worker did not register in production");
    await page.reload({ waitUntil: "load" });

    // ── 1. ONLINE, SERVER UP.
    for (const path of PAGES) {
      await page.goto(BASE + path, { waitUntil: "load" });
      const body = await page.evaluate(() => document.body.innerText);
      if (body.includes(OFFLINE_MARKER)) fail(`ONLINE page ${path} rendered the offline fallback`);
      if (body.includes(SERVER_DOWN_MARKER)) fail(`ONLINE page ${path} rendered the server-down page`);
    }
    console.log(`  ✓ 1. online, server up: ${PAGES.length} pages, no fallback of either kind`);

    // ── 2. DEVTOOLS OFFLINE.
    await ctx.setOffline(true);
    await page.goto(`${BASE}/p/never-precached-a`, { waitUntil: "load" }).catch(() => {});
    let body = await page.evaluate(() => document.body.innerText);
    if (!body.includes(OFFLINE_MARKER)) fail(`OFFLINE navigation did not render the offline page (got: ${body.slice(0, 80)})`);
    const listLink = page.locator('a:has-text("Deschide lista")').first();
    if (!(await listLink.isVisible())) fail('offline fallback has no visible "Deschide lista" link');
    await listLink.click();
    await page.waitForTimeout(1200);
    if ((await page.evaluate(() => document.body.innerText)).includes(OFFLINE_MARKER)) {
      fail('"Deschide lista" led back to the offline page — /lista is not cached');
    }
    console.log('  ✓ 2. browser offline: "Ești offline", and "Deschide lista" opened the cached list');

    // ── 3. BACK ONLINE.
    await ctx.setOffline(false);
    for (const path of PAGES.slice(0, 3)) {
      await page.goto(BASE + path, { waitUntil: "load" });
      if ((await page.evaluate(() => document.body.innerText)).includes(OFFLINE_MARKER)) {
        fail(`page ${path} still rendered the offline fallback AFTER coming back online`);
      }
    }
    console.log("  ✓ 3. back online: normal pages returned, no manual unregistration needed");

    // ── 4. SERVER DEAD, BROWSER ONLINE. The state v2 exists for.
    await killServer(server);
    killed = true;
    // A goto that THROWS leaves the PREVIOUS document in place, and reading document.body then
    // reports the old page as if it were the result. Capture the failure instead of swallowing it.
    let gotoErr = "";
    const resp = await page
      .goto(`${BASE}/p/never-precached-b`, { waitUntil: "load" })
      .catch((e: unknown) => { gotoErr = String(e).slice(0, 120); return null; });
    if (gotoErr) fail(`SERVER DOWN navigation threw instead of being handled by the worker: ${gotoErr}`);
    if (resp && resp.status() !== 502) {
      fail(`SERVER DOWN navigation returned HTTP ${resp.status()} — the server is not actually down`);
    }
    body = await page.evaluate(() => document.body.innerText);
    const stillOnline = await page.evaluate(() => navigator.onLine);
    if (!stillOnline) fail("browser reported itself offline while only the server was down — cannot test state 4");
    if (body.includes(OFFLINE_MARKER)) {
      fail(`SERVER DOWN but browser ONLINE rendered "${OFFLINE_MARKER}" — this is the v1 bug`);
    }
    if (!body.includes(SERVER_DOWN_MARKER)) {
      fail(`SERVER DOWN did not render "${SERVER_DOWN_MARKER}" (got: ${body.slice(0, 90)})`);
    }
    // The worker must REPORT ITSELF, and the report has to be somewhere observable. A service
    // worker's console.error lands in the WORKER's context, not the page's — invisible here and
    // easy to miss in DevTools — so v2 stamps the diagnostic into the response it returns.
    const diagnostic = await page.evaluate(
      () => document.querySelector('meta[name="sw-diagnostic"]')?.getAttribute("content") ?? null,
    );
    if (diagnostic !== "server-down-while-online") {
      fail(`the worker served the server-down page without stamping its diagnostic (got: ${diagnostic})`);
    }
    console.log(`  ✓ 4. server dead, browser online: "${SERVER_DOWN_MARKER}", not the offline page`);
    console.log(`       502, and the worker stamped itself: sw-diagnostic="${diagnostic}"`);

    // ── 5. SERVER DEAD AND BROWSER OFFLINE. Now the offline page IS the truth.
    await ctx.setOffline(true);
    await page.goto(`${BASE}/p/never-precached-c`, { waitUntil: "load" }).catch(() => {});
    body = await page.evaluate(() => document.body.innerText);
    if (!body.includes(OFFLINE_MARKER)) {
      fail(`genuinely offline did not render "${OFFLINE_MARKER}" (got: ${body.slice(0, 90)})`);
    }
    console.log(`  ✓ 5. server dead AND browser offline: "${OFFLINE_MARKER}" — the two states are distinct\n`);

    await browser.close();
  } finally {
    if (!killed) await killServer(server).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
