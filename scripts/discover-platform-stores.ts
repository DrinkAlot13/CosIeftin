// What grocery storefronts does Glovo actually carry in this city, right now?
//
// READ-ONLY. It opens pages a logged-out browser with a delivery address can open, collects
// every `/stores/<slug>` link it finds, and reports them. It writes nothing to Glovo and
// nothing to our database.
//
// WHY THIS EXISTS. The store list in lib/platform/config was captured on 2026-09-02 from one
// page. A config row naming a store that does not exist would fail as "store page renders
// nu există" — which is the SAME error the adapter raises when the delivery-address session
// has expired. Those are different problems with the same symptom, and guessing between them
// is how an evening gets spent on the wrong one. So: enumerate first, then configure.
//
//   npm run discover:stores
//   npm run discover:stores -- lidl profi        # also probe these slugs directly

import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { GLOVO_SESSION_PATH, STOREFRONTS } from "../src/lib/platform/config";

const CITY = "bucharest";

/** Pages that enumerate storefronts. The category page is the one recon found; the city root
 *  is included because a market page can list stores the category page does not. */
const LISTING_PAGES = [
  `https://glovoapp.com/ro/ro/${CITY}/`,
  "https://glovoapp.com/ro/ro/glovo-delivery/categories/supermarket",
  `https://glovoapp.com/ro/ro/${CITY}/categories/supermarket`,
];

type Found = { slug: string; label: string | null; foundOn: string };

async function main(): Promise<void> {
  const probes = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (!existsSync(GLOVO_SESSION_PATH)) {
    throw new Error(`No Glovo session at ${GLOVO_SESSION_PATH}.`);
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    storageState: GLOVO_SESSION_PATH,
    locale: "ro-RO",
    timezoneId: "Europe/Bucharest",
    viewport: { width: 1440, height: 1400 },
  });
  const page = await ctx.newPage();
  const found = new Map<string, Found>();

  try {
    for (const url of LISTING_PAGES) {
      process.stdout.write(`\n${url}\n`);
      let status = 0;
      try {
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
        status = resp?.status() ?? 0;
      } catch (err) {
        console.log(`  navigation failed: ${(err as Error).message.split("\n")[0]}`);
        continue;
      }
      await page.waitForTimeout(7000);
      // Scroll: these listings lazy-load.
      for (let i = 0; i < 12; i++) {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.waitForTimeout(700);
      }

      const links = await page.evaluate(() => {
        const out: { href: string; label: string }[] = [];
        for (const a of document.querySelectorAll("a[href]")) {
          const href = a.getAttribute("href") ?? "";
          if (!href.includes("/stores/")) continue;
          out.push({ href, label: (a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60) });
        }
        return out;
      });

      const notFound = await page.evaluate(() => /nu exist/i.test(document.body.innerText));
      console.log(`  HTTP ${status}${notFound ? "  (page says: nu există)" : ""} — ${links.length} store links`);

      for (const l of links) {
        const m = l.href.match(/\/stores\/([a-z0-9-]+)/i);
        if (!m) continue;
        const slug = m[1];
        if (!found.has(slug)) found.set(slug, { slug, label: l.label || null, foundOn: url });
      }
    }

    // Direct probes: a store can exist without being linked from any listing we know.
    for (const p of probes) {
      for (const slug of [`${p}-buc`, p]) {
        if (found.has(slug)) continue;
        const url = `https://glovoapp.com/ro/ro/${CITY}/stores/${slug}`;
        let status = 0;
        try {
          const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
          status = resp?.status() ?? 0;
        } catch {
          console.log(`\nprobe ${slug}: navigation failed`);
          continue;
        }
        // Wait for a VERDICT, not for a clock. A fixed timeout turns "slow" into "absent",
        // which is this project's most repeated bug — and it already produced one ambiguous
        // lidl reading. Poll until the page commits to an answer, then report which one.
        let info = { notFound: false, h1: null as string | null, tiles: 0, finalUrl: "", body: "" };
        for (let i = 0; i < 12; i++) {
          await page.waitForTimeout(2000);
          info = await page.evaluate(() => ({
            notFound: /nu exist/i.test(document.body.innerText),
            h1: document.querySelector("h1")?.textContent?.trim() ?? null,
            tiles: document.querySelectorAll('[class*="ItemTile_itemTile"]').length,
            finalUrl: location.pathname,
            body: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 200),
          }));
          if (info.notFound || info.tiles > 0) break;
        }
        const verdict = info.notFound
          ? "DOES NOT EXIST"
          : info.tiles > 0
            ? "EXISTS, renders products"
            : "UNDECIDED after 24s — neither products nor a not-found message";
        console.log(`\nprobe ${slug}: HTTP ${status} -> ${info.finalUrl}`);
        console.log(`  h1=${JSON.stringify(info.h1)}  tiles=${info.tiles}  => ${verdict}`);
        if (!info.notFound && info.tiles === 0) console.log(`  body: ${JSON.stringify(info.body)}`);
        if (!info.notFound && info.tiles > 0) found.set(slug, { slug, label: info.h1, foundOn: "direct probe" });
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
  }

  const configured = new Set(STOREFRONTS.map((s) => s.storeSlug));
  console.log(`\n${"=".repeat(78)}\nSTOREFRONTS VISIBLE IN ${CITY.toUpperCase()} — ${found.size}\n${"=".repeat(78)}`);
  for (const f of [...found.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const known = configured.has(f.slug) ? "in config" : "NEW";
    console.log(`  ${f.slug.padEnd(30)} ${known.padEnd(10)} ${f.label ?? ""}`);
  }
  const missing = [...configured].filter((s) => !found.has(s));
  if (missing.length) console.log(`\nIn config but NOT seen on any listing page: ${missing.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
