// ── HARVEST BRANDS FROM MERCHANT DETAIL PAGES. WRITTEN, NOT RUN.
//
// QUEUED FOR AFTER THE SOAK. See docs/BRAND-BACKFILL-QUEUE.md. It is committed unrun on purpose:
// it fetches thousands of pages and writes to `Product.brand`, which feeds `decide()`'s brand
// gate, and neither belongs in the middle of a fortnight that is measuring the app.
//
// ── WHY THIS IS TRUTH AND THE OTHER ROUTES WERE NOT.
//
// `docs/BRAND-GAP.md` rejected two inference routes. The naming-convention rule graded 99.3% and
// still wrote "chivas" for chives, because it could only be graded on the population that did not
// need it. This route asks the merchant and writes what the merchant says. Measured availability:
//
//     sezamo      40/40 pages publish one   (37 brand link, 3 embedded json)   4.2 s/page
//     carrefour   25/25 pages publish one   (json-ld brand.name)               9.2 s/page
//
// ── ONE-OFF, NOT NIGHTLY.
//
// This is a fixed gap, not a drifting value: a product's brand does not change. So the shape is
// one backfill pass, then a detail fetch only for products the listing scrape sees for the FIRST
// time. `--new-only` does the second. A rotating nightly slice would pay the cost forever for a
// question that is answered once.
//
// ── SAFETY.
//
//   · never overwrites a brand that is already set, unless --overwrite is passed (Carrefour needs
//     it, because its column was voided; Sezamo does not, because its column is empty);
//   · every write is marked ProductAttribute(key="brand", source="merchant-detail") so
//     `--clear` removes exactly what this wrote — CLAUDE.md: an assigner must be able to unassign;
//   · --limit bounds a run so it can be done in slices;
//   · robots.txt honoured, one page at a time.
//
//   npm run backfill:detail-brands -- sezamo --limit=50            # dry run
//   npm run backfill:detail-brands -- sezamo --limit=50 --write
//   npm run backfill:detail-brands -- carrefour --write --overwrite
//   npm run backfill:detail-brands -- sezamo --new-only --write
//   npm run backfill:detail-brands -- --clear --write

import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import { brandFromDetailPage } from "../src/lib/brand/from-detail-page";
import { allowedByRobots } from "../src/lib/net/robots";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const SOURCE = "merchant-detail";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // Guard the -1 case: with no `--json` present, `jsonIdx + 1` is 0 and this ate the first
  // merchant argument, producing a run that checked nothing.
  const jsonIdx = argv.indexOf("--json");
  const skip = jsonIdx >= 0 ? jsonIdx + 1 : -1;
  const want = argv.filter((a, i) => !a.startsWith("--") && i !== skip);
  const write = argv.includes("--write");
  const overwrite = argv.includes("--overwrite");
  const newOnly = argv.includes("--new-only");
  const clear = argv.includes("--clear");
  const limit = Number((argv.find((a) => a.startsWith("--limit=")) ?? "--limit=0").split("=")[1]) || Infinity;

  if (clear) {
    const marks = await prisma.productAttribute.findMany({ where: { key: "brand", source: SOURCE }, select: { productId: true } });
    console.log(`CLEAR: ${marks.length} brands were written by this script.`);
    if (!write) { console.log("  dry run; pass --write."); await prisma.$disconnect(); return; }
    await prisma.product.updateMany({ where: { id: { in: marks.map((m) => m.productId) } }, data: { brand: null } });
    await prisma.productAttribute.deleteMany({ where: { key: "brand", source: SOURCE } });
    console.log("  cleared.");
    await prisma.$disconnect();
    return;
  }

  if (want.length === 0) {
    console.error("Name at least one merchant. Checked nothing — a FAILURE, not a pass.");
    emitJson({ pass: false, reason: "no-merchant" });
    await prisma.$disconnect();
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ locale: "ro-RO", viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const results: Record<string, unknown>[] = [];

  try {
    for (const slug of want) {
      const m = await prisma.merchant.findFirst({ where: { slug, active: true }, select: { id: true } });
      if (!m) { console.error(`unknown or inactive merchant: ${slug}`); continue; }

      const targets = await prisma.offer.findMany({
        where: {
          merchantId: m.id, isStale: false, flagged: false, productUrl: { not: null },
          product: {
            section: "grocery",
            ...(overwrite ? {} : { brand: null }),
            // --new-only: products first seen recently, for steady-state upkeep after the
            // one-off pass. A brand does not drift, so re-asking about old products is waste.
            ...(newOnly ? { createdAt: { gte: new Date(Date.now() - 7 * 864e5) } } : {}),
          },
        },
        select: { productUrl: true, storeName: true, product: { select: { id: true, name: true, brand: true } } },
        orderBy: { id: "asc" },
        take: Number.isFinite(limit) ? limit : undefined,
      });

      console.log(`\n${"=".repeat(96)}`);
      console.log(`${slug} — ${targets.length} products to ask about. ${write ? "WRITING" : "DRY RUN"}`);
      console.log("=".repeat(96));
      if (targets.length === 0) continue;
      if (!(await allowedByRobots(targets[0].productUrl!))) {
        console.log("  robots.txt disallows this path — not fetched");
        continue;
      }

      let found = 0, wrote = 0, ms = 0;
      for (const [i, t] of targets.entries()) {
        const t0 = Date.now();
        const resp = await page.goto(t.productUrl!, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
        let hit = null;
        if (resp && resp.status() < 400) {
          await page.waitForTimeout(2500);
          hit = await brandFromDetailPage(page);
        }
        ms += Date.now() - t0;
        if (hit) {
          found++;
          if (write) {
            await prisma.product.update({ where: { id: t.product.id }, data: { brand: hit.value } });
            await prisma.productAttribute.upsert({
              where: { productId_key: { productId: t.product.id, key: "brand" } },
              create: { productId: t.product.id, key: "brand", value: hit.value, source: SOURCE, confidence: 1 },
              update: { value: hit.value, source: SOURCE, confidence: 1 },
            });
            wrote++;
          }
        }
        if ((i + 1) % 25 === 0) {
          console.log(`  …${i + 1}/${targets.length}  found ${found}  ${(ms / (i + 1) / 1000).toFixed(1)}s/page`);
        }
      }
      const pct = targets.length ? ((found / targets.length) * 100).toFixed(1) : "—";
      console.log(`\n  brand published: ${found}/${targets.length} (${pct}%)   written: ${wrote}   ${(ms / targets.length / 1000).toFixed(1)}s/page`);
      results.push({ merchant: slug, asked: targets.length, found, wrote, secPerPage: ms / targets.length / 1000 });
    }
  } finally {
    await ctx.close();
    await browser.close();
  }

  if (write) {
    console.log(`\n  Verify from outside with: npm run audit:brands`);
    console.log(`  Reverse with:             npm run backfill:detail-brands -- --clear --write`);
  } else {
    console.log(`\n  DRY RUN. Nothing written.`);
  }
  emitJson({ pass: true, write, results });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
