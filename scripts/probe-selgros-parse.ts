// ── WHAT WOULD SELGROS POOL? READ-ONLY. Nothing is written, nothing is matched.
//
// Selgros has `addNew: true` and zero offers today, so the first real run would create catalog
// products from whatever it reads. A price split across elements with no currency symbol on the
// page is exactly the shape that produces confident nonsense, so the extraction is inspected
// before it is allowed anywhere near the database.
//
// It runs the REAL `parseDom` against the REAL page — the same code path the scraper uses. A
// probe with its own copy of the extraction would be the restatement problem again, and would
// prove only that the probe agrees with itself.
//
//   npm run probe:selgros-parse

import { chromium } from "playwright";
import { parseDom, installEsbuildShim } from "./adapters/runner";
import { selgros } from "./adapters/selgros";
import { parsePrice } from "../src/lib/price/parsePrice";

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ locale: "ro-RO", viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();
  // The same shim runAdapter installs. Without it the callback dies on tsx's __name helper.
  await installEsbuildShim(page);
  const route = selgros.routes[0];

  await page.goto(route.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForSelector(selgros.dom!.card, { timeout: 20_000 }).catch(() => {});

  const pool = await parseDom(page, selgros.dom!, route, selgros);

  // WHAT UNIT IS EACH PRICE IN? Read straight from the card, not inferred from the name.
  const labels = await page.$$eval(
    selgros.dom!.card,
    (els, sel) => els.map((el) => {
      const n = el.querySelector(sel as string);
      return (n && n.textContent ? n.textContent : "").replace(/\s+/g, " ").trim();
    }),
    selgros.dom!.priceParts!.unitLabel!,
  );

  const priced = pool.filter((p) => p.price > 0);
  const refused = pool.filter((p) => p.price === 0);

  console.log("═".repeat(104));
  console.log(`SELGROS — what the real parser reads from ${route.url}`);
  console.log("═".repeat(104));
  console.log(`  cards pooled      ${pool.length}`);
  console.log(`  DECLINED by the per-kg rule: ${pool.filter((p) => p.refusalReason).length}`);
  console.log(`  with a price      ${priced.length}`);
  console.log(`  REFUSED (price 0) ${refused.length}`);
  console.log(`  with a reference  ${pool.filter((p) => p.referencePriceBani != null).length}`);
  console.log(`  with a name       ${pool.filter((p) => p.name.length > 0).length}`);
  console.log(`  with a link       ${pool.filter((p) => p.productUrl).length}`);

  console.log(`\n${"─".repeat(104)}`);
  console.log("EVERY PRICED ROW, with the exact string it was parsed from:");
  console.log("─".repeat(104));
  for (const p of priced.slice(0, 30)) {
    const re = p.referencePriceBani != null ? ` was ${(p.referencePriceBani / 100).toFixed(2)}` : "";
    console.log(`  ${p.price.toFixed(2).padStart(8)}${re.padEnd(12)} raw=${JSON.stringify(p.rawPriceText)}  ${p.name.slice(0, 46)}`);
  }

  if (refused.length > 0) {
    console.log(`\n${"─".repeat(104)}`);
    console.log("NOT WRITTEN, AND WHY — each carries its reason into the refusal log:");
    console.log("─".repeat(104));
    const byReason = new Map<string, string[]>();
    for (const p of refused) {
      const key = (p.refusalReason ?? "price could not be read at all")
        .replace(/[\d.,]+ per/, "N,NN per")
        .replace(/\(parsed size:.*/, "");
      const l = byReason.get(key) ?? [];
      l.push(p.name.slice(0, 52));
      byReason.set(key, l);
    }
    for (const [reason, names] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n  ${names.length} x  ${reason}`);
      for (const n of [...new Set(names)].slice(0, 6)) console.log(`         ${n}`);
      const uniq = new Set(names).size;
      if (uniq > 6) console.log(`         … and ${uniq - 6} more distinct products`);
    }
  }

  // ── THE HOMEPAGE RENDERS EACH TILE TWICE (a carousel plus a grid), so the card count is
  // NOT the product count. Reporting 36 offers from 36 duplicated cards would double what this
  // merchant actually contributes — the same shape as counting an offer per merchant listing.
  const distinctPriced = new Set(priced.map((p) => p.name)).size;
  const distinctAll = new Set(pool.map((p) => p.name)).size;
  console.log(`\n  DISTINCT PRODUCTS: ${distinctAll} on the page, ${distinctPriced} of them writable.`);
  console.log(`  (${pool.length} cards, because the homepage renders each tile twice.)`);

  // ── THE FABRICATION GUARD. Every wrong answer this card makes available, checked for.
  console.log(`\n${"═".repeat(104)}`);
  console.log("FABRICATION CHECK — the misreadings this card offers, and whether any got through");
  console.log("═".repeat(104));
  const bad: string[] = [];
  // NOT CHECKED: "the price is a whole number of lei, so maybe only the integer span was read".
  // It fired on TRAMBULINA ELASTICA at 499,00 (was 649,00), which is simply a price ending in
  // ,00 — and a guard that flags correct data is one people learn to scroll past. It is also
  // unreachable: `composeSplitPrice` refuses any group that is not exactly (lei, bani), so the
  // integer span alone cannot become a price. Structure already rules it out; a heuristic
  // restating that badly adds noise and no safety.
  for (const p of priced) {
    const bani = Math.round(p.price * 100);
    // 3499 lei is what concatenating both spans produces.
    if (bani >= 100_000) bad.push(`  implausibly large — spans concatenated? ${p.price} for ${p.name.slice(0, 40)}`);
    // 7,09 is the promo validity date read as an amount.
    if (p.rawPriceText && /\d{2}\/\d{2}/.test(p.rawPriceText)) bad.push(`  a DATE reached rawPriceText: ${p.rawPriceText}`);
    // The price must re-derive from its own recorded source string — audit:price-truth's rule.
    if (p.rawPriceText && parsePrice(p.rawPriceText) !== bani) {
      bad.push(`  does NOT re-derive from rawPriceText: ${JSON.stringify(p.rawPriceText)} -> ${parsePrice(p.rawPriceText)} but stored ${bani}`);
    }
    // A struck price that is not above the current one is not a former price.
    if (p.referencePriceBani != null && p.referencePriceBani <= bani) {
      bad.push(`  reference ${p.referencePriceBani} is not above price ${bani} for ${p.name.slice(0, 40)}`);
    }
  }
  if (bad.length === 0) {
    console.log(`  none. ${priced.length} prices, every one re-derives from its own source string,`);
    console.log(`  no dates reached it, and every struck price sits above the price it replaced.`);
  } else {
    for (const b of [...new Set(bad)].slice(0, 20)) console.log(b);
  }

  // ── WHICH UNIT IS THE PRICE IN? This decides whether Selgros can be activated at all.
  console.log(`\n${"═".repeat(104)}`);
  console.log("THE UNIT EACH PRICE IS QUOTED IN — read from the card, not inferred from the name");
  console.log("═".repeat(104));
  const tally = new Map<string, number>();
  for (const l of labels) tally.set(l || "(none)", (tally.get(l || "(none)") ?? 0) + 1);
  for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${JSON.stringify(k)}`);

  console.log(`\n  A "per kg" price is NOT the pack price. LEROY SOMON 1 2 KG at 34,99 is per KILO,`);
  console.log(`  and storing it as what the pack costs is exactly the defect just fixed at Penny,`);
  console.log(`  where a per-unit figure was published as the price of a 40-piece box. Nothing is`);
  console.log(`  written by this probe.`);

  await ctx.close();
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
