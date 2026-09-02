// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// Counts EVERY row, shown or not — every stored unit price, shown or not.
// That is deliberate and is the opposite of the user-facing audits: a withheld row is
// still data, and a corruption hiding inside one is still a corruption. Do not add a
// visibility filter here.
// Does every stored unit price still equal price ÷ the offer's OWN size?
//
// Mega Image showed 5,30 lei/L where 10,49 ÷ 2 L is 5,25. The writer was fixed — unit price
// now comes from the offer's own parsed size rather than the catalog product's — but rows
// written before that fix still hold the old value, computed against a 1.98 L catalog entry.
//
// The distinction this audit exists to draw:
//
//   a row LAST WRITTEN BEFORE its merchant's re-scrape   → legacy, clears on re-scrape
//   a row LAST WRITTEN AFTER  its merchant's re-scrape   → A LIVE BUG in the writer
//
// Without that split the report is just "N rows are wrong", which is true, unactionable, and
// indistinguishable from the writer still being broken.
//
// Read-only. Run: npm run audit:unit-recompute

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

/** The commit that made the writer use the offer's own size. Rows written after it must agree. */
const WRITER_FIXED_AT = new Date("2026-09-01T16:00:00Z");

async function main(): Promise<void> {
  const merchants = await prisma.merchant.findMany({
    where: { active: true },
    select: { id: true, slug: true },
    orderBy: { slug: "asc" },
  });

  console.log("\n════ UNIT PRICE = PRICE ÷ THE OFFER'S OWN SIZE ══════════════════════════════");
  console.log("  A row written AFTER the writer fix that still disagrees is a live bug.");
  console.log("  A row written before it is legacy and clears when its merchant re-scrapes.\n");
  console.log(
    `  ${pad("merchant", 14)}${lp("offers", 8)}${lp("no own size", 13)}${lp("checkable", 11)}` +
    `${lp("agree", 8)}${lp("legacy", 8)}${lp("LIVE BUG", 10)}`,
  );

  let liveBugs = 0;
  const samples: string[] = [];

  for (const m of merchants) {
    const offers = await prisma.offer.findMany({
      where: { merchantId: m.id },
      select: {
        id: true, price: true, pricePerUnit: true, ownUnit: true, ownUnitSize: true,
        lastObservedAt: true, storeName: true,
        product: { select: { name: true } },
      },
    });
    let checkable = 0, agree = 0, legacy = 0, live = 0, noOwnSize = 0;
    for (const o of offers) {
      // Only rows carrying their OWN size can be recomputed. Using the catalog size would be
      // reproducing the exact bug this audit is looking for — so a row without one is not
      // "fine", it is UNVERIFIABLE, and that is worth its own column. Those rows predate the
      // ownUnitSize provenance field and hold unit prices computed against the catalog size:
      // Mega Image's 5,30 lei/L where 10,49 / 2 L is 5,25 is one of them.
      if (!o.ownUnitSize || o.ownUnitSize <= 0 || o.price <= 0) { noOwnSize++; continue; }
      checkable++;
      const expected = o.price / o.ownUnitSize;
      const ok = o.pricePerUnit > 0 && Math.abs(o.pricePerUnit - expected) / expected < 0.01;
      if (ok) { agree++; continue; }
      const writtenAfterFix = o.lastObservedAt != null && o.lastObservedAt >= WRITER_FIXED_AT;
      if (writtenAfterFix) {
        live++;
        if (samples.length < 15) {
          samples.push(
            `    ${pad(m.slug, 12)} ${pad((o.storeName ?? o.product.name).slice(0, 40), 42)} ` +
            `stored ${o.pricePerUnit.toFixed(2).padStart(9)}  expected ${expected.toFixed(2).padStart(9)}  ` +
            `(${o.price} / ${o.ownUnitSize} ${o.ownUnit})`,
          );
        }
      } else {
        legacy++;
      }
    }
    liveBugs += live;
    if (offers.length === 0) continue;
    console.log(
      `  ${pad(m.slug, 14)}${lp(offers.length, 8)}${lp(noOwnSize, 13)}${lp(checkable, 11)}` +
      `${lp(agree, 8)}${lp(legacy, 8)}${lp(live, 10)}${live > 0 ? "  ⚠" : ""}`,
    );
  }

  console.log(`\n  LIVE BUGS (written after the writer fix and still wrong): ${liveBugs}`);
  if (samples.length > 0) {
    console.log(`\n  ${samples.length} example(s):`);
    console.log(samples.join("\n"));
  } else {
    console.log(`  ✓ every row written since the fix recomputes correctly.`);
    console.log(`  Anything in the "legacy" column clears when that merchant is re-scraped.`);
  }
  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
