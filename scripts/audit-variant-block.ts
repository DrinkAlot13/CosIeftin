// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// Counts EVERY row, shown or not — the blast radius of the variant rules.
// That is deliberate and is the opposite of the user-facing audits: a withheld row is
// still data, and a corruption hiding inside one is still a corruption. Do not add a
// visibility filter here.
// What does the variant-class hard block cost, measured over the whole catalog?
//
// CLAUDE.md: measure the blast radius, do not assume it. This re-runs `decide()` over every
// offer that is ALREADY matched, using each side's own recorded name, and reports which
// matches the new rules would refuse.
//
// The number that matters is the last one: how many products currently backed by two or more
// merchants fall below two. That is the real comparability correction — comparability that
// was never real, because the products were not the same product.
//
// Read-only. Run: npm run audit:variant-block

import { PrismaClient } from "@prisma/client";
import { decide, prep } from "../src/lib/scrape-util";
import { variantConflict } from "../src/lib/variant-classes";
import { parseQuantity } from "../src/lib/units/parseQuantity";

const prisma = new PrismaClient();

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { offers: { some: {} } },
    select: {
      id: true, name: true, brand: true, ean: true, unit: true, unitSize: true, section: true,
      offers: {
        select: {
          id: true, storeName: true, ownUnit: true, ownUnitSize: true, price: true,
          merchantId: true, merchant: { select: { slug: true } },
        },
      },
    },
  });

  let checked = 0;
  let wouldReject = 0;
  const byReason = new Map<string, number>();
  const samples: string[] = [];

  // Multi-merchant products, before and after.
  let multiBefore = 0;
  let multiAfter = 0;
  const brokenApart: { name: string; from: number; to: number; lost: string[] }[] = [];

  for (const p of products) {
    const catItem = prep(p.name, p.brand, p.ean);
    const catSize = { unit: p.unit, unitSize: p.unitSize };
    const survivors = new Set<number>();
    const before = new Set(p.offers.map((o) => o.merchantId));
    const lost: string[] = [];

    for (const o of p.offers) {
      // Only offers whose OWN name we recorded can be re-judged. A null storeName predates
      // the provenance column, and guessing one would be inventing the evidence.
      if (!o.storeName) { survivors.add(o.merchantId); continue; }
      checked++;
      const stSize = o.ownUnit && o.ownUnitSize ? { unit: o.ownUnit, unitSize: o.ownUnitSize } : catSize;
      const d = decide(catItem, catSize, prep(o.storeName, null, null), stSize, p.section);
      const isHardBlock = d.reason.startsWith("variant-") || d.reason === "pack-shape";
      if (!isHardBlock) { survivors.add(o.merchantId); continue; }
      wouldReject++;
      byReason.set(d.reason, (byReason.get(d.reason) ?? 0) + 1);
      lost.push(`${o.merchant.slug}:${o.storeName.slice(0, 40)}`);
      if (samples.length < 25) {
        const vc = variantConflict(p.name, o.storeName);
        samples.push(
          `    ${pad(p.name.slice(0, 44), 46)}\n      vs ${pad(o.merchant.slug, 12)} ${o.storeName.slice(0, 46)}\n` +
          `      ${d.reason}${vc ? ` — ${vc.klass}: ${JSON.stringify(vc.a)} vs ${JSON.stringify(vc.b)}` : ""}` +
          ` (pack ${parseQuantity(p.name)?.packCount ?? 1} vs ${parseQuantity(o.storeName)?.packCount ?? 1})`,
        );
      }
    }

    if (before.size >= 2) multiBefore++;
    if (survivors.size >= 2) multiAfter++;
    else if (before.size >= 2) {
      brokenApart.push({ name: p.name, from: before.size, to: survivors.size, lost });
    }
  }

  console.log("\n════ VARIANT-CLASS HARD BLOCK: BLAST RADIUS ═════════════════════════════════");
  console.log(`  offers re-judged (those carrying their own recorded name): ${checked}`);
  console.log(`  offers the new rules REFUSE:                               ${wouldReject}` +
    ` (${checked ? ((wouldReject / checked) * 100).toFixed(1) : "0.0"}%)`);
  console.log(`\n  by rule:`);
  for (const [r, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(r, 20)}${lp(n, 8)}`);
  }

  console.log("\n  THE COMPARABILITY CORRECTION:");
  console.log(`    products backed by 2+ merchants BEFORE: ${multiBefore}`);
  console.log(`    ...AFTER the hard block:               ${multiAfter}`);
  console.log(`    products that break apart:             ${multiBefore - multiAfter}`);
  console.log(`\n  That last figure is comparability we never actually had: the offers were on`);
  console.log(`  different products, so the comparison was between two things that do not`);
  console.log(`  compete. Losing it makes the number smaller and the site correct.`);

  if (samples.length > 0) {
    console.log(`\n  ${Math.min(25, samples.length)} EXAMPLES OF WHAT IS NOW REFUSED:`);
    console.log(samples.join("\n"));
  }

  if (brokenApart.length > 0) {
    console.log(`\n  15 PRODUCTS THAT STOP BEING COMPARABLE:`);
    for (const b of brokenApart.slice(0, 15)) {
      console.log(`    ${pad(b.name.slice(0, 50), 52)} ${b.from} → ${b.to} merchants`);
      for (const l of b.lost.slice(0, 3)) console.log(`        dropped ${l}`);
    }
  }
  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
