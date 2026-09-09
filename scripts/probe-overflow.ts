// ── WHAT IS ACTUALLY WIDER THAN THE PHONE? Drives a real browser.
//
// `/lista` scrolls sideways at 390px once the basket has items — 818px of content in a 390px
// viewport. That produces no error anywhere and is the single most likely thing to make a person
// close the tab, and the obvious suspect (the store comparison table) is inside a container that
// already declares `overflow-x: auto`.
//
// So rather than guess, this walks the DOM and reports EVERY element whose right edge extends
// past the viewport, innermost first. The innermost one is the cause; its ancestors are just
// carrying it.
//
//   npm run probe:overflow
//   npm run probe:overflow -- --path=/lista --width=390

import { chromium } from "playwright";

const BASE = process.env.PROBE_BASE ?? "http://localhost:3000";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const path = (argv.find((a) => a.startsWith("--path=")) ?? "--path=/lista").slice(7);
  const width = Number((argv.find((a) => a.startsWith("--width=")) ?? "--width=390").slice(8));

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ locale: "ro-RO", viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();

  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);

  // FILL THE BASKET FIRST. An empty /lista fits 390px perfectly; the overflow only appears once
  // there is something to compare, which is why an empty-page check reported it healthy.
  const input = page.locator('input[aria-label="Adaugă produs"]');
  if (await input.count() > 0) {
    for (const term of ["lapte", "paine", "oua", "unt", "cafea"]) {
      await input.fill("");
      await input.type(term, { delay: 20 });
      const sug = page.locator("ul.lista-suggest li button");
      await sug.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
      if (await sug.count() > 0) await sug.first().click().catch(() => {});
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(6000);
  }

  const report = await page.evaluate((vw) => {
    // ITERATIVE, NOT RECURSIVE, and deliberately so: tsx compiles a named inner function with
    // an esbuild `__name` helper that does not exist inside the page, so a recursive walk here
    // dies with "ReferenceError: __name is not defined" before it measures anything.
    const out: { tag: string; cls: string; w: number; right: number; text: string; depth: number }[] = [];
    const stack: { el: Element; depth: number }[] = [{ el: document.body, depth: 0 }];
    while (stack.length > 0) {
      const { el, depth } = stack.pop() as { el: Element; depth: number };
      const r = el.getBoundingClientRect();
      if (r.width > 0 && Math.round(r.right) > vw + 1) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 46),
          w: Math.round(r.width),
          right: Math.round(r.right),
          text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 44),
          depth,
        });
      }
      for (const c of Array.from(el.children)) stack.push({ el: c, depth: depth + 1 });
    }
    return {
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      offenders: out.sort((a, b) => b.depth - a.depth).slice(0, 20),
    };
  }, width);

  console.log("═".repeat(96));
  console.log(`OVERFLOW AT ${width}px — ${path}`);
  console.log("═".repeat(96));
  console.log(`  document ${report.scrollW}px in a ${report.clientW}px viewport` +
    `  ${report.scrollW > report.clientW + 1 ? "*** SCROLLS SIDEWAYS ***" : "ok"}`);

  if (report.offenders.length === 0) {
    console.log(`\n  No element extends past the viewport.`);
  } else {
    console.log(`\n  ELEMENTS PAST THE RIGHT EDGE, innermost first — the first is the cause:\n`);
    for (const o of report.offenders) {
      console.log(`    depth ${String(o.depth).padStart(2)}  ${o.tag.padEnd(6)} w=${String(o.w).padStart(5)} right=${String(o.right).padStart(5)}  .${o.cls}`);
      if (o.text) console.log(`              "${o.text}"`);
    }
  }

  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
