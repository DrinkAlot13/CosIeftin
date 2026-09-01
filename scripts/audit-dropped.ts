// What each merchant is silently dropping, and whether "no price" means "out of stock".
//
// Auchan carries Price: 0 on 16.4% of its catalog, and across 304 sampled products Price===0
// and IsAvailable===false agreed every time with no exceptions in either direction. Those are
// real products that are out of stock, not absent products — and the old scraper dropped them
// with a bare `continue`, so both the merchant's offer count and the catalog understated
// reality by a sixth.
//
// This audit answers the same question for every other merchant, from the source payloads the
// scrapers actually keep: how many offers hold no usable price, and do the price field and the
// availability field agree about it.
//
// Read-only. Run: npm run audit:dropped

import { PrismaClient } from "@prisma/client";
import { parsePrice } from "../src/lib/price/parsePrice";

const prisma = new PrismaClient();

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

/** Sentinel shapes that mean "no price here", as opposed to a price we failed to read. */
function isSentinel(raw: string | null): boolean {
  if (raw === null) return false;
  const t = raw.trim();
  if (t === "") return true;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n === 0;
}

async function main(): Promise<void> {
  const merchants = await prisma.merchant.findMany({
    where: { active: true },
    select: { id: true, slug: true, name: true },
    orderBy: { slug: "asc" },
  });

  console.log("\n════ NO-PRICE OFFERS, AND WHETHER AVAILABILITY AGREES ═══════════════════════");
  console.log("  A row with no usable price and availability='in stock' is a CONTRADICTION:");
  console.log("  either the price read failed or the availability read did. Either way it is");
  console.log("  shown to shoppers as a live product with no price.\n");
  console.log(
    `  ${pad("merchant", 14)}${lp("offers", 8)}${lp("noPrice", 9)}${lp("sentinel", 10)}` +
    `${lp("oos", 8)}${lp("noPrice", 9)}${lp("noPrice", 9)}${lp("agree", 8)}`,
  );
  console.log(
    `  ${pad("", 14)}${lp("", 8)}${lp("", 9)}${lp("raw=0/''", 10)}` +
    `${lp("", 8)}${lp("& oos", 9)}${lp("& LIVE", 9)}${lp("%", 8)}`,
  );

  let totalContradictions = 0;
  const perMerchant: { slug: string; noPrice: number; contradiction: number; total: number }[] = [];

  for (const m of merchants) {
    const offers = await prisma.offer.findMany({
      where: { merchantId: m.id },
      select: { id: true, price: true, priceBani: true, rawPriceText: true, availability: true, isStale: true },
    });
    if (offers.length === 0) continue;

    let noPrice = 0, sentinel = 0, oos = 0, noPriceOos = 0, noPriceLive = 0;
    for (const o of offers) {
      const bani = o.priceBani ?? Math.round(o.price * 100);
      const missing = !(bani > 0);
      const out = o.availability !== "in stock" || o.isStale;
      if (out) oos++;
      if (!missing) continue;
      noPrice++;
      if (isSentinel(o.rawPriceText)) sentinel++;
      if (out) noPriceOos++; else noPriceLive++;
    }
    const agreePct = noPrice === 0 ? 100 : (noPriceOos / noPrice) * 100;
    totalContradictions += noPriceLive;
    perMerchant.push({ slug: m.slug, noPrice, contradiction: noPriceLive, total: offers.length });
    console.log(
      `  ${pad(m.slug, 14)}${lp(offers.length, 8)}${lp(noPrice, 9)}${lp(sentinel, 10)}` +
      `${lp(oos, 8)}${lp(noPriceOos, 9)}${lp(noPriceLive, 9)}${lp(agreePct.toFixed(0) + "%", 8)}` +
      `${noPriceLive > 0 ? "  ⚠" : ""}`,
    );
  }
  console.log(`\n  CONTRADICTIONS (no price but shown as live): ${totalContradictions}`);

  // ── Do the raw strings we DID keep still parse? A parser change can strand old rows.
  console.log("\n\n════ DOES EVERY STORED rawPriceText STILL PARSE TO THE STORED PRICE? ════════");
  console.log("  A parser change silently strands rows whose raw text no longer reproduces");
  console.log("  their price. This is the check that the strikethrough diff could not run.\n");
  console.log(`  ${pad("merchant", 14)}${lp("with raw", 10)}${lp("agree", 9)}${lp("disagree", 10)}${lp("unparseable", 13)}`);
  for (const m of merchants) {
    const offers = await prisma.offer.findMany({
      where: { merchantId: m.id, rawPriceText: { not: null } },
      select: { price: true, priceBani: true, rawPriceText: true },
    });
    if (offers.length === 0) continue;
    let agree = 0, disagree = 0, unparse = 0;
    for (const o of offers) {
      const want = o.priceBani ?? Math.round(o.price * 100);
      // parsePrice returns BANI, so the comparison stays in integers end to end.
      const got = parsePrice(o.rawPriceText!);
      if (got == null) { unparse++; continue; }
      if (Math.abs(got - want) <= 1) agree++; else disagree++;
    }
    console.log(
      `  ${pad(m.slug, 14)}${lp(offers.length, 10)}${lp(agree, 9)}${lp(disagree, 10)}${lp(unparse, 13)}` +
      `${disagree > 0 || unparse > 0 ? "  ⚠" : ""}`,
    );
  }

  // ── Provenance coverage: how much of the catalog could be re-checked at all.
  console.log("\n\n════ PROVENANCE COVERAGE ═══════════════════════════════════════════════════");
  console.log(`  ${pad("merchant", 14)}${lp("offers", 8)}${lp("rawText", 10)}${lp("blob", 9)}${lp("prodUrl", 10)}${lp("observed", 11)}`);
  for (const m of merchants) {
    const total = await prisma.offer.count({ where: { merchantId: m.id } });
    if (total === 0) continue;
    const [raw, blob, url, obs] = await Promise.all([
      prisma.offer.count({ where: { merchantId: m.id, rawPriceText: { not: null } } }),
      prisma.offer.count({ where: { merchantId: m.id, rawSourceBlob: { not: null } } }),
      prisma.offer.count({ where: { merchantId: m.id, productUrl: { not: null } } }),
      prisma.offer.count({ where: { merchantId: m.id, lastObservedAt: { not: null } } }),
    ]);
    const pc = (n: number): string => ((n / total) * 100).toFixed(0) + "%";
    console.log(
      `  ${pad(m.slug, 14)}${lp(total, 8)}${lp(pc(raw), 10)}${lp(pc(blob), 9)}${lp(pc(url), 10)}${lp(pc(obs), 11)}`,
    );
  }
  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
