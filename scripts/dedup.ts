// CONSERVATIVE de-duplication. Only merges products that are EXACTLY the same
// (identical normalized name + brand + unit + size) — these are true cross-store
// doubles the fuzzy matcher didn't unify. It deliberately does NOT merely-similar
// products (fat %, flavor, bio, smoked, lactose-free variants are DISTINCT).
//
// Run: npm run dedup
import { prisma } from "../src/lib/db";
import { normalizeText } from "../src/lib/matching";

async function main() {
  const prods = await prisma.product.findMany({ select: { id: true, name: true, brand: true, section: true, unit: true, unitSize: true, image: true } });
  const byKey = new Map<string, typeof prods>();
  for (const p of prods) {
    const key = `${p.section}|${normalizeText(p.name)}|${normalizeText(p.brand ?? "")}|${p.unit}|${Math.round(p.unitSize * 1000)}`;
    let g = byKey.get(key);
    if (!g) { g = []; byKey.set(key, g); }
    g.push(p);
  }

  let clusters = 0;
  let mergedProducts = 0;
  for (const [, g] of byKey) {
    if (g.length < 2) continue;
    const members = [...g].sort((a, b) => a.id - b.id);
    const canonical = members[0];
    const dups = members.slice(1);
    const dupIds = dups.map((d) => d.id);
    const memberIds = members.map((m) => m.id);

    // Cheapest offer per merchant across the whole cluster (prefer in-stock).
    const allOffers = await prisma.offer.findMany({ where: { productId: { in: memberIds } } });
    const keep = new Map<number, (typeof allOffers)[number]>();
    for (const o of allOffers) {
      const cur = keep.get(o.merchantId);
      const better = !cur || (o.availability === "in stock" && cur.availability !== "in stock") || (o.availability === cur.availability && o.price < cur.price);
      if (better) keep.set(o.merchantId, o);
    }
    const keepIds = new Set([...keep.values()].map((o) => o.id));
    const drop = allOffers.filter((o) => !keepIds.has(o.id));

    // Remove redundant offers + their history, then move the kept ones onto the canonical.
    if (drop.length) {
      await prisma.priceHistory.deleteMany({ where: { offerId: { in: drop.map((o) => o.id) } } });
      await prisma.offer.deleteMany({ where: { id: { in: drop.map((o) => o.id) } } });
    }
    for (const o of keep.values()) {
      if (o.productId !== canonical.id) await prisma.offer.update({ where: { id: o.id }, data: { productId: canonical.id } });
    }
    // Backfill canonical image from a duplicate if missing.
    if (!canonical.image) {
      const withImg = dups.find((d) => d.image);
      if (withImg) await prisma.product.update({ where: { id: canonical.id }, data: { image: withImg.image } }).catch(() => {});
    }
    // Drop the now-empty duplicate products (and any saved-list references).
    await prisma.groceryListItem.deleteMany({ where: { productId: { in: dupIds } } });
    await prisma.product.deleteMany({ where: { id: { in: dupIds } } });
    clusters++;
    mergedProducts += dupIds.length;
  }
  console.log(`Merged ${mergedProducts} exact duplicates across ${clusters} clusters.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
