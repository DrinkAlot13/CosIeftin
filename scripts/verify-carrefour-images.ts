// ── SCOPE: REPORT ONLY ────────────────────────────────────────────────────────
// Does the image fix actually work against the live site?
//
// The scraper read `src` first, which on Carrefour is the AjaxLoader spinner until their
// lazy-loader swaps the real URL in, so 851 live products stored the spinner. The fix reads the
// raw attributes and lets `pickImageUrl` choose. That is covered by unit tests — but a unit
// test proves the case I thought of, and what matters is what the live markup carries.
//
// ONE PAGE. This is their bandwidth and the question needs one sample, not a crawl. It does not
// write anything: it prints, side by side, what the old expression would have picked and what
// the new one picks, for every card on one category page.
//
// Run: npm run verify:carrefour-images

import { chromium } from "playwright";
import { pickImageUrl, type ImageAttrs } from "../src/lib/image-src";
import { isPlaceholderImage } from "../src/lib/placeholder-image";

const BASE = "https://carrefour.ro";
// The same path the scraper itself uses, so this samples what the scraper samples.
const PAGE = `${BASE}/bacanie-carrefour/alimente/lapte-si-derivate-lapte-uht`;

async function main(): Promise<void> {
  console.log(`\n════ CARREFOUR IMAGES: OLD READ vs NEW READ ════════════════════════════════`);
  console.log(`  One page: ${PAGE}\n`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  });
  const page = await ctx.newPage();
  try {
    await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000); // the scraper waits 6 s on the first page too

    const cards = (await page.$$eval("li.product[data-product-id]", (els) =>
      els.map((el) => {
        const imgEl = el.querySelector("img");
        return {
          name: (el.querySelector("a[title]")?.getAttribute("title") ?? "").slice(0, 44),
          attrs: {
            "data-src": imgEl?.getAttribute("data-src") ?? null,
            "data-original": imgEl?.getAttribute("data-original") ?? null,
            "data-lazy": imgEl?.getAttribute("data-lazy") ?? null,
            "data-lazy-src": imgEl?.getAttribute("data-lazy-src") ?? null,
            "data-srcset": imgEl?.getAttribute("data-srcset") ?? null,
            srcset: imgEl?.getAttribute("srcset") ?? null,
            src: imgEl?.getAttribute("src") ?? null,
          },
        };
      }),
    )) as { name: string; attrs: ImageAttrs }[];

    if (cards.length === 0) {
      console.log("  No product cards found. The page markup may have changed, or we were blocked.");
      console.log("  That is an answer: report it, do not retry harder.\n");
      await browser.close();
      return;
    }

    let oldSpinner = 0;
    let oldOk = 0;
    let newOk = 0;
    let newNull = 0;
    let recovered = 0;

    for (const c of cards) {
      // Exactly what the old expression did: src, then data-src, then "".
      const oldPick = (c.attrs.src || c.attrs["data-src"] || "").trim() || null;
      const newPick = pickImageUrl(c.attrs, BASE);

      const oldBad = oldPick === null || isPlaceholderImage(oldPick);
      if (oldBad) oldSpinner++; else oldOk++;
      if (newPick) newOk++; else newNull++;
      if (oldBad && newPick) recovered++;
    }

    console.log(`  ${cards.length} product cards on the page\n`);
    console.log(`    OLD read (src first)   usable ${String(oldOk).padStart(3)}   spinner/none ${String(oldSpinner).padStart(3)}`);
    console.log(`    NEW read (pickImageUrl) usable ${String(newOk).padStart(3)}   none        ${String(newNull).padStart(3)}`);
    console.log(`\n    RECOVERED by the fix: ${recovered} of ${cards.length}`);

    console.log(`\n  FIRST FIVE, SIDE BY SIDE`);
    for (const c of cards.slice(0, 5)) {
      const oldPick = (c.attrs.src || c.attrs["data-src"] || "").trim() || null;
      console.log(`\n    ${c.name}`);
      console.log(`      old: ${(oldPick ?? "(none)").slice(0, 92)}`);
      console.log(`      new: ${(pickImageUrl(c.attrs, BASE) ?? "(none)").slice(0, 92)}`);
      const present = Object.entries(c.attrs).filter(([, v]) => v).map(([k]) => k);
      console.log(`      attributes present: ${present.join(", ") || "(none)"}`);
    }
    console.log("");
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
