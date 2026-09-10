// ── SCREENSHOTS AT 1440 AND 390. For reviewing a change by looking at it.
//
// CLAUDE.md: verify by rendered output, never from source. A layout claim checked by reading JSX
// is a claim about what the code was meant to do.
//
//   npm run shots -- /p/some-slug /lista --tag=phase3
//   npm run shots -- / --width=390

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.SHOTS_BASE ?? "http://localhost:3000";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const tagArg = argv.find((a) => a.startsWith("--tag="));
  const tag = tagArg ? tagArg.split("=")[1] : "shot";
  const widths = argv.some((a) => a.startsWith("--width="))
    ? [Number(argv.find((a) => a.startsWith("--width="))!.split("=")[1])]
    : [1440, 390];
  const paths = argv.filter((a) => !a.startsWith("--"));
  if (paths.length === 0) {
    console.error("Name at least one path. Nothing captured — a FAILURE, not a pass.");
    process.exit(1);
  }

  const dir = join(process.cwd(), "reports", "shots");
  mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    for (const width of widths) {
      const ctx = await browser.newContext({
        viewport: { width, height: width < 700 ? 844 : 1000 },
        deviceScaleFactor: 1,
        locale: "ro-RO",
      });
      const page = await ctx.newPage();
      for (const p of paths) {
        const url = `${BASE}${p}`;
        const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 }).catch(() => null);
        const status = resp?.status() ?? 0;
        await page.waitForTimeout(1200);

        // FILL THE BASKET FIRST on /lista. The list lives in localStorage, so a fresh browser
        // renders an empty page — and an empty page is not what the change being reviewed does.
        // Same reason `probe:overflow` seeds it: the interesting layout only exists with items.
        if (p.startsWith("/lista") && !p.includes("in-magazin")) {
          const input = page.locator('input[aria-label="Adaugă produs"]');
          if (await input.count() > 0) {
            for (const term of ["lapte", "paine", "oua", "unt"]) {
              await input.fill("");
              await input.type(term, { delay: 20 });
              const sug = page.locator("ul.lista-suggest li button");
              await sug.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
              if (await sug.count() > 0) await sug.first().click().catch(() => {});
              await page.waitForTimeout(250);
            }
            await page.waitForTimeout(7000);
          }
        }
        const name = `${tag}-${p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}-${width}.png`;
        const file = join(dir, name);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`  ${String(status).padStart(3)}  ${String(width).padStart(4)}px  ${name}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\n  written to reports/shots/`);
}

main().catch((e) => { console.error(e); process.exit(1); });
