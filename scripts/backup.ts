// Database backup.
//
// The price history is the ONLY thing in this system that cannot be regenerated. Scrape the
// offers again tomorrow and you get them back; lose 78,000 history rows and every chart,
// every best-time-to-buy signal and every Omnibus cross-check restarts from zero, forever.
//
// Uses SQLite's VACUUM INTO, never a file copy: VACUUM INTO produces a transactionally
// consistent snapshot even while another process is writing. A `cp` of a live SQLite file
// can capture a torn page and yields a database that opens fine and is quietly wrong.
//
// Run: npm run backup
//      npm run backup -- --no-gzip     (keep the .db uncompressed, e.g. to restore from)

import { PrismaClient } from "@prisma/client";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";

const prisma = new PrismaClient();
const BACKUP_DIR = join(process.cwd(), "backups");
const MANIFEST = join(BACKUP_DIR, "manifest.json");

/** A snapshot capturing far fewer rows than the last one is a truncation, not a backup. */
const MIN_ROW_RATIO = 0.95;
const KEEP_DAILY = 7;
const KEEP_WEEKLY = 4;

type ManifestEntry = {
  file: string;
  takenAt: string;
  bytes: number;
  offers: number;
  priceHistory: number;
  products: number;
  integrityOk: boolean;
  gzipped: boolean;
};

function readManifest(): ManifestEntry[] {
  if (!existsSync(MANIFEST)) return [];
  try {
    return JSON.parse(readFileSync(MANIFEST, "utf8")) as ManifestEntry[];
  } catch {
    return [];
  }
}
function writeManifest(entries: ManifestEntry[]): void {
  writeFileSync(MANIFEST, JSON.stringify(entries, null, 2) + "\n", "utf8");
}

/** POSIX-style path for the SQL string literal — backslashes break it on Windows. */
const sqlPath = (p: string): string => p.split("\\").join("/");

