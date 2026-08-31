// Quarantine (never delete) the DCNeu offers written by the fabricating scraper.
// Marked, not removed: they are evidence, and price history must stay intact.
//
// Run: npm run quarantine:dcneu
import { prisma } from "../src/lib/db";

async function main() {
  const m = await prisma.merchant.findUnique({ where: { slug: "dcneu" } });
  if (!m) { console.log("no dcneu merchant"); await prisma.$disconnect(); return; }

  const offers = await prisma.offer.findMany({
    where: { merchantId: m.id },
    select: { id: true, price: true, url: true, productId: true },
  });
  // Group by (price,url): a group >1 means several DISTINCT catalog products were written
  // with one identical price+link — the fabrication signature.
  const groups = new Map<string, number[]>();
  for (const o of offers) {
    const k = `${o.price}|${o.url}`;
    const a = groups.get(k) ?? [];
    a.push(o.id);
    groups.set(k, a);
  }
  const suspect: number[] = [];
  let largest = 0;
  for (const ids of groups.values()) {
    if (ids.length > 1) { suspect.push(...ids); largest = Math.max(largest, ids.length); }
  }

  const trustworthy = offers.length - suspect.length;
  console.log(`DCNeu offers          : ${offers.length}`);
  console.log(`suspect (shared price+url): ${suspect.length}  (largest group ${largest})`);
  console.log(`TRUSTWORTHY           : ${trustworthy}  (${((trustworthy / offers.length) * 100).toFixed(1)}%)`);

  // mark, don't delete
  const BATCH = 500;
  for (let i = 0; i < suspect.length; i += BATCH) {
    await prisma.offer.updateMany({
      where: { id: { in: suspect.slice(i, i + BATCH) } },
      data: { flagged: true, flagReason: "QUARANTINE: fabricated by the pre-fix DCNeu scraper (shared price+url across distinct products)" },
    });
  }
  console.log(`\nQuarantined ${suspect.length} offers (flagged, NOT deleted).`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
