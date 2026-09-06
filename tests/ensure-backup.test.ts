// A snapshot before anything writes — and only one per session.
//
// `npm run backup` guarded the nightly and nothing else. A directly-invoked scraper wrote with
// no snapshot behind it, which is what has actually been running: dozens of individual scraper
// invocations, unprotected. The value of that guard was proven an hour earlier, when a
// mis-sequenced migration dropped 43,765 observation dates and a thirty-second-old snapshot
// made it a footnote instead of a disaster.
import { describe, it, expect } from "./run";
import { newestBackupAgeMs, backupIsRecent, BACKUP_MAX_AGE_MS } from "../src/lib/ensure-backup";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("backup freshness — the short-circuit", () => {
  it("an hour is the window", () => {
    expect(BACKUP_MAX_AGE_MS).toBe(60 * 60 * 1000);
  });

  it("reads the real manifest and returns a finite age", () => {
    // This project has taken backups tonight, so the manifest exists and parses.
    const manifest = join(process.cwd(), "backups", "manifest.json");
    if (!existsSync(manifest)) return;
    expect(Number.isFinite(newestBackupAgeMs())).toBeTruthy();
  });

  it("a snapshot inside the window short-circuits; outside it does not", () => {
    const manifest = join(process.cwd(), "backups", "manifest.json");
    if (!existsSync(manifest)) return;
    const entries = JSON.parse(readFileSync(manifest, "utf8")) as { takenAt?: string; file?: string }[];
    // THE SAME POPULATION THE FUNCTION USES. `newestBackupAgeMs` ignores manifest entries
    // whose snapshot file has been pruned from disk — a record of a backup that no longer
    // exists is not a backup. This test took the max over ALL entries, so the moment the
    // manifest's newest entry outlived its file, the two disagreed about "newest" and the
    // boundary assertion landed outside the window. Two definitions of one fact, in a test
    // whose only job is checking the ±1s boundary arithmetic.
    const newest = Math.max(
      ...entries
        .filter((e) => !e.file || existsSync(join(process.cwd(), "backups", e.file)))
        .map((e) => Date.parse(e.takenAt ?? ""))
        .filter(Number.isFinite),
    );
    if (!Number.isFinite(newest)) return; // every listed file pruned — nothing to bound-check
    // Just inside the window.
    expect(backupIsRecent(newest + BACKUP_MAX_AGE_MS - 1000)).toBeTruthy();
    // Just outside it.
    expect(backupIsRecent(newest + BACKUP_MAX_AGE_MS + 1000)).toBeFalsy();
  });
});

describe("backup guard — every write path is covered", () => {
  const read = (p: string): string => readFileSync(join(process.cwd(), p), "utf8");

  it("matchPoolToCatalog backs up before any database work", () => {
    const src = read("src/lib/scrape-util.ts");
    const guard = src.indexOf("ensureBackup(");
    const firstWrite = src.indexOf("prisma.offer.updateMany");
    expect(guard > 0).toBeTruthy();
    // The guard must come BEFORE the first write, or it is decoration.
    expect(guard < firstWrite).toBeTruthy();
  });

  it("there is no second write path that needs its own copy of the guard", () => {
    // This test used to assert the OPPOSITE: that `scripts/scrape-auchan.ts` carried its own
    // ensureBackup() call, because it upserted Offer rows itself and never reached
    // matchPoolToCatalog. Guarding the two paths separately was the divergence reproducing
    // itself inside the fix for the divergence — every safeguard from then on would have
    // needed adding twice, and the second copy is the one that drifts.
    //
    // Auchan is a declarative adapter now, so the guard has exactly one home. What this test
    // protects is that property: no script may write offers without going through the shared
    // path. A new bespoke scraper would fail here rather than quietly re-opening the hole.
    const scripts = readdirSync(join(process.cwd(), "scripts")).filter((f) => f.endsWith(".ts"));
    const offenders: string[] = [];
    for (const f of scripts) {
      const src = read(join("scripts", f));
      if (!/prisma\.offer\.(upsert|create|createMany)\s*\(/.test(src)) continue;
      // matchPoolToCatalog is the shared path; a script that calls it is compliant.
      if (src.includes("matchPoolToCatalog")) continue;
      // ...and a script that carries its own guard is at least honest about being separate.
      if (src.includes("ensureBackup(")) continue;
      offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("scrape-all guards the whole run", () => {
    expect(read("scripts/scrape-all.ts").includes("ensureBackup(")).toBeTruthy();
  });

  it("a failed backup does not abort the scrape, but says so", () => {
    const src = read("src/lib/ensure-backup.ts");
    // Losing tonight's prices because a disk was full is worse than running unprotected —
    // but silence about it is worse than both.
    expect(src.includes("catch")).toBeTruthy();
    expect(src.includes("FAILED")).toBeTruthy();
    expect(/process\.exit/.test(src)).toBeFalsy();
  });

  it("an unreadable manifest is not treated as a recent backup", () => {
    const src = read("src/lib/ensure-backup.ts");
    expect(src.includes("return Infinity")).toBeTruthy();
  });
});