async function main(): Promise<void> {
  const gzipWanted = !process.argv.includes("--no-gzip");
  mkdirSync(BACKUP_DIR, { recursive: true });
  const previous = readManifest();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dbPath = join(BACKUP_DIR, stamp + ".db");

  console.log("1/5  consistent snapshot (VACUUM INTO)");
  await prisma.$executeRawUnsafe("VACUUM INTO '" + sqlPath(dbPath) + "'");
  const bytes = statSync(dbPath).size;
  console.log("     " + dbPath);
  console.log("     " + (bytes / 1048576).toFixed(1) + " MB");

  console.log("\n2/5  row counts");
  const offers = await prisma.offer.count();
  const priceHistory = await prisma.priceHistory.count();
  const products = await prisma.product.count();
  console.log("     Offer " + offers + " · PriceHistory " + priceHistory + " · Product " + products);

  // ── integrity: open the SNAPSHOT itself, not the live DB ────────────────────────
  console.log("\n3/5  integrity check on the snapshot");
  const snap = new PrismaClient({ datasources: { db: { url: "file:" + sqlPath(dbPath) } } });
  let integrityOk = false;
  let snapOffers = 0;
  let snapHistory = 0;
  try {
    const res = await snap.$queryRawUnsafe<{ integrity_check: string }[]>("PRAGMA integrity_check");
    integrityOk = res.length > 0 && String(res[0].integrity_check).toLowerCase() === "ok";
    snapOffers = await snap.offer.count();
    snapHistory = await snap.priceHistory.count();
    console.log("     PRAGMA integrity_check: " + (integrityOk ? "ok" : JSON.stringify(res).slice(0, 120)));
    console.log("     readable: Offer " + snapOffers + " · PriceHistory " + snapHistory);
  } catch (e) {
    console.error("     snapshot could not be opened: " + (e as Error).message);
  } finally {
    await snap.$disconnect();
  }

  if (!integrityOk || snapOffers !== offers || snapHistory !== priceHistory) {
    console.error("\n✗ BACKUP REJECTED — the snapshot is not a faithful copy. Not recorded.");
    unlinkSync(dbPath);
    await prisma.$disconnect();
    process.exit(1);
  }

  // A silently-truncated backup is worse than no backup: it looks like protection.
  const last = previous[previous.length - 1];
  if (last && last.priceHistory > 0) {
    const ratio = priceHistory / last.priceHistory;
    if (ratio < MIN_ROW_RATIO) {
      console.error(
        "\n✗ BACKUP REJECTED — PriceHistory " + priceHistory + " is only " +
        (ratio * 100).toFixed(1) + "% of the previous snapshot's " + last.priceHistory +
        ". That is a truncation, not a backup. Snapshot kept for inspection at " + dbPath,
      );
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  // ── compress ────────────────────────────────────────────────────────────────────
  let finalFile = dbPath;
  let finalBytes = bytes;
  if (gzipWanted) {
    console.log("\n4/5  compress");
    const gzPath = dbPath + ".gz";
    await pipeline(createReadStream(dbPath), createGzip({ level: 6 }), createWriteStream(gzPath));
    finalBytes = statSync(gzPath).size;
    unlinkSync(dbPath);
    finalFile = gzPath;
    console.log("     " + (finalBytes / 1048576).toFixed(1) + " MB gzipped (" + ((finalBytes / bytes) * 100).toFixed(0) + "% of raw)");
  } else {
    console.log("\n4/5  compress — skipped (--no-gzip)");
  }

  const entry: ManifestEntry = {
    file: finalFile.split("\\").join("/").split("/").pop()!,
    takenAt: new Date().toISOString(),
    bytes: finalBytes,
    offers, priceHistory, products,
    integrityOk: true,
    gzipped: gzipWanted,
  };
  const manifest = [...previous, entry];

  // ── retention ───────────────────────────────────────────────────────────────────
  console.log("\n5/5  retention (keep " + KEEP_DAILY + " daily, " + KEEP_WEEKLY + " weekly)");
  const kept = applyRetention(manifest);
  const removed = manifest.filter((m) => !kept.includes(m));
  for (const r of removed) {
    const p = join(BACKUP_DIR, r.file);
    if (existsSync(p)) unlinkSync(p);
    console.log("     pruned " + r.file);
  }
  if (removed.length === 0) console.log("     nothing to prune");
  writeManifest(kept);

  console.log("\n✓ backup complete: " + entry.file);
  printRestoreInstructions(entry.file);
  await prisma.$disconnect();
}

/**
 * Keep the most recent KEEP_DAILY, plus one per ISO week for KEEP_WEEKLY weeks.
 * The oldest remaining snapshot is NEVER pruned, whatever the policy says — losing the
 * last line of defence to a retention rule would be the worst possible failure here.
 */
export function applyRetention(entries: ManifestEntry[]): ManifestEntry[] {
  if (entries.length <= 1) return entries;
  const sorted = [...entries].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  const keep = new Set<ManifestEntry>();

  for (const e of sorted.slice(-KEEP_DAILY)) keep.add(e);

  const weekOf = (iso: string): string => {
    const d = new Date(iso);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return t.getUTCFullYear() + "-W" + week;
  };
  const byWeek = new Map<string, ManifestEntry>();
  for (const e of sorted) byWeek.set(weekOf(e.takenAt), e); // last of each week
  for (const e of [...byWeek.values()].slice(-KEEP_WEEKLY)) keep.add(e);

  keep.add(sorted[0]); // never drop the oldest survivor

  return sorted.filter((e) => keep.has(e));
}

function printRestoreInstructions(file: string): void {
  const isGz = file.endsWith(".gz");
  console.log("\n─── RESTORE ───────────────────────────────────────────────");
  console.log("  Restoring is never guesswork. From the repo root:");
  console.log("");
  if (isGz) {
    console.log("    gunzip -k backups/" + file);
    console.log("    # -k keeps the archive; you may need it again");
  }
  console.log("    # 1. stop anything writing to the DB (dev server, scrapers)");
  console.log("    # 2. move the current DB aside rather than overwriting it:");
  console.log("    mv prisma/dev.db prisma/dev.db.replaced-$(date +%s)");
  console.log("    cp backups/" + file.replace(/\.gz$/, "") + " prisma/dev.db");
  console.log("    # 3. verify before trusting it:");
  console.log("    npm run audit:db");
  console.log("───────────────────────────────────────────────────────────");
}

const invokedDirectly = process.argv[1] ? process.argv[1].split("\\").join("/").endsWith("backup.ts") : false;
if (invokedDirectly) {
  main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}
