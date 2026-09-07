// ── SCOPE: USER-FACING ────────────────────────────────────────────────────────
// What does a shopper's browser actually get?
//
// `audit:image-coverage` says 97.1% of live products carry a usable image URL. A screenshot of
// /necategorisate showed four cards in a row with no picture at all. Both can be true: a URL
// that is stored, well-formed and not a placeholder can still fail in a browser — hotlink
// protection answers 403 to a request carrying our Referer, a CDN blocks the region, a file is
// gone. None of that is visible from the database, and none of it is visible from a `fetch`
// either, because a fetch does not send the Referer a page does.
//
// So this loads real pages in a real browser and counts the images that did not paint. It is
// the only measurement that answers the question the brief actually asks — how many products
// render the initials placeholder — and it disagrees with the database's answer on purpose.
//
// Read-only. Run: npm run audit:images-rendered   (BASE=http://localhost:3100)

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ROUTES = (process.env.ROUTES ?? "/,/c/lapte,/c/branzeturi,/necategorisate,/oferte,/search?q=lapte").split(",");

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

type Failure = { url: string; status: number | string };

async function main(): Promise<void> {
  console.log(`\n════ IMAGES AS THE BROWSER SEES THEM ════════════════════════════════════════`);
  console.log(`  A stored URL is not a rendered picture. This counts what actually painted.\n`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const byHost = new Map<string, { ok: number; bad: number; statuses: Map<string, number> }>();
  const examples: Failure[] = [];

  console.log(`  ${pad("ROUTE", 26)} ${lp("cards", 7)} ${lp("with img", 9)} ${lp("painted", 8)} ${lp("failed", 7)} ${lp("pending", 8)} ${lp("initials", 9)}`);
  console.log(`  ${"-".repeat(85)}`);

  for (const route of ROUTES) {
    const page = await ctx.newPage();
    page.on("response", (res) => {
      const rt = res.request().resourceType();
      if (rt !== "image") return;
      let host = "(unparseable)";
      try { host = new URL(res.url()).hostname; } catch { /* keep default */ }
      const entry = byHost.get(host) ?? { ok: 0, bad: 0, statuses: new Map<string, number>() };
      if (res.status() >= 200 && res.status() < 300) entry.ok++;
      else {
        entry.bad++;
        entry.statuses.set(String(res.status()), (entry.statuses.get(String(res.status())) ?? 0) + 1);
        if (examples.length < 12) examples.push({ url: res.url(), status: res.status() });
      }
      byHost.set(host, entry);
    });
    page.on("requestfailed", (req) => {
      if (req.resourceType() !== "image") return;
      let host = "(unparseable)";
      try { host = new URL(req.url()).hostname; } catch { /* keep default */ }
      const entry = byHost.get(host) ?? { ok: 0, bad: 0, statuses: new Map<string, number>() };
      entry.bad++;
      const why = req.failure()?.errorText ?? "failed";
      entry.statuses.set(why, (entry.statuses.get(why) ?? 0) + 1);
      if (examples.length < 12) examples.push({ url: req.url(), status: why });
      byHost.set(host, entry);
    });

    await page.goto(BASE + route, { waitUntil: "load" }).catch(() => {});
    // Scroll the page so lazy images below the fold are requested too — measuring only the
    // first screen would report a coverage the rest of the page does not have.
    await page.evaluate(`(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 900) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 90));
      }
      window.scrollTo(0, 0);
    })()`);
    await page.waitForTimeout(2500);

    // THREE STATES, NOT TWO — and getting this wrong is the very bug being measured.
    //
    // The first version of this check counted `!(complete && naturalWidth > 1)` as FAILED, which
    // on a 494-card page reported 326 failures where the network log showed zero. An image that
    // is lazy and has not finished arriving has not failed; it has not been asked for yet, or is
    // still in flight. `complete && naturalWidth === 0` is a real failure — the browser finished
    // and got nothing. `!complete` is pending, and pending is not a verdict.
    const counts = await page.evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll(".pcard"));
      let withImg = 0, painted = 0, failed = 0, pending = 0, initials = 0;
      for (const c of cards) {
        const img = c.querySelector("img");
        if (!img) { initials++; continue; }
        withImg++;
        if (!img.complete) pending++;
        else if (img.naturalWidth > 1) painted++;
        else failed++;
      }
      return { cards: cards.length, withImg, painted, failed, pending, initials };
    })()`) as { cards: number; withImg: number; painted: number; failed: number; pending: number; initials: number };

    console.log(
      `  ${pad(route, 26)} ${lp(counts.cards, 7)} ${lp(counts.withImg, 9)} ${lp(counts.painted, 8)} ` +
      `${lp(counts.failed, 7)} ${lp(counts.pending, 8)} ${lp(counts.initials, 9)}`,
    );
    await page.close();
  }

  console.log(`\n  BY IMAGE HOST`);
  console.log(`  ${pad("HOST", 40)} ${lp("painted", 8)} ${lp("failed", 7)}   why`);
  for (const [host, e] of [...byHost.entries()].sort((a, b) => b[1].bad - a[1].bad)) {
    const why = [...e.statuses.entries()].map(([k, v]) => `${k}×${v}`).join(" ");
    console.log(`  ${e.bad > 0 ? "✗" : " "}${pad(host, 39)} ${lp(e.ok, 8)} ${lp(e.bad, 7)}   ${why}`);
  }

  if (examples.length > 0) {
    console.log(`\n  FAILING EXAMPLES`);
    for (const f of examples) console.log(`    ${String(f.status).padEnd(22)} ${f.url.slice(0, 96)}`);
  }

  console.log("");
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
