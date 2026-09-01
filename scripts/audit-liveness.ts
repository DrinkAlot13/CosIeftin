// Is every source still alive? A check that has no opinion about whether the data is correct.
//
// Metro and Mega Image were dead for three days while every correctness check passed, because
// the 60% drop guard preserved the data and had no opinion about whether the source still
// answered. This audit answers only that question, and it exits non-zero when the answer is no.
//
// Read-only. Run: npm run audit:liveness

import { PrismaClient } from "@prisma/client";
import { computeLiveness, formatSilence, MAX_SILENCE_HOURS, EXPECTED_CADENCE_HOURS } from "../src/lib/liveness";
import { newestBackupAgeMs, missingBackupFiles, BACKUP_MAX_AGE_MS } from "../src/lib/ensure-backup";

const prisma = new PrismaClient();

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  const rows = await computeLiveness({
    merchants: () =>
      prisma.merchant.findMany({
        where: { active: true },
        select: { id: true, slug: true, name: true, lastScrapeAt: true },
      }),
    newestObservedAt: async (merchantId) => {
      const r = await prisma.offer.findFirst({
        where: { merchantId, lastObservedAt: { not: null } },
        orderBy: { lastObservedAt: "desc" },
        select: { lastObservedAt: true },
      });
      return r?.lastObservedAt ?? null;
    },
    liveOfferCount: (merchantId) =>
      prisma.offer.count({ where: { merchantId, isStale: false, availability: "in stock" } }),
    recentRuns: (merchantId, take) =>
      prisma.scraperRun.findMany({
        where: { merchantId },
        orderBy: { startedAt: "desc" },
        take,
        select: { aborted: true, offersWritten: true, abortReason: true },
      }),
  });

  console.log("\n════ LIVENESS — hours since the last SUCCESSFUL WRITE ═══════════════════════");
  console.log(`  A run that aborted is not a success. The evidence of a write is an OFFER ROW`);
  console.log(`  (max lastObservedAt), not a run record — lastScrapeAt is a claim the scraper`);
  console.log(`  makes about itself. Cadence ${EXPECTED_CADENCE_HOURS}h · alarm at ${MAX_SILENCE_HOURS}h.\n`);
  console.log(
    `  ${pad("merchant", 14)}${lp("since write", 13)}${lp("live offers", 13)}` +
    `${lp("dead runs", 11)}   last abort reason`,
  );

  for (const r of rows) {
    console.log(
      `  ${pad(r.slug, 14)}${lp(formatSilence(r.hoursSinceWrite), 13)}${lp(r.liveOffers, 13)}` +
      `${lp(r.deadRunStreak || "—", 11)}   ${(r.lastAbortReason ?? "").slice(0, 46)}` +
      `${r.dead ? "  ⚠ DEAD" : ""}${r.claimsWithoutWrites ? "  ⚠ CLAIMS WITHOUT WRITES" : ""}`,
    );
  }

  // ── The same class, one layer down: is the safety net itself alive?
  //
  // `ensureBackup` short-circuits on a recent manifest entry. If snapshots stopped landing
  // while the manifest kept being written, every scrape would skip its backup and report a
  // reassuring "snapshot is N min old". A guard whose success condition is "a record says
  // so" is exactly what let Metro look healthy for three days.
  const missing = missingBackupFiles();
  const backupAgeH = newestBackupAgeMs() / 3_600_000;
  console.log("\n════ THE SAFETY NET ════════════════════════════════════════════════════════");
  console.log(`  newest snapshot present on disk: ${formatSilence(backupAgeH)} old ` +
    `(short-circuit window ${(BACKUP_MAX_AGE_MS / 3_600_000).toFixed(0)}h)`);
  if (missing.length > 0) {
    console.log(`  ⚠ ${missing.length} manifest entr(ies) name a file that is NOT on disk:`);
    for (const f of missing.slice(0, 5)) console.log(`      ${f}`);
    console.log(`  Those entries no longer count toward "a backup is recent".`);
  } else {
    console.log(`  ✓ every manifest entry has its file on disk`);
  }

  const dead = rows.filter((r) => r.dead);
  const lying = rows.filter((r) => r.claimsWithoutWrites);

  console.log();
  if (lying.length > 0) {
    console.log(`  CLAIMS WITHOUT WRITES: ${lying.map((r) => r.slug).join(", ")}`);
    console.log(`  The scraper updated lastScrapeAt within ${MAX_SILENCE_HOURS}h but no offer row`);
    console.log(`  carries a matching observation date. It ran and produced nothing.`);
  }
  if (dead.length === 0) {
    console.log(`  ✓ every active merchant has written within ${MAX_SILENCE_HOURS} hours.`);
    await prisma.$disconnect();
    return;
  }
  console.log(`  ✗ ${dead.length} merchant(s) have not written in ${MAX_SILENCE_HOURS}h:`);
  for (const r of dead) {
    console.log(`      ${r.slug}: last write ${formatSilence(r.hoursSinceWrite)} ago, ` +
      `${r.liveOffers} offers still presented as live`);
  }
  console.log(`\n  Those offers are still being shown. Correct data, dead source — the state`);
  console.log(`  no other check in this project can see.\n`);
  await prisma.$disconnect();
  process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
