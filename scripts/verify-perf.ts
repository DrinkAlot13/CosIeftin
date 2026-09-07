// ── SCOPE: USER-FACING ────────────────────────────────────────────────────────
// A ROUTE THAT TAKES OVER A SECOND TO ANSWER IS A FAILURE, NOT A NOTE.
//
// This exists because "the site feels slow" went unmeasured for months while every test passed.
// Tests prove the answer is right. Nothing proved it arrived. /oferte was taking 6.4 seconds
// and /search 4.8, on a green build, and the only signal was a person clicking a link.
//
// Measures the REAL routes over HTTP against a REAL production build, because that is the only
// thing a visitor experiences. Not the query functions in isolation — those were fast while the
// pages were not, since most of the cost was the framework rendering rows nobody asked for.
//
// Boots its own `next start` on a spare port, so it needs a production build. A missing build
// fails loudly rather than skipping: a check that quietly skips is a check that quietly stopped
// checking.
//
// Run: npm run verify:perf   (part of verify:site)

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

const PORT = 3998;
const BASE = `http://localhost:${PORT}`;

/** The budget, in milliseconds of server response. Over this is a failure. */
const BUDGET_MS = 1000;

/** How many times each route is hit. The FIRST is discarded: it generates the page. */
const HITS = 3;

const ITEM = "/p/lapte-de-consum-integral-napolact-3-5-grasime-1-5-l-5941065015194";

const ROUTES: { name: string; path: string }[] = [
  { name: "homepage", path: "/" },
  { name: "category", path: "/c/lapte" },
  { name: "category (large)", path: "/c/branzeturi" },
  { name: "item", path: ITEM },
  { name: "search", path: "/search?q=lapte" },
  { name: "search (broad)", path: "/search?q=apa" },
  { name: "deals", path: "/oferte" },
  { name: "list", path: "/lista" },
  { name: "index", path: "/index-cosmic" },
  { name: "uncategorised", path: "/necategorisate" },
  { name: "category index", path: "/categorii" },
  { name: "department", path: "/c/lactate-oua" },
];

/** The server this run owns, so a failure takes it down instead of leaking the port. */
let owned: ChildProcess | null = null;

function killOwned(): void {
  if (owned?.pid == null) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${owned.pid} /T /F`, { stdio: "ignore" });
    else process.kill(-owned.pid, "SIGKILL");
  } catch { /* already gone */ }
}

function fail(msg: string): never {
  console.error(`  ✗ ${msg}`);
  killOwned();
  process.exit(1);
}

async function refuseIfPortBusy(): Promise<void> {
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(1500) });
  } catch {
    return;
  }
  fail(`something is already listening on :${PORT}. This must own its server or it is timing someone else's.`);
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail(`server did not come up on :${PORT}`);
}

async function time(path: string): Promise<{ ms: number; status: number; bytes: number }> {
  const t0 = Date.now();
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(60_000) });
  const body = await res.text();
  return { ms: Date.now() - t0, status: res.status, bytes: body.length };
}

async function main(): Promise<void> {
  console.log("\n════ ROUTE RESPONSE BUDGET ══════════════════════════════════════════════════");
  console.log(`  Every route must answer in under ${BUDGET_MS} ms. Measured over HTTP against a`);
  console.log(`  production build — the first hit of each route is discarded because it generates`);
  console.log(`  the page; a visitor to a warm site does not pay that, and a visitor to a cold one`);
  console.log(`  pays it once for everybody.\n`);

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

  try {
    await waitForServer();

    const failures: string[] = [];
    console.log(`  ${"ROUTE".padEnd(20)} ${"PATH".padEnd(34)} ${"first".padStart(8)} ${"best".padStart(8)} ${"HTML".padStart(9)}`);
    console.log(`  ${"-".repeat(84)}`);

    for (const r of ROUTES) {
      const runs: { ms: number; status: number; bytes: number }[] = [];
      for (let i = 0; i < HITS; i++) runs.push(await time(r.path));

      const bad = runs.find((x) => x.status !== 200);
      if (bad) {
        failures.push(`${r.path} returned HTTP ${bad.status}`);
        console.log(`  ${r.name.padEnd(20)} ${r.path.slice(0, 34).padEnd(34)} ${"HTTP " + bad.status}`);
        continue;
      }

      const first = runs[0].ms;
      const warm = Math.min(...runs.slice(1).map((x) => x.ms));
      const kb = Math.round(runs[runs.length - 1].bytes / 1024);
      const over = warm > BUDGET_MS;
      if (over) failures.push(`${r.path} answered in ${warm} ms, over the ${BUDGET_MS} ms budget`);
      console.log(
        `  ${over ? "✗" : " "}${r.name.padEnd(19)} ${r.path.slice(0, 34).padEnd(34)} ` +
        `${(first + "ms").padStart(8)} ${(warm + "ms").padStart(8)} ${(kb + "KB").padStart(9)}`,
      );
    }

    console.log("");
    if (failures.length > 0) {
      for (const f of failures) console.error(`  ✗ ${f}`);
      fail(`${failures.length} route(s) over budget. This is the check that would have caught /oferte.`);
    }
    console.log(`  ✓ all ${ROUTES.length} routes answered within ${BUDGET_MS} ms\n`);
  } finally {
    killOwned();
  }
}

main().catch((e) => { console.error(e); killOwned(); process.exit(1); });
