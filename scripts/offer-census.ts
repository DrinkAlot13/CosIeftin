// OFFER CENSUS — account for every offer that is not visible to a shopper.
//
// Live offers fell from ~32,000 to ~24,000 overnight. Several deliberate changes were supposed
// to reduce that number, and together they over-explain the drop — which is the actual problem.
// A system that cannot account for its own missing rows will hide a genuine data loss inside a
// legitimate one, exactly the way "0 rejected" only ever meant "my validator agreed with my
// parser".
//
// So this attributes EVERY offer to exactly one bucket, and asserts that the buckets sum to the
// total. The `no reason found` bucket must be zero; if it is not, that is the finding.
//
// Read-only. Run: npm run census
//                 npm run census -- --compare backups/<file>.db   (before/after)

import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BUCKETS, STALE_AFTER_DAYS, classifyOffer, type Bucket } from "../src/lib/offer-census";


type Row = {
  id: number;
  merchant: string;
  merchantActive: boolean;
  section: string;
  isStale: boolean;
  isExpired: boolean;
  availability: string;
  stockStatus: string;
  flagged: boolean;
  vatBasis: string;
  promoValidTo: Date | null;
  lastSeenAt: Date | null;
  lastSeen: Date;
  anomalies: number;
};


const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

async function census(prisma: PrismaClient, label: string) {
  const now = new Date();

  const offers = await prisma.offer.findMany({
    select: {
      id: true, isStale: true, isExpired: true, availability: true, stockStatus: true,
      flagged: true, vatBasis: true, promoValidTo: true, lastSeenAt: true, lastSeen: true,
      merchant: { select: { slug: true, active: true } },
      product: { select: { section: true } },
      anomalies: { where: { resolved: false }, select: { id: true } },
    },
  });

  // Which merchants actually ran recently. A merchant nobody looked at has offers that are
  // absent for OUR reasons, not the shop's, and must not be blamed on the shop.
  //
  // Derived from the offers' own lastSeen rather than read from ScraperRun, because
  // ScraperRun has a blind spot: scrape-auchan is the catalog master, never calls
  // matchPoolToCatalog, and so records no run at all. Trusting that table put all 9,112
  // Auchan offers in "not scraped" when Auchan had in fact run first and successfully.
  // The freshest observation a merchant produced is a fact about what happened; a row in a
  // table only says what somebody remembered to write.
  const since = new Date(now.getTime() - 36 * 3600_000);
  const freshest = await prisma.offer.groupBy({
    by: ["merchantId"],
    _max: { lastSeen: true },
  });
  const merchantSlugs = new Map(
    (await prisma.merchant.findMany({ select: { id: true, slug: true } })).map((m) => [m.id, m.slug]),
  );
  const scrapedRecently = new Set(
    freshest
      .filter((f) => f._max.lastSeen && f._max.lastSeen >= since)
      .map((f) => merchantSlugs.get(f.merchantId)!)
      .filter(Boolean),
  );

  const rows: Row[] = offers.map((o) => ({
    id: o.id,
    merchant: o.merchant.slug,
    merchantActive: o.merchant.active,
    section: o.product.section ?? "(none)",
    isStale: o.isStale,
    isExpired: o.isExpired,
    availability: o.availability,
    stockStatus: o.stockStatus,
    flagged: o.flagged,
    vatBasis: o.vatBasis,
    promoValidTo: o.promoValidTo,
    lastSeenAt: o.lastSeenAt,
    lastSeen: o.lastSeen,
    anomalies: o.anomalies.length,
  }));

  const byBucket = new Map<Bucket, number>();
  const byMerchant = new Map<string, Map<Bucket, number>>();
  const bySection = new Map<string, Map<Bucket, number>>();
  const bump = (m: Map<string, Map<Bucket, number>>, k: string, b: Bucket) => {
    let inner = m.get(k);
    if (!inner) { inner = new Map(); m.set(k, inner); }
    inner.set(b, (inner.get(b) ?? 0) + 1);
  };

  for (const r of rows) {
    const b = classifyOffer({ ...r, merchantScrapedRecently: scrapedRecently.has(r.merchant) }, now);
    byBucket.set(b, (byBucket.get(b) ?? 0) + 1);
    bump(byMerchant, r.merchant, b);
    bump(bySection, r.section, b);
  }

  return { label, total: rows.length, rows, byBucket, byMerchant, bySection, scrapedRecently, now };
}

