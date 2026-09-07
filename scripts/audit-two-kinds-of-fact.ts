// PHASE 5 — columns where one value means two different things. READ-ONLY.
//
// THE PATTERN. A column answers a question. If "we looked and the answer is X" and "we never
// looked" both land in the same column as the same value, every consumer downstream agrees with
// a fact nobody established. This project has found that shape seventeen times.
//
// THE TEST, from the brief: take two consumers of the column and ask whether they would give
// the same answer on the same row. Where they would not, the column is carrying two facts.
//
//   npm run audit:two-kinds

import { PrismaClient } from "@prisma/client";
// A DECLARATION, not a measurement — see the file. It is the only import besides Prisma, and it
// carries no logic: it is the reason a null exists, moved somewhere a check can read it.
import { SOURCE_CAPABILITIES, nullProductUrlIsExpected } from "../src/lib/source-capabilities";

const prisma = new PrismaClient();

function head(t: string): void {
  console.log(`\n${"═".repeat(100)}\n${t}\n${"═".repeat(100)}`);
}

async function main(): Promise<void> {
  // ── (a) Offer.bulkTiers JSON vs the BulkTier table ────────────────────────────
  head("(a) Offer.bulkTiers (JSON) vs the BulkTier table — the same fact in two places");
  const withJson = await prisma.offer.count({ where: { bulkTiers: { not: null } } });
  const tierRows = await prisma.bulkTier.count();
  const offersWithRows = (await prisma.bulkTier.findMany({ select: { offerId: true }, distinct: ["offerId"] })).length;
  console.log(`  offers carrying the JSON column        ${withJson}`);
  console.log(`  BulkTier rows                          ${tierRows}  across ${offersWithRows} offers`);

  // Do the two copies AGREE where both exist? That is the question that decides whether this is
  // tidy-up or a live defect.
  const both = await prisma.offer.findMany({
    where: { bulkTiers: { not: null }, tiers: { some: {} } },
    select: { id: true, bulkTiers: true, tiers: { select: { minQuantity: true, unitPriceBani: true } } },
  });
  let agree = 0;
  const disagreements: string[] = [];
  for (const o of both) {
    let parsed: { qty: number; price: number }[] = [];
    try { parsed = JSON.parse(o.bulkTiers!) as { qty: number; price: number }[]; } catch { /* unreadable */ }
    const j = parsed.map((t) => `${t.qty}@${Math.round(t.price * 100)}`).sort().join(",");
    const r = o.tiers.map((t) => `${t.minQuantity}@${t.unitPriceBani}`).sort().join(",");
    if (j === r) agree++;
    else if (disagreements.length < 5) disagreements.push(`    offer ${o.id}\n      json  ${j || "(empty)"}\n      table ${r}`);
  }
  console.log(`  offers where BOTH exist                ${both.length}`);
  console.log(`  of those, the two copies agree         ${agree}`);
  if (disagreements.length) {
    console.log(`  DISAGREEMENTS (first ${disagreements.length}):`);
    for (const d of disagreements) console.log(d);
  }
  const jsonOnly = withJson - both.length;
  console.log(`  offers with JSON but NO table rows     ${jsonOnly}   <- these would lose data if the column were dropped`);
  console.log(`  READ BY: src/lib/substitution/load.ts and src/app/api/basket/v2/route.ts both`);
  console.log(`  parse the JSON column. The item page reads the TABLE. So the optimizer and the`);
  console.log(`  page can disagree about the same offer's ladder.`);

  // ── (b) productUrl: absent vs deliberately absent ─────────────────────────────
  head("(b) Offer.productUrl — 'no deep link yet' and 'this source has none' are both null");
  const perMerchant = await prisma.merchant.findMany({ select: { id: true, slug: true, active: true } });
  console.log(`  ${"merchant".padEnd(16)} ${"offers".padStart(8)} ${"null url".padStart(9)} ${"share".padStart(7)}  reading`);
  for (const m of perMerchant) {
    const n = await prisma.offer.count({ where: { merchantId: m.id } });
    if (n === 0) continue;
    const nul = await prisma.offer.count({ where: { merchantId: m.id, productUrl: null } });
    const pct = (nul / n) * 100;
    const expected = nullProductUrlIsExpected(m.slug);
    const declared = SOURCE_CAPABILITIES[m.slug];
    let reading: string;
    if (!declared) reading = "UNDECLARED — add it to lib/source-capabilities.ts";
    else if (expected && pct === 100) reading = `expected: ${declared.note}`;
    else if (expected && pct < 100) reading = `CONTRADICTION — declared to have none, yet ${n - nul} rows DO have one`;
    else if (!expected && nul === 0) reading = "every row has one, as declared";
    else reading = `GAP — declared to have product urls, but ${nul} row(s) carry none`;
    console.log(`  ${m.slug.padEnd(16)} ${String(n).padStart(8)} ${String(nul).padStart(9)} ${pct.toFixed(0).padStart(6)}%  ${reading}`);
  }

  // ── (d) pricePerUnit = 0 with a real price ────────────────────────────────────
  head("(d) pricePerUnit = 0 on offers that have a price");
  const zeroPpu = await prisma.offer.findMany({
    where: { pricePerUnit: 0, priceBani: { gt: 0 } },
    select: {
      id: true, pricePerUnit: true, pricePerUnitBani: true, priceBani: true,
      merchant: { select: { slug: true } },
      product: { select: { name: true, unit: true, unitSize: true } },
    },
  });
  console.log(`  offers with priceBani > 0 and pricePerUnit = 0:  ${zeroPpu.length}`);
  const nullBani = zeroPpu.filter((o) => o.pricePerUnitBani == null).length;
  console.log(`  of those, pricePerUnitBani IS NULL:              ${nullBani}`);
  console.log(`  ^ THE SAME LINE writes both (scrape-util.ts:1177-1181). The bani column says`);
  console.log(`    "unknown" with a null; the float column says "unknown" with a 0 — which is`);
  console.log(`    indistinguishable from a real zero and sorts as the CHEAPEST unit price.`);
  const bySize = new Map<string, number>();
  for (const o of zeroPpu) {
    const k = o.product.unitSize > 0 ? `unitSize=${o.product.unitSize} ${o.product.unit}` : `unitSize=0 or unset`;
    bySize.set(k, (bySize.get(k) ?? 0) + 1);
  }
  console.log(`  BY PRODUCT SIZE:`);
  for (const [k, v] of [...bySize.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${k.padEnd(34)} ${v}`);
  console.log(`  SAMPLE:`);
  for (const o of zeroPpu.slice(0, 6)) {
    console.log(`    ${o.merchant.slug.padEnd(12)} ${(o.priceBani! / 100).toFixed(2).padStart(8)} lei  size=${o.product.unitSize}${o.product.unit}  ppuBani=${o.pricePerUnitBani ?? "null"}  ${o.product.name.slice(0, 40)}`);
  }

  // ── (e) matchScore: a join is not a score ─────────────────────────────────────
  head("(e) Offer.matchScore — 1.0 from an EAN JOIN vs 1.0 from a NAME that scored well");
  const byReason = await prisma.offer.groupBy({ by: ["matchedBy"], _count: { _all: true } });
  console.log(`  ${"matchedBy".padEnd(24)} ${"offers".padStart(8)}  score range`);
  for (const r of byReason.sort((a, b) => b._count._all - a._count._all)) {
    const agg = await prisma.offer.aggregate({
      where: { matchedBy: r.matchedBy },
      _min: { matchScore: true }, _max: { matchScore: true }, _avg: { matchScore: true },
    });
    console.log(`  ${String(r.matchedBy ?? "(null)").padEnd(24)} ${String(r._count._all).padStart(8)}  ${agg._min.matchScore?.toFixed(2)} .. ${agg._max.matchScore?.toFixed(2)} (avg ${agg._avg.matchScore?.toFixed(3)})`);
  }
  // The brief's specific question: do EAN matches reach the review queue at all?
  const pendingTotal = await prisma.pendingMatch.count();
  const pendingByReason = await prisma.pendingMatch.groupBy({ by: ["reason"], _count: { _all: true } }).catch(() => []);
  console.log(`\n  PendingMatch rows: ${pendingTotal}`);
  if (pendingByReason.length) {
    for (const r of pendingByReason.sort((a, b) => b._count._all - a._count._all).slice(0, 10)) {
      console.log(`    ${String(r.reason ?? "(null)").padEnd(24)} ${r._count._all}`);
    }
    const eanInQueue = pendingByReason.filter((r) => /ean/i.test(String(r.reason ?? ""))).reduce((a, b) => a + b._count._all, 0);
    console.log(`  EAN-derived rows in the review queue: ${eanInQueue}`);
    console.log(eanInQueue === 0
      ? `  ⇒ LATENT, not active: an EAN match never reaches the queue, so the queue never ranks a\n    join alongside a score. The ambiguity is real but nothing currently acts on it.`
      : `  ⇒ ACTIVE: the queue ranks EAN joins against name scores on the same number.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
