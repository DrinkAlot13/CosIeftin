// Blast radius of the promo-pack parse (Phase 1a).
//
// Read-only. Runs the OLD reading and the NEW reading of every product name in the catalog
// and reports where they differ, per merchant — so the size of this change is a measurement
// rather than a claim.
//
// The old reading is reconstructed here on purpose instead of being imported: the point is to
// compare against what the database was actually written with, and that code no longer exists.
//
// Run: npm run audit:promo

import { PrismaClient } from "@prisma/client";
import { parseQuantity } from "../src/lib/units/parseQuantity";

const prisma = new PrismaClient();

/** The pre-Phase-1a reading: multipack, reversed multipack, then last single size. */
const UNIT_WORDS = "kg|kilograme|kilogram|kilo|gr|grame|gram|mg|miligrame|ml|mililitri|cl|centilitri|litri|litru|g|l|buc|bucata|bucati|bucăți|bucăţi|bucată|role|rola|plicuri|plic|capsule|caps|comprimate|compr|tablete|doze|felii|ouă|oua";
const FACTORS: [RegExp, string, number][] = [
  [/^(?:kg|kilograme?|kilo)$/i, "G", 1000], [/^(?:g|gr|grame?)$/i, "G", 1],
  [/^(?:mg|miligrame?)$/i, "G", 0.001], [/^(?:l|litri?|litru)$/i, "ML", 1000],
  [/^(?:cl|centilitri?)$/i, "ML", 10], [/^(?:ml|mililitri?)$/i, "ML", 1],
  [/^(?:buc|bucata|bucati|bucăți|bucăţi|bucată|role|rola|plicuri|plic|capsule|caps|comprimate|compr|tablete|doze|felii|oua|ouă)$/i, "BUC", 1],
];
const canon = (n: number, w: string): { value: number; unit: string } | null => {
  for (const [re, unit, f] of FACTORS) if (re.test(w)) { const v = Math.round(n * f * 1000) / 1000; return v > 0 ? { value: v, unit } : null; }
  return null;
};
const num = (s: string): number => parseFloat(s.replace(",", "."));

function oldReading(name: string): { value: number; unit: string; packCount: number } | null {
  const s = name.replace(/[  ]/g, " ").trim();
  if (!s) return null;
  const multi = s.match(new RegExp(String.raw`(\d+)\s*(?:buc|bucati|bucăți)?\s*[x×*]\s*([\d.,]+)\s*(${UNIT_WORDS})\b`, "i"));
  if (multi) { const c = parseInt(multi[1], 10); const o = canon(num(multi[2]), multi[3]); if (o && c > 0) return { value: o.value * c, unit: o.unit, packCount: c }; }
  const rev = s.match(new RegExp(String.raw`([\d.,]+)\s*(${UNIT_WORDS})\s*[x×*]\s*(\d+)\b`, "i"));
  if (rev) { const o = canon(num(rev[1]), rev[2]); const c = parseInt(rev[3], 10); if (o && c > 0) return { value: o.value * c, unit: o.unit, packCount: c }; }
  const re = new RegExp(String.raw`([\d.,]+)\s*(${UNIT_WORDS})\b`, "gi");
  let best: { value: number; unit: string } | null = null; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (s.slice(m.index + m[0].length).trimStart().startsWith("%")) continue;
    const q = canon(num(m[1]), m[2]); if (q) best = q;
  }
  return best ? { value: best.value, unit: best.unit, packCount: 1 } : null;
}

