// Why does the Selgros adapter pool zero products? READ-ONLY diagnosis.
//
// docs/data-sources.md says "the category listing renders client-side and category slugs aren't
// in the HTML … the price selector yields nothing". A plain curl of the home page contradicts
// half of that: 24 `<a class="… product-item" data-product-id>` cards are right there in the
// server-rendered HTML. So the note is not the whole story, and the adapter runs headless
// Chromium rather than curl — which is a different client, and may be getting a different page.
//
// This opens the same URLs the adapter opens, with the same engine, and reports what is there.

import { chromium } from "playwright";

const URLS = [
  "https://www.selgros.ro/",
  "https://www.selgros.ro/exploreaza-sortimentul-selgros",
];

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ locale: "ro-RO", viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();

  try {
    for (const url of URLS) {
      console.log(`\n${"=".repeat(96)}\n${url}\n${"=".repeat(96)}`);
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e) => {
        console.log(`  goto failed: ${(e as Error).message.split("\n")[0]}`);
        return null;
      });
      if (!resp) continue;
      console.log(`  HTTP ${resp.status()}  final ${page.url()}`);

      // The adapter waits up to 15 s for its card selector, then proceeds regardless.
      const appeared = await page.waitForSelector("a.product-item[data-product-id]", { timeout: 15_000 })
        .then(() => true).catch(() => false);
      console.log(`  a.product-item[data-product-id] appeared within 15s: ${appeared}`);

      const counts = await page.evaluate(() => ({
        aCards: document.querySelectorAll("a.product-item[data-product-id]").length,
        anyProductItem: document.querySelectorAll(".product-item").length,
        anyDataId: document.querySelectorAll("[data-product-id]").length,
        title: document.title,
        bodyLen: document.body.innerText.length,
        head: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 260),
      }));
      console.log(`  title: ${JSON.stringify(counts.title)}`);
      console.log(`  a.product-item[data-product-id] = ${counts.aCards}`);
      console.log(`  .product-item (any element)     = ${counts.anyProductItem}`);
      console.log(`  [data-product-id] (any element) = ${counts.anyDataId}`);
      console.log(`  body text (${counts.bodyLen} chars): ${counts.head}`);

      if (counts.aCards > 0) {
        // What the adapter's own name/price selectors would read off the first card.
        // NOTE: no nested named helper here. tsx/esbuild rewrites function declarations with a
        // `__name` shim that does not exist inside the page, so a helper defined in this
        // callback throws "ReferenceError: __name is not defined" in the browser context.
        const sample = await page.evaluate(() => {
          const c = document.querySelector("a.product-item[data-product-id]") as HTMLElement;
          const out: Record<string, unknown> = { href: c.getAttribute("href"), allText: c.innerText.replace(/\s+/g, " ").slice(0, 220) };
          for (const s of [".product-title", "h3", "[class*=\"title\"]", ".product-name"]) {
            const e = c.querySelector(s);
            if (e?.textContent?.trim()) { out.name = `${s} -> ${e.textContent.trim().slice(0, 70)}`; break; }
          }
          for (const s of [".price-value", ".product-price", "[class*=\"price\"]"]) {
            const e = c.querySelector(s);
            if (e?.textContent?.trim()) { out.price = `${s} -> ${e.textContent.trim().slice(0, 70)}`; break; }
          }
          return out;
        });
        console.log(`  FIRST CARD`);
        console.log(`    href  ${sample.href}`);
        console.log(`    name  ${JSON.stringify(sample.name ?? null)}`);
        console.log(`    price ${JSON.stringify(sample.price ?? null)}`);
        console.log(`    text  ${JSON.stringify(sample.allText)}`);
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
