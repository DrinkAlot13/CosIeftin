// ── IS A PRODUCT'S REAL BRAND PUBLISHED ON THE MERCHANT'S DETAIL PAGE? READ-ONLY.
//
// Two questions, one instrument:
//
//   SEZAMO      7,201 of the brand gap is Sezamo. Its LISTING payload carries no brand at all,
//               and nobody has ever opened a detail page to look. If a brand is published there,
//               that is merchant truth — the only route that closes the gap honestly, as against
//               the naming-convention inference that grades 99.3% and writes "chivas" for chives.
//
//   CARREFOUR   its `data-brand` attribute agrees with independent brand data 53.8% of the time
//               ("Bilbor" for Borsec, "Barilla" for Tabasco). The listing attribute is not the
//               product's brand. Is the REAL brand anywhere on the detail page?
//
// For Carrefour the probe also GRADES what it finds: where we hold a brand that some other
// merchant supplied, the detail page's answer is checked against it. That makes this an oracle
// rather than a survey — it can say "the detail page is right and the listing is wrong" instead
// of merely "a brand exists".
//
// Politeness: robots.txt honoured, one page at a time, bounded sample.
//
//   npm run probe:brand -- sezamo --n=40
//   npm run probe:brand -- carrefour --n=25

import { PrismaClient } from "@prisma/client";
import { chromium, type Page } from "playwright";
import { allowedByRobots } from "../src/lib/net/robots";
import { normalizeRo } from "../src/lib/text/normalizeRo";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

import { brandFromDetailPage, type BrandHit } from "../src/lib/brand/from-detail-page";

type Found = BrandHit;

