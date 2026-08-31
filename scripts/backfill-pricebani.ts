// Repair the drifted bani columns from the float, then keep them in step.
//
// The bani migration was verified exact on 43,103 offers. It then drifted, because
// `matchPoolToCatalog` — the write path for 11 of the 12 merchants — did not set `priceBani`
// at all. New offers got NULL; updated offers kept whatever the migration wrote while their
// float moved on. Nothing caught it because every user-facing read still used the float, so the
// integer column was exercised by nothing a shopper could touch.
//
// WHICH COLUMN IS TRUE. The float, and this is checked rather than assumed: on every drifted
// row the float matches `rawPriceText`, the verbatim string the price was parsed from, and the
// bani column does not. 614 of the 615 disagreements are a completely different value, not a
// rounding difference — e.g. a Glenfiddich whose rawPriceText reads "152.42", whose float is
// 152.42, and whose priceBani says 44997 (449.97 lei), left over from before the price changed.
//
// So the float is the observation and bani is the stale copy. After this run the direction
// reverses permanently: the scrapers now write bani first and derive the float from it.
//
// Run: npm run backfill:pricebani            (dry run)
//      npm run backfill:pricebani -- --apply (writes)

import { PrismaClient } from "@prisma/client";
import { baniToLei, leiToBaniExact } from "../src/lib/price/parsePrice";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  console.log(APPLY ? "APPLY — this writes.\n" : "DRY RUN — nothing is written. Add --apply to write.\n");

  const offers = await prisma.offer.findMany({
    select: {
      id: true, price: true, priceBani: true, rawPriceText: true, isStale: true,
      merchant: { select: { slug: true } },
    },
  });

  type Fix = { id: number; from: number | null; to: number; kind: "null" | "drift"; merchant: string; corroborated: boolean };
  const fixes: Fix[] = [];

  for (const o of offers) {
    const want = leiToBaniExact(o.price);
    if (o.priceBani == null) {
      fixes.push({ id: o.id, from: null, to: want, kind: "null", merchant: o.merchant.slug, corroborated: corroborates(o.rawPriceText, o.price) });
    } else if (Math.abs(o.priceBani - want) > 1) {
      fixes.push({ id: o.id, from: o.priceBani, to: want, kind: "drift", merchant: o.merchant.slug, corroborated: corroborates(o.rawPriceText, o.price) });
    }
  }

  const byMerchant = new Map<string, { nulls: number; drift: number; corroborated: number }>();
  for (const f of fixes) {
    const r = byMerchant.get(f.merchant) ?? { nulls: 0, drift: 0, corroborated: 0 };
    if (f.kind === "null") r.nulls++; else r.drift++;
    if (f.corroborated) r.corroborated++;
    byMerchant.set(f.merchant, r);
  }

  console.log(`  offers scanned      ${offers.length}`);
  console.log(`  null priceBani      ${fixes.filter((f) => f.kind === "null").length}`);
  console.log(`  drifted from float  ${fixes.filter((f) => f.kind === "drift").length}`);
  console.log(`  TO REPAIR           ${fixes.length}\n`);

  console.log(`  ${pad("merchant", 16)}${lp("nulls", 8)}${lp("drifted", 9)}${lp("float agrees with rawPriceText", 32)}`);
  for (const [k, r] of [...byMerchant.entries()].sort((a, b) => (b[1].nulls + b[1].drift) - (a[1].nulls + a[1].drift))) {
    console.log(`  ${pad(k, 16)}${lp(r.nulls, 8)}${lp(r.drift, 9)}${lp(`${r.corroborated}/${r.nulls + r.drift}`, 32)}`);
  }

  if (!APPLY) {
    console.log("\n  DRY RUN — nothing written. Re-run with --apply.\n");
    await prisma.$disconnect();
    return;
  }

  console.log("\n  writing…");
  let n = 0;
  for (const f of fixes) {
    // Write BOTH, from the same integer, so the row leaves this script consistent by
    // construction rather than by luck.
    await prisma.offer.update({
      where: { id: f.id },
      data: { priceBani: f.to, price: baniToLei(f.to) },
    });
    if (++n % 200 === 0) process.stdout.write(`\r  ${n}/${fixes.length}`);
  }
  console.log(`\r  ${n}/${fixes.length} repaired        `);

  // Verify by re-reading, not by trusting the loop above.
  const after = await prisma.offer.findMany({ select: { id: true, price: true, priceBani: true, isStale: true } });
  const stillNull = after.filter((o) => !o.isStale && o.priceBani == null).length;
  const stillOff = after.filter((o) => o.priceBani != null && Math.abs(o.priceBani - Math.round(o.price * 100)) > 1).length;
  console.log(`\n  verification: live nulls ${stillNull}, disagreements ${stillOff}`);
  console.log(stillNull === 0 && stillOff === 0 ? "\n✓ bani and float agree on every row\n" : "\n✗ VERIFICATION FAILED\n");

  await prisma.$disconnect();
  if (stillNull > 0 || stillOff > 0) process.exit(1);
}

/** Does the verbatim source string contain the float's value? Evidence, not proof. */
function corroborates(raw: string | null, price: number): boolean {
  if (!raw) return false;
  const digits = raw.replace(/[^\d]/g, "");
  const asBani = String(leiToBaniExact(price));
  return digits.includes(asBani) || raw.includes(price.toFixed(2)) || raw.includes(price.toFixed(2).replace(".", ","));
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
