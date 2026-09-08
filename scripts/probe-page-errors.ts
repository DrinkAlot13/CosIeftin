// What does the BROWSER actually say when a page fails? READ-ONLY.
//
// "Application error: a client-side exception has occurred" is Next's way of saying an
// exception escaped React on the client. The message on the page is deliberately empty — the
// real one is in the console, and guessing at it from the server logs is how you fix the wrong
// thing. This opens the page in a real browser and captures everything it says.
//
//   npm run probe:page -- /admin
//   npm run probe:page -- /admin /admin/stats --wait=12000

import { chromium, type ConsoleMessage } from "playwright";

const BASE = process.env.PROBE_BASE ?? "http://localhost:3000";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const paths = argv.filter((a) => !a.startsWith("--"));
  const wait = Number((argv.find((a) => a.startsWith("--wait=")) ?? "--wait=9000").split("=")[1]);
  if (paths.length === 0) paths.push("/admin");

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ locale: "ro-RO", viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();

  // /admin REDIRECTS TO LOGIN when signed out, and the login page renders fine — so an
  // unauthenticated probe reports a healthy /admin while the real one is broken. Sign in first
  // when credentials are available.
  const email = process.env.PROBE_EMAIL;
  const password = process.env.PROBE_PASSWORD;
  if (email && password) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.fill('input[type="email"], input[name="email"]', email).catch(() => {});
    await page.fill('input[type="password"], input[name="password"]', password).catch(() => {});
    await page.click('button[type="submit"]').catch(() => {});
    await page.waitForTimeout(3500);
    const who = await page.evaluate(() => document.body.innerText.slice(0, 120)).catch(() => "");
    console.log(`  signed in as ${email} — landing page says: ${JSON.stringify(who.replace(/\s+/g, " ").trim().slice(0, 80))}`);
  } else {
    console.log("  NOT SIGNED IN (set PROBE_EMAIL / PROBE_PASSWORD). /admin will render the login page.");
  }

  for (const path of paths) {
    const url = `${BASE}${path}`;
    const console_: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const badResponses: string[] = [];

    const onConsole = (m: ConsoleMessage) => {
      if (m.type() === "error" || m.type() === "warning") console_.push(`[${m.type()}] ${m.text()}`);
    };
    // THE ONE THAT MATTERS: an uncaught exception, with its stack.
    const onPageError = (e: Error) => pageErrors.push(`${e.name}: ${e.message}\n${e.stack ?? "(no stack)"}`);
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("requestfailed", (r) => failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText ?? "?"}`));
    page.on("response", (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`); });

    console.log(`\n${"═".repeat(100)}\n${url}\n${"═".repeat(100)}`);
    const started = Date.now();
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch((e) => {
      console.log(`  navigation threw: ${(e as Error).message.split("\n")[0]}`);
      return null;
    });
    // TIME THE NAVIGATION, NOT THE NAVIGATION PLUS MY OWN SLEEP. The first version added the
    // settle delay into the reported figure and printed "9241 ms to domcontentloaded" for a
    // page that answered in 241 — my own instrumentation committing the bug this project keeps
    // finding: a number that was never measured, presented as a measurement.
    const ms = Date.now() - started;
    await page.waitForTimeout(wait);

    const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 300)).catch(() => "(unreadable)");
    console.log(`  HTTP ${resp?.status() ?? "—"} · ${ms} ms to domcontentloaded (then ${wait} ms settle, not counted)`);
    console.log(`  body: ${JSON.stringify(body)}`);

    if (pageErrors.length) {
      console.log(`\n  ── UNCAUGHT EXCEPTIONS (${pageErrors.length}) ──`);
      for (const e of pageErrors) console.log(e.split("\n").map((l) => `    ${l}`).join("\n"));
    } else {
      console.log(`\n  no uncaught exception`);
    }
    if (console_.length) {
      console.log(`\n  ── CONSOLE (${console_.length}) ──`);
      for (const c of console_.slice(0, 25)) console.log(`    ${c.slice(0, 400)}`);
    }
    if (badResponses.length) {
      console.log(`\n  ── HTTP >= 400 (${badResponses.length}) ──`);
      for (const r of badResponses.slice(0, 15)) console.log(`    ${r}`);
    }
    if (failedRequests.length) {
      console.log(`\n  ── FAILED REQUESTS (${failedRequests.length}) ──`);
      for (const r of failedRequests.slice(0, 15)) console.log(`    ${r}`);
    }

    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }

  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