const pad = (s: string, n: number): string => s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
const lpad = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  const products = await prisma.product.findMany({
    select: {
      id: true, name: true, section: true,
      offers: { select: { merchant: { select: { slug: true } } } },
    },
  });

  type Row = { total: number; promo: number; changed: number; gained: number; examples: string[] };
  const byMerchant = new Map<string, Row>();
  const bySection = new Map<string, Row>();
  const get = (m: Map<string, Row>, k: string): Row => {
    let r = m.get(k);
    if (!r) { r = { total: 0, promo: 0, changed: 0, gained: 0, examples: [] }; m.set(k, r); }
    return r;
  };

  let total = 0, promo = 0, changed = 0, gained = 0;
  const worst: { name: string; oldV: string; newV: string; factor: number }[] = [];

  for (const p of products) {
    const before = oldReading(p.name);
    const after = parseQuantity(p.name);
    const merchants = [...new Set(p.offers.map((o) => o.merchant.slug))];
    const keys = merchants.length ? merchants : ["(unmatched)"];

    total++;
    const isPromo = !!after?.isPromoPack;
    // "changed" = the TOTAL quantity now reads differently, i.e. every unit price computed
    // from this product was wrong. "gained" = we now have a size where we had none.
    const diff = !!after && !!before && (Math.abs(after.value - before.value) > 0.001 || after.unit !== before.unit);
    const isGained = !!after && !before;

    if (isPromo) promo++;
    if (diff) changed++;
    if (isGained) gained++;

    for (const k of keys) {
      const r = get(byMerchant, k);
      r.total++; if (isPromo) r.promo++; if (diff) r.changed++; if (isGained) r.gained++;
      if (diff && r.examples.length < 2) r.examples.push(p.name.slice(0, 68));
    }
    const r = get(bySection, p.section ?? "(none)");
    r.total++; if (isPromo) r.promo++; if (diff) r.changed++; if (isGained) r.gained++;

    if (diff && before && after) {
      worst.push({
        name: p.name.slice(0, 62),
        oldV: `${before.value} ${before.unit}`,
        newV: `${after.value} ${after.unit} (${after.packCount}x${after.packSize})`,
        factor: before.value > 0 ? after.value / before.value : 0,
      });
    }
  }

  console.log("\n════ PROMO-PACK BLAST RADIUS ════════════════════════════════════════════════");
  console.log(`  catalog products scanned: ${total}`);
  console.log(`  now parse as a PROMO pack: ${promo}  (${((promo / total) * 100).toFixed(2)}%)`);
  console.log(`  TOTAL QUANTITY CHANGED:    ${changed}  (${((changed / total) * 100).toFixed(2)}%)  <- every unit price from these was wrong`);
  console.log(`  size gained where none:    ${gained}`);

  console.log("\n  BY MERCHANT");
  console.log(`  ${pad("merchant", 18)}${lpad("products", 9)}${lpad("promo", 7)}${lpad("changed", 9)}${lpad("gained", 8)}`);
  for (const [k, r] of [...byMerchant.entries()].sort((a, b) => b[1].changed - a[1].changed)) {
    console.log(`  ${pad(k, 18)}${lpad(r.total, 9)}${lpad(r.promo, 7)}${lpad(r.changed, 9)}${lpad(r.gained, 8)}${r.changed ? "  ⚠" : ""}`);
    for (const e of r.examples) console.log(`  ${pad("", 18)}    ${e}`);
  }

  console.log("\n  BY SECTION");
  console.log(`  ${pad("section", 18)}${lpad("products", 9)}${lpad("promo", 7)}${lpad("changed", 9)}`);
  for (const [k, r] of [...bySection.entries()].sort((a, b) => b[1].changed - a[1].changed)) {
    console.log(`  ${pad(k, 18)}${lpad(r.total, 9)}${lpad(r.promo, 7)}${lpad(r.changed, 9)}`);
  }

  if (worst.length) {
    console.log("\n  LARGEST CORRECTIONS (old reading -> new reading)");
    for (const w of worst.sort((a, b) => b.factor - a.factor).slice(0, 25)) {
      console.log(`  ${w.factor.toFixed(1)}x  ${pad(w.name, 62)}  ${w.oldV}  ->  ${w.newV}`);
    }
  }

  console.log("\n  Nothing was written. Re-scrape is what applies this.\n");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
