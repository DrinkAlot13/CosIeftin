// Take a snapshot before anything writes, unless one is already recent enough.
//
// `npm run backup` was the first step of `nightly`, which protected the nightly and nothing
// else. A directly-invoked scraper — `npm run scrape:carrefour` — wrote to the database with no
// snapshot behind it, and that is what has actually been running during development: dozens of
// individual scraper invocations, each one unprotected.
//
// The value of Phase 0 was proven the hard way an hour ago, when a mis-sequenced migration
// dropped 43,765 observation dates and a thirty-second-old snapshot turned a disaster into a
// footnote. That snapshot existed because a migration was being guarded deliberately. A scrape
// deserves the same, without anyone having to remember.
//
// THE SHORT-CIRCUIT MATTERS AS MUCH AS THE BACKUP. `scrape:all` runs twelve scrapers in one
// session; twelve snapshots of a 33 MB database is 400 MB of near-identical copies, and a
// retention policy that then prunes them defeats the point. One snapshot per hour is enough:
// it bounds the loss to a single session's writes, which is the unit of work that goes wrong.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MANIFEST = join(process.cwd(), "backups", "manifest.json");

/** A snapshot younger than this makes another one redundant. */
export const BACKUP_MAX_AGE_MS = 60 * 60 * 1000;

type ManifestEntry = { takenAt?: string; file?: string };

/**
 * How old is the newest snapshot THAT ACTUALLY EXISTS ON DISK, in ms? Infinity when none.
 *
 * THE FILE IS CHECKED, NOT JUST THE MANIFEST ENTRY. This function used to read only the
 * manifest, which makes it a guard whose success condition is "a record says so" — the same
 * shape as the drop guard reporting healthy while Metro was dead. A manifest entry written
 * for a snapshot that failed to land would make `backupIsRecent()` return true forever, and
 * every scrape would then short-circuit its backup and run unprotected while printing a
 * reassuring "snapshot is N min old — skipping".
 *
 * Verified on the live manifest at the time of writing: 8 entries, 8 files, none missing.
 * The point is that nothing had ever checked.
 */
export function newestBackupAgeMs(now = Date.now()): number {
  if (!existsSync(MANIFEST)) return Infinity;
  try {
    const entries = JSON.parse(readFileSync(MANIFEST, "utf8")) as ManifestEntry[];
    const times = entries
      .filter((e) => !e.file || existsSync(join(process.cwd(), "backups", e.file)))
      .map((e) => (e.takenAt ? Date.parse(e.takenAt) : NaN))
      .filter((t) => Number.isFinite(t));
    if (times.length === 0) return Infinity;
    return now - Math.max(...times);
  } catch {
    // An unreadable manifest is not evidence of a recent backup.
    return Infinity;
  }
}

/** Manifest entries whose snapshot file is not on disk. Should always be empty. */
export function missingBackupFiles(): string[] {
  if (!existsSync(MANIFEST)) return [];
  try {
    const entries = JSON.parse(readFileSync(MANIFEST, "utf8")) as ManifestEntry[];
    return entries
      .map((e) => e.file)
      .filter((f): f is string => typeof f === "string")
      .filter((f) => !existsSync(join(process.cwd(), "backups", f)));
  } catch {
    return [];
  }
}

export function backupIsRecent(now = Date.now()): boolean {
  return newestBackupAgeMs(now) < BACKUP_MAX_AGE_MS;
}

/**
 * Ensure a recent snapshot exists before the caller writes anything.
 *
 * Deliberately synchronous and blocking: the whole point is that no write happens first. A
 * failure to back up does NOT abort the scrape — losing tonight's prices because a disk was
 * full would be a worse outcome than running unprotected — but it says so loudly rather than
 * passing silently, because "the backup quietly stopped working" is the failure mode that makes
 * every later recovery impossible.
 */
export function ensureBackup(label: string): void {
  if (backupIsRecent()) {
    const mins = Math.round(newestBackupAgeMs() / 60000);
    console.log(`  [backup] snapshot is ${mins} min old — skipping (${label})`);
    return;
  }
  console.log(`  [backup] taking a snapshot before ${label}…`);
  try {
    execFileSync("npm", ["run", "--silent", "backup"], { stdio: "inherit", shell: true });
  } catch (e) {
    console.error(
      `  [backup] ⚠ FAILED before ${label}: ${(e as Error).message}\n` +
      "  [backup]   Continuing unprotected — a failed backup must not cost tonight's prices,\n" +
      "  [backup]   but nothing is guarding this write. Fix it before the next run.",
    );
  }
}