type Census = Awaited<ReturnType<typeof census>>;

function printCensus(c: Census): void {
  console.log(`\n════ OFFER CENSUS — ${c.label} ════════════════════════════════════════`);
  console.log(`  total offers  ${c.total}\n`);
  console.log(`  ${pad("bucket", 42)}${lp("offers", 9)}${lp("share", 9)}`);
  console.log("  " + "─".repeat(60));
  let sum = 0;
  for (const b of BUCKETS) {
    const n = c.byBucket.get(b) ?? 0;
    sum += n;
    if (n === 0 && b !== "no reason found" && b !== "live") continue;
    const mark = b === "no reason found" && n > 0 ? "  <-- MUST BE ZERO" : b === "live" ? "  <-- visible" : "";
    console.log(`  ${pad(b, 42)}${lp(n, 9)}${lp(((n / c.total) * 100).toFixed(1) + "%", 9)}${mark}`);
  }
  console.log("  " + "─".repeat(60));
  console.log(`  ${pad("SUM OF BUCKETS", 42)}${lp(sum, 9)}`);
  console.log(
    sum === c.total
      ? "  ✓ buckets account for every offer"
      : `  ✗ ARITHMETIC DOES NOT CLOSE: ${c.total - sum} offer(s) unaccounted for`,
  );
}

function printBreakdown(c: Census, m: Map<string, Map<Bucket, number>>, title: string): void {
  const cols: Bucket[] = [
    "live", "stale (not seen in a feed)", "out of stock", "expired (past promoValidTo)",
    "merchant not scraped in last run", "flagged by a sanity gate",
    "quarantined (unresolved PriceAnomaly)", "merchant inactive", "no reason found",
  ];
  const short: Record<string, string> = {
    "live": "live",
    "stale (not seen in a feed)": "stale",
    "out of stock": "oos",
    "expired (past promoValidTo)": "expired",
    "merchant not scraped in last run": "notrun",
    "flagged by a sanity gate": "flagged",
    "quarantined (unresolved PriceAnomaly)": "quarant",
    "merchant inactive": "inactive",
    "no reason found": "NOREASON",
  };
  console.log(`\n  ${title}`);
  console.log(`  ${pad("", 16)}${lp("total", 8)}${cols.map((b) => lp(short[b], 9)).join("")}`);
  const sorted = [...m.entries()].sort((a, b) => {
    const ta = [...a[1].values()].reduce((x, y) => x + y, 0);
    const tb = [...b[1].values()].reduce((x, y) => x + y, 0);
    return tb - ta;
  });
  for (const [k, inner] of sorted) {
    const total = [...inner.values()].reduce((x, y) => x + y, 0);
    console.log(`  ${pad(k, 16)}${lp(total, 8)}${cols.map((b) => lp(inner.get(b) ?? 0, 9)).join("")}`);
  }
}

/** Collapsing to one bucket hides overlap, so state it. */
function printOverlap(c: Census): void {
  let staleAndOos = 0;
  let staleOnly = 0;
  let oosOnly = 0;
  for (const r of c.rows) {
    const oos = r.availability !== "in stock" || r.stockStatus === "OUT_OF_STOCK";
    const seen = r.lastSeenAt ?? r.lastSeen;
    const stale = r.isStale || c.now.getTime() - seen.getTime() > STALE_AFTER_DAYS * 86_400_000;
    if (stale && oos) staleAndOos++;
    else if (stale) staleOnly++;
    else if (oos) oosOnly++;
  }
  console.log("\n  OVERLAP (precedence puts these in one bucket; here is the truth)");
  console.log(`    stale AND out of stock  ${lp(staleAndOos, 8)}`);
  console.log(`    stale only              ${lp(staleOnly, 8)}`);
  console.log(`    out of stock only       ${lp(oosOnly, 8)}`);
}

/**
 * What the matcher discarded. This cannot come from the Offer table, because a REVIEW-band
 * match is never written anywhere — see the note printed below.
 */
