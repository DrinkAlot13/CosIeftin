// A snapshot before anything writes — and only one per session.
//
// `npm run backup` guarded the nightly and nothing else. A directly-invoked scraper wrote with
// no snapshot behind it, which is what has actually been running: dozens of individual scraper
// invocations, unprotected. The value of that guard was proven an hour earlier, when a
// mis-sequenced migration dropped 43,765 observation dates and a thirty-second-old snapshot
// made it a footnote instead of a disaster.
import { describe, it, expect } from "./run";
import { newestBackupAgeMs, backupIsRecent, BACKUP_MAX_AGE_MS } from "../src/lib/ensure-backup";
import { readFileSync, existsSync } from "node:fs";
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
    const entries = JSON.parse(readFileSync(manifest, "utf8")) as { takenAt?: string }[];
    const newest = Math.max(...entries.map((e) => Date.parse(e.takenAt ?? "")).filter(Number.isFinite));
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

  it("scrape-auchan has its own guard — it bypasses the shared write path", () => {
    expect(read("scripts/scrape-auchan.ts").includes("ensureBackup(")).toBeTruthy();
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
