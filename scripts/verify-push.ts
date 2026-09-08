// ── ROW COUNTS ACROSS A SCHEMA PUSH. READ-ONLY.
//
// CLAUDE.md: "When you change the data model, write the Prisma migration AND a backfill script
// AND a verification script that compares row counts and checksums" — and, from the same file,
// "collapsing any two of those steps is how `lastObservedAt` lost 43,765 observation dates in a
// single `db push`."
//
// This project has no `prisma/migrations` directory; the schema is applied with `db push`. On
// SQLite that can rebuild a table rather than ALTER it, which is exactly the operation that lost
// those dates. So: run this BEFORE the push, run it AFTER, and diff the two files.
//
//   npm run verify:push -- --out logs/push-before.json
//   npx prisma db push
//   npm run verify:push -- --out logs/push-after.json --against logs/push-before.json
//
// A DIFFERENCE IS A FAILURE. There is no "expected" row loss for an additive change: the whole
// point of adding NULLABLE columns is that every existing row survives untouched.

import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const arg = (f: string): string | undefined => {
    const i = process.argv.indexOf(`--${f}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const out = arg("out");
  const against = arg("against");

  // Every table that holds data worth losing. Counted through the client, so a column the
  // client cannot see would surface here as an error rather than as silence.
  const counts: Record<string, number> = {
    Product: await prisma.product.count(),
    Offer: await prisma.offer.count(),
    PriceHistory: await prisma.priceHistory.count(),
    PendingMatch: await prisma.pendingMatch.count(),
    Merchant: await prisma.merchant.count(),
    Category: await prisma.category.count(),
    User: await prisma.user.count(),
    UserProductAdd: await prisma.userProductAdd.count(),
    UserFavorite: await prisma.userFavorite.count(),
    ProductAddCount: await prisma.productAddCount.count(),
    MatchOverride: await prisma.matchOverride.count(),
    PriceAnomaly: await prisma.priceAnomaly.count(),
    ScraperRun: await prisma.scraperRun.count(),
    EquivalenceClass: await prisma.equivalenceClass.count(),
  };

  // A checksum over the column the `lastObservedAt` incident destroyed: not just "how many
  // rows" but "do they still carry their values".
  const observed = await prisma.offer.aggregate({
    _count: { lastObservedAt: true },
    _min: { lastObservedAt: true },
    _max: { lastObservedAt: true },
  });
  const checks = {
    offersWithLastObservedAt: observed._count.lastObservedAt,
    oldestObservation: observed._min.lastObservedAt?.toISOString() ?? null,
    newestObservation: observed._max.lastObservedAt?.toISOString() ?? null,
  };

  const snapshot = { counts, checks };

  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${String(v).padStart(9)}`);
  console.log(`\n  offers carrying lastObservedAt   ${checks.offersWithLastObservedAt}`);
  console.log(`  observation window               ${checks.oldestObservation} .. ${checks.newestObservation}`);

  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(snapshot, null, 2));
    console.log(`\n  written to ${out}`);
  }

  if (against) {
    const prev = JSON.parse(readFileSync(against, "utf8")) as typeof snapshot;
    const diffs: string[] = [];
    for (const [k, v] of Object.entries(counts)) {
      const before = prev.counts[k];
      if (before !== v) diffs.push(`  ${k}: ${before} -> ${v}  (${v - before >= 0 ? "+" : ""}${v - before})`);
    }
    for (const [k, v] of Object.entries(checks)) {
      const before = (prev.checks as Record<string, unknown>)[k];
      if (before !== v) diffs.push(`  ${k}: ${String(before)} -> ${String(v)}`);
    }
    console.log(`\n${"─".repeat(70)}`);
    if (diffs.length === 0) {
      console.log(`  IDENTICAL to ${against}. Nothing was lost.`);
    } else {
      console.log(`  CHANGED against ${against} — this is a FAILURE for an additive change:`);
      for (const d of diffs) console.log(d);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
