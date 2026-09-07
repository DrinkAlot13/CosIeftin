// PHASE 6(e) — what has been ADDED but is never used, never read, or never fires. READ-ONLY.
//
// This class of thing has cost this project five separate defects, and they are all the same
// shape: a mechanism that looks present, satisfies review, and does nothing. A rule that never
// fires cannot be told from a rule that fires and finds nothing. A column that is always the
// same value cannot be told from a column nobody writes. An empty table read by live code
// silently supplies a default to every caller.
//
// Three sweeps, each answered from the DATA rather than from the source that produced it:
//
//   A. TABLES that are empty, and whether live code reads them anyway.
//   B. COLUMNS that hold exactly one distinct value across every row — a constant wearing a
//      column's clothes. Distinguishes "always null" from "always the same non-null value",
//      because those fail differently.
//   C. EQUIVALENCE CLASSES that were defined and seeded and hold nothing.
//
//   npm run audit:never-used

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log("═".repeat(100));
  console.log("A. EMPTY TABLES — and whether anything reads them");
  console.log("═".repeat(100));

  const counts: [string, number, string][] = [
    ["ProductAttribute", await prisma.productAttribute.count(), "READ by substitution/load.ts (isPrivateLabel) and basket/v2"],
    ["MatchOverride", await prisma.matchOverride.count(), "read by the matcher; human decisions"],
    ["PriceAnomaly", await prisma.priceAnomaly.count(), "read by the optimizer (unresolved anomalies block tiers)"],
    ["PendingMatch", await prisma.pendingMatch.count(), "read by /admin/matches"],
    ["BulkTier", await prisma.bulkTier.count(), "read by the item page"],
    ["PriceAlert", await prisma.priceAlert.count(), "read by the alerts job"],
    ["UserFavorite", await prisma.userFavorite.count(), "read by the optimizer"],
    ["UserBlocklist", await prisma.userBlocklist.count(), "read by the optimizer"],
    ["ProductSpec", await prisma.productSpec.count(), "read by the item page"],
    ["ProductPackChange", await prisma.productPackChange.count(), "read by /shrinkflation"],
    ["IndexSnapshot", await prisma.indexSnapshot.count(), "read by /index-cosmic"],
    ["EquivalenceClass", await prisma.equivalenceClass.count(), "read by the optimizer and the item page"],
  ];
  console.log(`  ${"table".padEnd(22)} ${"rows".padStart(8)}  status`);
  for (const [name, n, reader] of counts) {
    const verdict = n === 0 ? `EMPTY — but ${reader}` : "";
    console.log(`  ${name.padEnd(22)} ${String(n).padStart(8)}  ${verdict}`);
  }

  console.log(`\n${"═".repeat(100)}`);
  console.log("B. COLUMNS THAT HOLD ONE VALUE — a constant with a column's name");
  console.log("═".repeat(100));

  const offers = await prisma.offer.count();
  type Col = { name: string; distinct: number; only: string; nulls: number };
  const cols: Col[] = [];

  async function survey(name: string, field: string): Promise<void> {
    // NO `take` HERE. Prisma adds an implicit orderBy when a groupBy is limited, and that
    // orderBy field must appear in `by` — the error is about paging, not about the grouping.
    const groups = await (prisma.offer.groupBy as unknown as (a: object) => Promise<{ _count: { _all: number } }[]>)({
      by: [field], _count: { _all: true },
    });
    const rows = (groups as unknown as (Record<string, unknown> & { _count: { _all: number } })[])
      .sort((a, b) => b._count._all - a._count._all);
    const distinct = rows.length;
    const nulls = rows.find((r) => r[field] == null)?._count._all ?? 0;
    const only = distinct === 1 ? String(rows[0][field]) : "";
    cols.push({ name, distinct, only, nulls });
  }

  await survey("Offer.priceSource", "priceSource");
  await survey("Offer.matchedBy", "matchedBy");
  await survey("Offer.currency", "currency");
  await survey("Offer.referencePriceKind", "referencePriceKind");
  await survey("Offer.availability", "availability");

  console.log(`  ${"column".padEnd(30)} ${"distinct".padStart(9)} ${"nulls".padStart(8)}  reading`);
  for (const c of cols) {
    const reading = c.distinct === 1
      ? `ONE VALUE ONLY (${c.only}) across ${offers} rows — it cannot discriminate anything`
      : c.nulls > 0 ? `${c.nulls} nulls in the top groups — check what a null means here` : "varies";
    console.log(`  ${c.name.padEnd(30)} ${String(c.distinct).padStart(9)} ${String(c.nulls).padStart(8)}  ${reading}`);
  }

  // ScraperRun counters that may be structurally incapable of being non-zero.
  const runs = await prisma.scraperRun.count();
  const agg = await prisma.scraperRun.aggregate({
    _max: { offersNull: true, offersRejected: true, productsCreated: true, previousRunCount: true },
    _sum: { offersNull: true, offersRejected: true, productsCreated: true },
  });
  console.log(`\n  ScraperRun counters across ${runs} runs ever recorded:`);
  console.log(`    offersNull      max ${agg._max.offersNull}      total ${agg._sum.offersNull}`);
  console.log(`    offersRejected  max ${agg._max.offersRejected}  total ${agg._sum.offersRejected}`);
  console.log(`    productsCreated max ${agg._max.productsCreated} total ${agg._sum.productsCreated}`);
  if ((agg._sum.offersNull ?? 0) === 0) {
    console.log(`    ^ offersNull has NEVER been non-zero. That is CORRECT for what it measures`);
    console.log(`      (pool items reaching the matcher with no usable price — scrapers drop those`);
    console.log(`      upstream) and it is NOT "how many prices we failed to read". Printing it as a`);
    console.log(`      null rate would be a clean sheet measuring almost nothing.`);
  }

  console.log(`\n${"═".repeat(100)}`);
  console.log("C. EQUIVALENCE CLASSES WITH NO LIVE MEMBER — defined, seeded, and doing nothing");
  console.log("═".repeat(100));
  const classes = await prisma.equivalenceClass.findMany({
    select: {
      slug: true, label: true,
      products: { where: { offers: { some: { isStale: false, flagged: false, availability: "in stock" } } }, select: { id: true } },
    },
  });
  const empty = classes.filter((c) => c.products.length === 0);
  console.log(`  classes defined ${classes.length} · with at least one live member ${classes.length - empty.length} · EMPTY ${empty.length}`);
  for (const c of empty) console.log(`    ${c.slug.padEnd(30)} "${c.label}"`);
  if (empty.length) {
    console.log(`  An empty class is not harmless: the basket reports its line as "no shop can fill it",`);
    console.log(`  which reads as a catalog gap when it may be a rule that matches nothing.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
