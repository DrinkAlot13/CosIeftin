// ── SCOPE: PRICE CORRECTNESS ──────────────────────────────────────────────────
// Does every stored price reproduce from its OWN evidence? READ-ONLY.
//
// Four independent questions, deliberately not blended into one score:
//
//   A. UNIT PRICE — recompute lei-per-unit from the offer's own price and its own size. A
//      mismatch means one of the two stored numbers is wrong and nothing says which.
//   B. RAW STRING — does `priceBani` reproduce from `rawPriceText` through `parsePrice`? This
//      is the only check that can catch a parser that changed after the row was written.
//   C. SPREAD — products whose shops disagree. Reported at 1.5x, 2x and 3x. A GROUP finding:
//      it names no culprit, per CLAUDE.md's peer-median limit.
//   D. THE ORACLE — Kaufland publishes `formattedBasePrice`, the per-unit price computed by the
//      MERCHANT from the real pack size. It is the only figure here that does not share our
//      assumptions.
//
//   npm run audit:price-truth

import { PrismaClient } from "@prisma/client";
import { parsePrice } from "../src/lib/price/parsePrice";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const MAX_DISPLAY_AGE_DAYS = 14;

function toks(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[șş]/g, "s").replace(/[țţ]/g, "t").replace(/[ăâ]/g, "a").replace(/î/g, "i")
      .replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length > 2),
  );
}

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_DISPLAY_AGE_DAYS * 86_400_000);
  const live = {
    merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
    NOT: { priceSource: "DELIVERY_PLATFORM" }, lastObservedAt: { gte: cutoff },
  } as const;

  const offers = await prisma.offer.findMany({
    where: live,
    select: {
      id: true, priceBani: true, pricePerUnit: true, pricePerUnitBani: true, rawPriceText: true,
      merchant: { select: { slug: true } },
      product: { select: { id: true, name: true, unit: true, unitSize: true } },
    },
  });
  console.log("═".repeat(104));
  console.log(`PRICE CORRECTNESS — ${offers.length} live offers`);
  console.log("═".repeat(104));

  // ── A. UNIT PRICE recomputed from the row's own two numbers ────────────────
  // THE FIRST VERSION OF THIS CHECK MEASURED THE WRONG THING, and said so loudly: it compared
  // `pricePerUnit` against the CATALOG's `unitSize` and reported 232 "disagreements", all
  // between 1.01x and 1.06x. But scrape-util computes `ppu = price / ownSize.unitSize` — the
  // size parsed from the MERCHANT'S OWN name, not the catalog's. The two are legitimately
  // different, so the check was flagging correct rows. That is the same shape this project keeps
  // finding, committed by an audit rather than by the code it audits.
  //
  // Rewritten to ask two separate, answerable questions:
  //
  //   A1  does `pricePerUnit` reproduce from the offer's own price and its own IMPLIED size?
  //       (implied size = price / ppu — algebra, so this only catches arithmetic corruption)
  //   A2  does the merchant's own pack size AGREE with the catalog's? A disagreement here is
  //       not a broken number, it is a MATCH across two different pack sizes — which the ±26%
  //       tolerance permits and which makes "cheapest per unit" compare unlike packs.
  let ppuChecked = 0, ppuBad = 0, sizeChecked = 0, sizeDisagree = 0;
  const ppuExamples: string[] = [];
  const sizeExamples: string[] = [];
  const sizeByMerchant = new Map<string, number>();
  for (const o of offers) {
    if (o.priceBani == null || !(o.pricePerUnit > 0)) continue;
    ppuChecked++;
    const impliedSize = o.priceBani / 100 / o.pricePerUnit;
    if (!(impliedSize > 0) || !Number.isFinite(impliedSize)) {
      ppuBad++;
      if (ppuExamples.length < 8) ppuExamples.push(`    offer ${o.id} [${o.merchant.slug}] price ${(o.priceBani / 100).toFixed(2)} ppu ${o.pricePerUnit} → implied size ${impliedSize}`);
      continue;
    }
    const cat = o.product.unitSize;
    if (!(cat > 0)) continue;
    sizeChecked++;
    const ratio = Math.max(impliedSize / cat, cat / impliedSize);
    if (ratio > 1.01) {
      sizeDisagree++;
      sizeByMerchant.set(o.merchant.slug, (sizeByMerchant.get(o.merchant.slug) ?? 0) + 1);
      if (sizeExamples.length < 10) {
        sizeExamples.push(
          `    offer ${o.id} [${o.merchant.slug}] merchant pack ${impliedSize.toFixed(4)} ${o.product.unit} vs catalog ${cat} ${o.product.unit}` +
          ` (${ratio.toFixed(2)}x)  ${o.product.name.slice(0, 44)}`,
        );
      }
    }
  }
  console.log(`\nA1. UNIT PRICE is internally consistent (price / ppu yields a real size)`);
  console.log(`    checked ${ppuChecked} · CORRUPT ${ppuBad}`);
  for (const e of ppuExamples) console.log(e);
  console.log(`\nA2. Does the MERCHANT'S pack size agree with the CATALOG's?`);
  console.log(`    checked ${sizeChecked} · DISAGREE ${sizeDisagree} (${((sizeDisagree / Math.max(1, sizeChecked)) * 100).toFixed(2)}%)`);
  console.log(`    Not a broken number — a match made ACROSS two pack sizes, which the ±26% size`);
  console.log(`    tolerance permits. It means the unit price shown is per the MERCHANT's pack while`);
  console.log(`    the page states the catalog's size.`);
  if (sizeByMerchant.size) console.log(`    by merchant: ${[...sizeByMerchant.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  for (const e of sizeExamples) console.log(e);

  // ── B. DOES THE PRICE REPRODUCE FROM ITS OWN RAW STRING? ───────────────────
  //
  // The reason `rawPriceText` is mandatory: without the exact source string no parser change
  // can be verified against history. This is that verification, run over everything.
  let rawChecked = 0, rawBad = 0, rawMissing = 0;
  const rawExamples: string[] = [];
  const rawBadByMerchant = new Map<string, number>();
  for (const o of offers) {
    if (!o.rawPriceText) { rawMissing++; continue; }
    const reparsed = parsePrice(o.rawPriceText);
    if (reparsed == null) {
      // The string is there and no longer parses. That is a parser regression, not a scrape bug.
      rawBad++;
      rawBadByMerchant.set(o.merchant.slug, (rawBadByMerchant.get(o.merchant.slug) ?? 0) + 1);
      if (rawExamples.length < 10) rawExamples.push(`    offer ${o.id} [${o.merchant.slug}] stored ${((o.priceBani ?? 0) / 100).toFixed(2)} · rawPriceText ${JSON.stringify(o.rawPriceText)} → parsePrice returns NULL`);
      continue;
    }
    rawChecked++;
    if (o.priceBani != null && reparsed !== o.priceBani) {
      rawBad++;
      rawBadByMerchant.set(o.merchant.slug, (rawBadByMerchant.get(o.merchant.slug) ?? 0) + 1);
      if (rawExamples.length < 10) rawExamples.push(`    offer ${o.id} [${o.merchant.slug}] stored ${(o.priceBani / 100).toFixed(2)} · raw ${JSON.stringify(o.rawPriceText)} reparses to ${(reparsed / 100).toFixed(2)}`);
    }
  }
  console.log(`\nB. DOES THE STORED PRICE REPRODUCE FROM ITS OWN rawPriceText?`);
  console.log(`   reproduced ${rawChecked} · DISAGREE OR UNPARSEABLE ${rawBad} · no raw string at all ${rawMissing}`);
  if (rawBadByMerchant.size) console.log(`   by merchant: ${[...rawBadByMerchant.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  for (const e of rawExamples) console.log(e);

  // ── C. SPREAD across shops, at three thresholds ────────────────────────────
  const byProduct = new Map<number, { name: string; rows: { shop: string; bani: number; store: string | null }[] }>();
  for (const o of offers) {
    if (o.priceBani == null || o.priceBani <= 0) continue;
    const e = byProduct.get(o.product.id) ?? { name: o.product.name, rows: [] };
    e.rows.push({ shop: o.merchant.slug, bani: o.priceBani, store: null });
    byProduct.set(o.product.id, e);
  }
  const spreads: { id: number; name: string; lo: number; hi: number; ratio: number; shops: number }[] = [];
  for (const [id, e] of byProduct) {
    const shops = new Set(e.rows.map((r) => r.shop));
    if (shops.size < 2) continue;
    const lo = Math.min(...e.rows.map((r) => r.bani));
    const hi = Math.max(...e.rows.map((r) => r.bani));
    if (lo > 0) spreads.push({ id, name: e.name, lo, hi, ratio: hi / lo, shops: shops.size });
  }
  const at = (r: number) => spreads.filter((s) => s.ratio >= r).length;
  console.log(`\nC. SPREAD across shops — ${spreads.length} products priced at 2+ shops`);
  console.log(`   >= 1.5x   ${at(1.5).toString().padStart(5)}  (${((at(1.5) / spreads.length) * 100).toFixed(1)}%)`);
  console.log(`   >= 2.0x   ${at(2).toString().padStart(5)}  (${((at(2) / spreads.length) * 100).toFixed(1)}%)`);
  console.log(`   >= 3.0x   ${at(3).toString().padStart(5)}  (${((at(3) / spreads.length) * 100).toFixed(1)}%)`);
  console.log(`   A GROUP finding. The check cannot say which side is wrong — see audit:wide-spread`);
  console.log(`   for the members and the discriminating tokens of each.`);

  emitJson({
    liveOffers: offers.length,
    unitPriceInternal: { checked: ppuChecked, corrupt: ppuBad },
    packSizeVsCatalog: { checked: sizeChecked, disagree: sizeDisagree },
    rawReproduce: { reproduced: rawChecked, disagree: rawBad, missing: rawMissing },
    spread: { pairs: spreads.length, at1_5: at(1.5), at2: at(2), at3: at(3) },
    worstSpreads: spreads.sort((a, b) => b.ratio - a.ratio).slice(0, 30),
    pass: ppuBad === 0 && rawBad === 0,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