async function inspect(page: Page, url: string): Promise<{ found: Found; ms: number; note: string }> {
  const t0 = Date.now();
  const done = (found: Found, note = "") => ({ found, ms: Date.now() - t0, note });

  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
  if (!resp) return done(null, "navigation failed");
  if (resp.status() >= 400) return done(null, `HTTP ${resp.status()}`);
  await page.waitForTimeout(3000);

  // ONE implementation, shared with `backfill:detail-brands`. A probe that measured coverage with
  // a different reader than the backfill uses would be measuring a rule nobody runs.
  const hit = await brandFromDetailPage(page);
  return done(hit, hit ? "" : "no brand published anywhere we looked");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // `--json <path>` takes a VALUE, and treating it as a merchant name made the probe report
  // "unknown merchant: reports/brand-sezamo.json". A run that mis-parses its own arguments is
  // exactly what `probe:links` once did before it was made to fail loudly.
  // `--json <path>` takes a VALUE that must not be read as a merchant name. Guard the -1 case:
  // with no --json present, `jsonIdx + 1` is 0 and this silently ate the FIRST merchant argument.
  // The "checked nothing is a FAILURE" rule is what surfaced it instead of a quiet empty run.
  const jsonIdx = argv.indexOf("--json");
  const skip = jsonIdx >= 0 ? jsonIdx + 1 : -1;
  const want = argv.filter((a, i) => !a.startsWith("--") && i !== skip);
  const N = Number((argv.find((a) => a.startsWith("--n=")) ?? "--n=30").split("=")[1]);
  if (want.length === 0) {
    console.error("Name at least one merchant. Checked nothing — a FAILURE, not a pass.");
    emitJson({ pass: false, reason: "no-merchant" });
    await prisma.$disconnect();
    process.exit(1);
  }

  const live = { merchant: { active: true }, isStale: false, flagged: false };
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ locale: "ro-RO", viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const out: Record<string, unknown>[] = [];

  try {
    for (const slug of want) {
      const m = await prisma.merchant.findFirst({ where: { slug, active: true }, select: { id: true } });
      if (!m) { console.error(`unknown or inactive merchant: ${slug}`); continue; }

      // For Sezamo the question is the GAP, so sample products with no brand.
      // For Carrefour the question is whether the detail page is RIGHT, so sample products whose
      // brand another merchant supplied — that is the only set that can grade an answer.
      const gradeable = slug === "carrefour";
      const offers = await prisma.offer.findMany({
        where: gradeable
          ? { merchantId: m.id, isStale: false, flagged: false, productUrl: { not: null }, product: { section: "grocery", brand: { not: null } } }
          : { merchantId: m.id, isStale: false, flagged: false, productUrl: { not: null }, product: { section: "grocery", brand: null } },
        select: { productUrl: true, storeName: true, rawSourceBlob: true, product: { select: { name: true, brand: true } } },
        orderBy: { id: "asc" },
      });
      if (offers.length === 0) { console.log(`${slug}: nothing to sample`); continue; }

      const step = Math.max(1, Math.floor(offers.length / N));
      const sample = offers.filter((_, i) => i % step === 0).slice(0, N);
      if (!(await allowedByRobots(sample[0].productUrl!))) {
        console.log(`${slug}: robots.txt disallows this path — not fetched`);
        continue;
      }

      console.log(`\n${"=".repeat(108)}`);
      console.log(`${slug} — ${sample.length} detail pages of ${offers.length} eligible ${gradeable ? "(products whose brand ANOTHER merchant supplied — gradeable)" : "(products with NO brand — the gap)"}`);
      console.log("=".repeat(108));

      let found = 0, agree = 0, graded = 0, ms = 0;
      const wheres = new Map<string, number>();
      for (const o of sample) {
        const r = await inspect(page, o.productUrl!);
        ms += r.ms;
        if (r.found) {
          found++;
          wheres.set(r.found.where, (wheres.get(r.found.where) ?? 0) + 1);
        }
        let verdict = r.found ? `${r.found.where} → ${r.found.value}` : `none (${r.note})`;
        if (gradeable && r.found) {
          graded++;
          const held = normalizeRo(o.product.brand ?? "");
          const got = normalizeRo(r.found.value);
          const ok = held === got || held.split(" ")[0] === got.split(" ")[0] || held.includes(got) || got.includes(held);
          if (ok) agree++;
          // the listing attribute, for contrast — this is what we store today
          let listing = "";
          try { listing = String(JSON.parse(o.rawSourceBlob ?? "{}").brand ?? ""); } catch { /* ignore */ }
          verdict += `   | we hold "${o.product.brand}" | listing said "${listing}" | detail ${ok ? "AGREES" : "DIFFERS"}`;
        }
        console.log(`  ${(o.storeName ?? o.product.name).slice(0, 40).padEnd(41)}${String(r.ms).padStart(6)}ms  ${verdict}`);
      }

      const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) : "—");
      console.log(`\n  brand published on the detail page: ${found}/${sample.length}  (${pct(found, sample.length)}%)`);
      console.log(`  where it was found: ${[...wheres].map(([k, v]) => `${k} ${v}`).join(", ") || "—"}`);
      console.log(`  seconds per page: ${(ms / sample.length / 1000).toFixed(1)}`);
      if (gradeable && graded) {
        console.log(`  DETAIL PAGE vs the brand another merchant supplied: ${agree}/${graded} agree (${pct(agree, graded)}%)`);
        console.log(`  (the LISTING attribute we store today agrees 53.8% — audit:brand-gap)`);
      }
      const gapAll = await prisma.offer.count({
        where: { merchantId: m.id, isStale: false, flagged: false, productUrl: { not: null }, product: { section: "grocery", brand: null } },
      });
      console.log(`  full harvest of this merchant's ${gapAll} brandless offers: ${((gapAll * (ms / sample.length)) / 3_600_000).toFixed(1)} h`);

      out.push({ merchant: slug, sampled: sample.length, found, foundRate: found / sample.length, graded, agree, secPerPage: ms / sample.length / 1000, gapAll, wheres: Object.fromEntries(wheres) });
    }
  } finally {
    await ctx.close();
    await browser.close();
  }

  if (out.length === 0) {
    console.error("\nNo page fetched. Checked nothing — a FAILURE, not a pass.");
    emitJson({ pass: false, reason: "nothing-fetched" });
    await prisma.$disconnect();
    process.exit(1);
  }
  emitJson({ pass: true, results: out });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
