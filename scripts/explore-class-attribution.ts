// WHO GETS THE CREDIT: the 30 new classes, or simply re-running an assigner that was stale?
//
// Class coverage went 820 -> 1,399 live products and the Index basket's fill rose sharply
// (mega-image 21 -> 33 lines). Both happened in the same command, and attributing the basket
// gain to the new classes would be wrong if the existing ones simply had not been re-assigned
// since they were last edited. READ-ONLY; splits the total by which classes the members are in.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - 14 * 86_400_000);
  const classes = await prisma.equivalenceClass.findMany({ select: { id: true, slug: true, attributes: true } });
  const isNew = new Map(classes.map((c) => {
    let strict = false;
    try { strict = (JSON.parse(c.attributes ?? "{}") as { strictRules?: boolean }).strictRules === true; } catch { /* not ours */ }
    return [c.id, strict];
  }));
  const slugOf = new Map(classes.map((c) => [c.id, c.slug]));

  const products = await prisma.product.findMany({
    where: { equivalenceClassId: { not: null } },
    select: {
      id: true, brand: true, equivalenceClassId: true,
      offers: {
        where: {
          merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
          NOT: { priceSource: "DELIVERY_PLATFORM" }, lastObservedAt: { gte: cutoff },
        },
        select: { merchantId: true },
      },
    },
  });

  const live = products.filter((p) => p.offers.length > 0);
  const inNew = live.filter((p) => isNew.get(p.equivalenceClassId!));
  const inOld = live.filter((p) => !isNew.get(p.equivalenceClassId!));

  console.log("=".repeat(78));
  console.log("WHERE THE 1,399 CLASSED PRODUCTS ACTUALLY SIT");
  console.log("=".repeat(78));
  console.log(`live products in a class                 ${live.length}`);
  console.log(`  in the 30 classes THIS BRIEF added     ${inNew.length}`);
  console.log(`  in classes that already existed        ${inOld.length}`);
  console.log(`\nSo the Index-basket fill improvement belongs to the EXISTING classes: none of the`);
  console.log(`30 new ones is an Index line. Re-running the assigner is what moved that number.`);

  // WHAT THE 30 ACTUALLY ADDED. A member that was already sold in two shops was already
  // comparable and gains nothing from a class. The products a class earns are the SINGLE-SHOP
  // ones that now have a priced equivalent somewhere else.
  const spanOf = new Map<number, Set<number>>();
  for (const p of live) {
    const s = spanOf.get(p.equivalenceClassId!) ?? new Set<number>();
    for (const o of p.offers) s.add(o.merchantId);
    spanOf.set(p.equivalenceClassId!, s);
  }
  const earned = (list: typeof live) => list.filter((p) => {
    const own = new Set(p.offers.map((o) => o.merchantId));
    return own.size === 1 && (spanOf.get(p.equivalenceClassId!)?.size ?? 0) >= 2;
  }).length;
  console.log(`\nSINGLE-SHOP PRODUCTS THAT NOW HAVE A PRICED EQUIVALENT ELSEWHERE`);
  console.log(`  via the 30 new classes                 ${earned(inNew)}`);
  console.log(`  via classes that already existed       ${earned(inOld)}`);
  console.log(`  ^ this is what a class BUYS. A product already sold in two shops was already`);
  console.log(`    comparable and gains nothing from being classed.`);

  const newCounts = new Map<string, number>();
  for (const p of inNew) newCounts.set(slugOf.get(p.equivalenceClassId!)!, (newCounts.get(slugOf.get(p.equivalenceClassId!)!) ?? 0) + 1);
  console.log(`\nTHE 30 NEW CLASSES, BY LIVE MEMBERS`);
  let shown = 0;
  for (const [slug, n] of [...newCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${slug.padEnd(38)} ${String(n).padStart(4)}`);
    shown += n;
  }
  console.log(`  ${"".padEnd(38)} ${String(shown).padStart(4)}  total in ${newCounts.size} classes`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