async function printMatcherFate(prisma: PrismaClient): Promise<void> {
  const overrides = await prisma.matchOverride.groupBy({ by: ["decision"], _count: true });
  console.log("\n  MATCHER FATE");
  console.log("    PENDING (three-band REVIEW):        0   <-- NOT a bucket. See below.");
  for (const o of overrides) {
    console.log(`    MatchOverride "${o.decision}":${" ".repeat(Math.max(1, 22 - o.decision.length))}${o._count}`);
  }
  console.log(
    "\n    A REVIEW-band decision is computed in decide() and then DROPPED on the spot:\n" +
    "    matchPoolToCatalog does `if (!d.ok) continue;`, and `ok` is true only for AUTO_MATCH.\n" +
    "    Nothing is persisted, no counter is kept, no row is created. So mid-confidence\n" +
    "    matches are NOT held for review and NOT recoverable by approving them — they are\n" +
    "    discarded, and none of the missing offers can be attributed to PENDING.",
  );
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const now = await census(prisma, "NOW (live database)");
  printCensus(now);
  printBreakdown(now, now.byMerchant, "BY MERCHANT");
  printBreakdown(now, now.bySection, "BY SECTION");
  printOverlap(now);
  await printMatcherFate(prisma);

  console.log("\n  merchants with a completed run in the last 36h: " +
    ([...now.scrapedRecently].sort().join(", ") || "(none)"));

  // ── before/after ────────────────────────────────────────────────────────────────
  const i = process.argv.indexOf("--compare");
  const cmpPath = i >= 0 ? process.argv[i + 1] : join(process.cwd(), "backups", "2026-08-30T21-26-38-835Z-pre-session.db");
  let failed = (now.byBucket.get("no reason found") ?? 0) > 0;

  if (existsSync(cmpPath)) {
    const before = new PrismaClient({ datasources: { db: { url: "file:" + cmpPath.split("\\").join("/") } } });
    try {
      const then = await census(before, "BEFORE (" + cmpPath.split(/[\\/]/).pop() + ")");
      printCensus(then);
      printBreakdown(then, then.byMerchant, "BY MERCHANT (before)");

      console.log("\n════ WHAT CHANGED ═══════════════════════════════════════════════════════");
      console.log(`  ${pad("bucket", 42)}${lp("before", 9)}${lp("after", 9)}${lp("delta", 9)}`);
      console.log("  " + "─".repeat(69));
      for (const b of BUCKETS) {
        const a = then.byBucket.get(b) ?? 0;
        const z = now.byBucket.get(b) ?? 0;
        if (a === 0 && z === 0) continue;
        const d = z - a;
        console.log(`  ${pad(b, 42)}${lp(a, 9)}${lp(z, 9)}${lp((d > 0 ? "+" : "") + d, 9)}`);
      }
      const liveBefore = then.byBucket.get("live") ?? 0;
      const liveAfter = now.byBucket.get("live") ?? 0;
      console.log(`\n  LIVE: ${liveBefore} -> ${liveAfter}  (${liveAfter - liveBefore})`);

      console.log("\n  WHERE THE LIVE OFFERS WENT, PER MERCHANT");
      console.log(`  ${pad("merchant", 16)}${lp("live before", 13)}${lp("live after", 12)}${lp("delta", 9)}`);
      const merchants = new Set([...then.byMerchant.keys(), ...now.byMerchant.keys()]);
      const deltas: { slug: string; a: number; z: number }[] = [];
      for (const m of merchants) {
        const a = then.byMerchant.get(m)?.get("live") ?? 0;
        const z = now.byMerchant.get(m)?.get("live") ?? 0;
        deltas.push({ slug: m, a, z });
      }
      for (const d of deltas.sort((x, y) => (x.z - x.a) - (y.z - y.a))) {
        console.log(`  ${pad(d.slug, 16)}${lp(d.a, 13)}${lp(d.z, 12)}${lp((d.z - d.a > 0 ? "+" : "") + (d.z - d.a), 9)}`);
      }
      failed = failed || (then.byBucket.get("no reason found") ?? 0) > 0;
    } finally {
      await before.$disconnect();
    }
  } else {
    console.log(`\n  (no comparison snapshot at ${cmpPath} — skipping before/after)`);
  }

  console.log();
  await prisma.$disconnect();
  if (failed) process.exit(1);
}

main().catch(async (e) => { console.error(e); process.exit(1); });
