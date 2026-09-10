// ── REMOVE THE BRANDS CARREFOUR'S `data-brand` PUT INTO THE CATALOG. REVERSIBLE.
//
// `docs/CARREFOUR-BRAND.md`: `data-brand` agrees with independently-supplied brands 53.8% of the
// time, against 98.8% for Mega Image and 97.7% for Freshful. It is a promoted-brand slot, not a
// per-product attribute — "Dorna" on Aqua Carpatica, Borsec and Perla Harghitei alike.
//
// `Product.brand` feeds `decide()`'s brand gate. A wrong brand there does not cost a comparison,
// it MANUFACTURES one, which is the Zarea shape CLAUDE.md records. So a field measured at 53.8%
// is worse than an empty one, and this empties it.
//
// ── WHICH ROWS, AND WHY THAT IS AN INFERENCE.
//
// We do not store which merchant supplied a brand. The proxy is `Product.brand` equalling
// Carrefour's own listing value, which is strong but not a record: where two merchants agree it
// attributes the brand to Carrefour wrongly and this would clear a brand that was independently
// correct. That is why the rule requires the value to match Carrefour's listing AND to be
// contradicted by nothing better — a product whose brand ALSO matches another merchant's payload
// is left alone.
//
// ── UNASSIGNMENT. CLAUDE.md: a script that assigns must be able to unassign.
//
// The previous value is stored in `ProductAttribute(key="brand:pre-carrefour-void")` before the
// null, so `--restore` puts back exactly what was there and nothing else.
//
//   npm run null:carrefour-brands                  # dry run
//   npm run null:carrefour-brands -- --write
//   npm run null:carrefour-brands -- --restore --write

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const KEY = "brand:pre-carrefour-void";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function listingBrand(blob: string | null): string {
  if (!blob) return "";
  try {
    const j = JSON.parse(blob) as { brand?: unknown };
    return typeof j.brand === "string" ? j.brand.trim() : "";
  } catch {
    return "";
  }
}
/** Any brand-ish value a NON-Carrefour merchant's payload carries. */
function anyBrand(blob: string | null): string {
  if (!blob) return "";
  try {
    const j = JSON.parse(blob) as Record<string, unknown>;
    for (const k of ["brand", "manufacturerName", "marca", "producator"]) {
      const v = j[k];
      if (typeof v === "string" && v.trim().length > 1) return v.trim();
    }
  } catch { /* truncated payloads are common; not an error */ }
  return "";
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const restore = process.argv.includes("--restore");

  if (restore) {
    const saved = await prisma.productAttribute.findMany({ where: { key: KEY }, select: { productId: true, value: true } });
    console.log(`RESTORE: ${saved.length} brands were voided by this script.`);
    if (!write) { console.log("  dry run; pass --write."); await prisma.$disconnect(); return; }
    for (const s of saved) await prisma.product.update({ where: { id: s.productId }, data: { brand: s.value } });
    await prisma.productAttribute.deleteMany({ where: { key: KEY } });
    console.log(`  restored ${saved.length}.`);
    await prisma.$disconnect();
    return;
  }

  const live = { merchant: { active: true }, isStale: false, flagged: false };
  const offers = await prisma.offer.findMany({
    where: { merchant: { slug: "carrefour" }, isStale: false, flagged: false, product: { section: "grocery", brand: { not: null } } },
    select: {
      storeName: true,
      rawSourceBlob: true,
      product: {
        select: {
          id: true, name: true, brand: true,
          offers: { where: live, select: { rawSourceBlob: true, merchant: { select: { slug: true } } } },
        },
      },
    },
  });

  const plan: { id: number; name: string; brand: string; shops: number }[] = [];
  let spared = 0;
  for (const o of offers) {
    const p = o.product;
    const pb = p.brand ?? "";
    const lb = listingBrand(o.rawSourceBlob);
    if (!lb || norm(pb) !== norm(lb)) continue;

    // ── THE DISCRIMINATOR, AND THE FIRST VERSION OF THIS SCRIPT GOT IT WRONG.
    //
    // "Product.brand equals Carrefour's listing value" identifies rows Carrefour SOURCED. It does
    // not identify rows Carrefour got WRONG — and Carrefour is right 53.8% of the time, so that
    // rule would have voided ~1,000 correct brands to remove ~800 bad ones. The dry run showed it
    // plainly: Olympus on "Smantana de gatit Olympus", Borsec on "Apa minerala Borsec", Boromir on
    // "Chec marmorat Boromir". Deleting those is not a repair.
    //
    // The signal that separates them needs no network and is the shape this project prefers: the
    // merchant's OWN TWO FIELDS DISAGREEING. Where `data-brand` names a brand that Carrefour's own
    // product name does not mention, the two halves of one payload contradict each other — and
    // every confirmed error is of exactly that form:
    //
    //     data-brand "Dorna"        name "Apa ... Aqua Carpatica 2L"
    //     data-brand "Barilla"      name "Sos habanero Tabasco 60ml"
    //     data-brand "Lex"          name "Detergent lichid Perwoll Color 2000ml"
    //
    // while every correct one is corroborated by the name itself. This is an internal check with
    // the usual limit — a merchant may legitimately name a product without its brand — so a
    // second corroboration also spares the row: another merchant's payload naming the same brand.
    // The brand's LONGEST token, not its first. "Dr. Oetker" normalises to "dr oetker", whose
    // first token is "dr" — two characters, which failed the length guard and would have voided
    // every Dr. Oetker product despite the name saying "Cacao pudra Dr.Oetker". The longest token
    // is the identifying one for exactly the multi-word brands where the first is an abbreviation.
    const brandToks = norm(pb).split(" ").filter((t) => t.length >= 3);
    const brandTok = brandToks.sort((a, b) => b.length - a.length)[0] ?? "";
    if (!brandTok) { spared++; continue; } // nothing long enough to judge on — do not touch it

    const ownName = norm(`${o.storeName ?? ""} ${p.name}`);
    const inOwnName = ownName.includes(brandTok);
    const corroborated = p.offers.some((x) => {
      if (x.merchant.slug === "carrefour") return false;
      const other = anyBrand(x.rawSourceBlob);
      return other !== "" && norm(other).includes(brandTok);
    });
    if (inOwnName || corroborated) { spared++; continue; }

    plan.push({ id: p.id, name: p.name, brand: pb, shops: new Set(p.offers.map((x) => x.merchant.slug)).size });
  }

  const multi = plan.filter((x) => x.shops >= 2);
  console.log("═".repeat(96));
  console.log(`  VOID CARREFOUR-SOURCED BRANDS — ${write ? "WRITING" : "DRY RUN"}`);
  console.log("═".repeat(96));
  console.log(`  carrefour live grocery offers whose product has a brand: ${offers.length}`);
  console.log(`  brand equals Carrefour's own listing value:              ${plan.length + spared}`);
  console.log(`    SPARED (brand IS in Carrefour's own name, or corroborated):  ${spared}`);
  console.log(`    to be voided:                                         ${plan.length}`);
  console.log(`      of those, products matched to 2+ merchants:         ${multi.length}`);
  console.log(`\n  sample of what is being removed:`);
  for (const w of plan.slice(0, 15)) console.log(`    ${w.brand.slice(0, 22).padEnd(23)} ${w.name.slice(0, 56)}`);

  if (!write) {
    console.log(`\n  DRY RUN. Nothing written.`);
    emitJson({ pass: true, wouldVoid: plan.length, spared, multiMerchant: multi.length });
    await prisma.$disconnect();
    return;
  }

  for (const w of plan) {
    await prisma.productAttribute.upsert({
      where: { productId_key: { productId: w.id, key: KEY } },
      create: { productId: w.id, key: KEY, value: w.brand, source: "human", confidence: 1 },
      update: { value: w.brand },
    });
    await prisma.product.update({ where: { id: w.id }, data: { brand: null } });
  }
  console.log(`\n  VOIDED ${plan.length}. Previous values saved under ProductAttribute("${KEY}").`);
  console.log(`  Reverse with: npm run null:carrefour-brands -- --restore --write`);
  emitJson({ pass: true, voided: plan.length, spared, multiMerchant: multi.length });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
