// ── POPULATE `Product.brand` FROM THE MERCHANT'S OWN STORED PAYLOAD. TRUTH ONLY.
//
// `audit:brand-gap` measured three routes to the 11,312 products with no brand. This script
// takes ONE of them — route 1, the merchant's own payload, already sitting in
// `Offer.rawSourceBlob`. It is the only route that is a fact rather than an inference.
//
// ── WHY THE OTHER TWO ROUTES ARE NOT HERE, AND THIS IS THE WHOLE POINT.
//
// The naming-convention route (Sezamo's storeName leads with the brand) grades at 99.3-100%
// against products whose brand a DIFFERENT merchant supplied. Three variants were built and
// graded; every one of them scored ≥99% and every one of them wrote visible nonsense onto the
// population that actually needs it:
//
//     andive, gulii, apio, capsune   ← produce, from the raw lead token
//     chivas                          ← "Chivas proaspat legatura" is CHIVES; the token is in
//                                       the brand vocabulary because Chivas Regal exists
//     cookie                          ← "Cookie cu cacao 85 g" is a product word
//
// The reason is structural and it is the same trap as `audit:off-hitrate`'s route 2: a rule can
// only be graded where the answer is already known, and where the answer is already known is
// exactly where the rule is easy. Sezamo's graded overlap is mainstream branded goods; Sezamo's
// GAP is produce and private label.
//
// CLAUDE.md's Zarea regression is one loose brand backing 64 unrelated wines, and `Product.brand`
// feeds `decide()`'s brand gate. A wrong brand does not cost a comparison — it manufactures one.
// So: truth only, and the inference routes stay unshipped with the evidence written down.
//
// ── UNASSIGNMENT. CLAUDE.md: a script that assigns must be able to unassign.
//
// Every write records provenance in `ProductAttribute` (key "brand", source "merchant-feed"), so
// `--clear` can remove exactly what this script wrote and nothing a human or a scraper set.
//
//   npm run backfill:brands              # dry run, prints what it would write
//   npm run backfill:brands -- --write
//   npm run backfill:brands -- --clear --write

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const SOURCE = "merchant-feed";

const PLACEHOLDER = new Set([
  "", "-", "--", "n/a", "na", "null", "undefined", "none", "no brand", "nobrand",
  "fara marca", "fara brand", "generic", "altele", "diverse", "mega",
]);
const isPlaceholder = (v: string): boolean => {
  const t = v.trim().toLowerCase();
  return PLACEHOLDER.has(t) || /^\(.*\)$/.test(t) || t.length < 2 || t.length > 60;
};

function brandFromBlob(blob: string | null): { value: string; key: string } | null {
  if (!blob) return null;
  let obj: unknown;
  try { obj = JSON.parse(blob); } catch { return null; }
  const keys = ["brand", "manufacturerName", "marca", "producator", "brandName", "manufacturer"];
  const walk = (o: unknown, depth: number): { value: string; key: string } | null => {
    if (!o || typeof o !== "object" || depth > 4) return null;
    const rec = o as Record<string, unknown>;
    for (const k of keys) {
      const v = rec[k];
      if (typeof v === "string" && !isPlaceholder(v)) return { value: v.trim(), key: k };
      if (v && typeof v === "object" && typeof (v as Record<string, unknown>).name === "string") {
        const n = String((v as Record<string, unknown>).name);
        if (!isPlaceholder(n)) return { value: n.trim(), key: `${k}.name` };
      }
    }
    for (const v of Object.values(rec)) {
      const hit = walk(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  return walk(obj, 0);
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const clear = process.argv.includes("--clear");

  if (clear) {
    const marks = await prisma.productAttribute.findMany({
      where: { key: "brand", source: SOURCE },
      select: { productId: true },
    });
    console.log(`CLEAR: ${marks.length} products were branded by this script.`);
    if (write) {
      await prisma.product.updateMany({ where: { id: { in: marks.map((m) => m.productId) } }, data: { brand: null } });
      await prisma.productAttribute.deleteMany({ where: { key: "brand", source: SOURCE } });
      console.log("  cleared.");
    } else {
      console.log("  dry run; pass --write to clear.");
    }
    await prisma.$disconnect();
    return;
  }

  const live = { merchant: { active: true }, isStale: false, flagged: false };
  const targets = await prisma.product.findMany({
    where: { section: "grocery", brand: null, offers: { some: live } },
    select: { id: true, name: true, offers: { where: live, select: { rawSourceBlob: true, merchant: { select: { slug: true } } } } },
  });

  const plan: { id: number; name: string; brand: string; from: string; merchant: string }[] = [];
  for (const p of targets) {
    const hit = p.offers.map((o) => ({ o, b: brandFromBlob(o.rawSourceBlob) })).find((x) => x.b);
    if (!hit?.b) continue;
    plan.push({ id: p.id, name: p.name, brand: hit.b.value, from: hit.b.key, merchant: hit.o.merchant.slug });
  }

  const byMerchant = new Map<string, number>();
  for (const w of plan) byMerchant.set(w.merchant, (byMerchant.get(w.merchant) ?? 0) + 1);

  console.log("═".repeat(96));
  console.log(`  BACKFILL BRANDS — merchant-supplied only (route 1). ${write ? "WRITING" : "DRY RUN"}`);
  console.log("═".repeat(96));
  console.log(`  grocery products with no brand and a live offer: ${targets.length}`);
  console.log(`  of those, the stored payload carries a brand:    ${plan.length}`);
  console.log(`\n  by merchant supplying it:`);
  for (const [m, n] of [...byMerchant].sort((a, b) => b[1] - a[1])) console.log(`    ${m.padEnd(16)}${String(n).padStart(6)}`);

  const distinct = new Map<string, number>();
  for (const w of plan) distinct.set(w.brand, (distinct.get(w.brand) ?? 0) + 1);
  console.log(`\n  distinct brand values to be written: ${distinct.size}`);
  console.log(`  the 20 commonest:`);
  for (const [b, n] of [...distinct].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`    ${String(n).padStart(5)}  ${b}`);

  if (!write) {
    console.log(`\n  DRY RUN. Nothing written. Pass --write.`);
    emitJson({ pass: true, wouldWrite: plan.length, distinct: distinct.size });
    await prisma.$disconnect();
    return;
  }

  let done = 0;
  for (const w of plan) {
    await prisma.product.update({ where: { id: w.id }, data: { brand: w.brand } });
    await prisma.productAttribute.upsert({
      where: { productId_key: { productId: w.id, key: "brand" } },
      create: { productId: w.id, key: "brand", value: w.brand, source: SOURCE, confidence: 1 },
      update: { value: w.brand, source: SOURCE, confidence: 1 },
    });
    done++;
    if (done % 100 === 0) console.log(`    …${done}/${plan.length}`);
  }
  console.log(`\n  WROTE ${done} brands, each marked ProductAttribute(key=brand, source=${SOURCE}).`);
  console.log(`  Verify with: npm run audit:brands`);
  emitJson({ pass: true, wrote: done, distinct: distinct.size });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
