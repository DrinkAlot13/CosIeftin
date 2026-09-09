// ── ASSIGN `isPrivateLabel`. WRITES `ProductAttribute`.
//
// The table was completely empty, so `preferPrivateLabel` in the optimizer could never fire and
// the product page's own-brand sentence could never render. See `lib/private-label.ts`.
//
// ── IT CLEARS BEFORE IT WRITES, AND THE CLEAR IS SCOPED TO WHAT THE RULE NOW REFUSES.
//
// CLAUDE.md: "A SCRIPT THAT ASSIGNS MUST BE ABLE TO UNASSIGN." Both of this project's previous
// assigners had exactly this bug — a tightened rule that could not remove what the old rule had
// written, so the correction never landed and nothing failed. The evidence is scoped: a row is
// removed because the CURRENT rule rejects the CURRENT product, never because this run happened
// not to propose it.
//
// ── BRAND PLUS MERCHANT. A `Carrefour Classic` product stocked by Metro is not Metro's own
// brand, so it is only marked where the owning merchant actually sells it.
//
//   npm run assign:private-label -- --dry
//   npm run assign:private-label

import { PrismaClient } from "@prisma/client";
import { privateLabelOwner, PRIVATE_LABEL_BRANDS } from "../src/lib/private-label";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const KEY = "isPrivateLabel";

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");

  const products = await prisma.product.findMany({
    where: { brand: { not: null } },
    select: {
      id: true, name: true, brand: true, section: true,
      offers: { where: { merchant: { active: true } }, select: { merchant: { select: { slug: true } } } },
      attributes: { where: { key: KEY }, select: { id: true, value: true } },
    },
  });

  type Row = { id: number; brand: string; owner: string; name: string };
  const toWrite: Row[] = [];
  const toClear: { id: number; name: string; brand: string }[] = [];
  const byMerchant = new Map<string, number>();

  for (const p of products) {
    const sellers = p.offers.map((o) => o.merchant.slug);
    const owner = privateLabelOwner(p.brand, sellers);
    const existing = p.attributes[0] ?? null;

    if (owner) {
      byMerchant.set(owner, (byMerchant.get(owner) ?? 0) + 1);
      if (!existing || existing.value !== "true") {
        toWrite.push({ id: p.id, brand: p.brand as string, owner, name: p.name });
      }
    } else if (existing && existing.value === "true") {
      // THE UNASSIGN. The current rule rejects this product — the brand is not owned by any
      // merchant selling it — so the old assertion is removed rather than left to rot.
      toClear.push({ id: p.id, name: p.name, brand: p.brand as string });
    }
  }

  if (!dry) {
    for (const c of toClear) {
      await prisma.productAttribute.deleteMany({ where: { productId: c.id, key: KEY } });
    }
    for (const w of toWrite) {
      await prisma.productAttribute.upsert({
        where: { productId_key: { productId: w.id, key: KEY } },
        update: { value: "true", source: "name-parse", confidence: 0.9 },
        create: { productId: w.id, key: KEY, value: "true", source: "name-parse", confidence: 0.9 },
      });
    }
  }

  const total = await prisma.productAttribute.count({ where: { key: KEY, value: "true" } });

  console.log("═".repeat(100));
  console.log(`PRIVATE LABEL — brand AND merchant${dry ? "  (DRY RUN — nothing written)" : ""}`);
  console.log("═".repeat(100));
  console.log(`  branded products examined       ${products.length}`);
  console.log(`  marked isPrivateLabel           ${toWrite.length} new`);
  console.log(`  UNASSIGNED (rule now rejects)   ${toClear.length}`);
  console.log(`  rows in the table after this    ${dry ? "(unchanged in a dry run)" : total}`);

  console.log(`\n  BY OWNING MERCHANT — a product counts only where the owner actually sells it`);
  for (const slug of Object.keys(PRIVATE_LABEL_BRANDS)) {
    const n = byMerchant.get(slug) ?? 0;
    console.log(`    ${slug.padEnd(18)} ${String(n).padStart(6)}${n === 0 ? "   ← no products matched" : ""}`);
  }

  console.log(`\n  A SAMPLE TO READ — is each really the shop's own brand?`);
  for (const w of toWrite.slice(0, 20)) {
    console.log(`    [${w.owner.padEnd(14)}] ${w.brand.slice(0, 22).padEnd(22)} ${w.name.slice(0, 52)}`);
  }
  for (const c of toClear.slice(0, 8)) {
    console.log(`    UNASSIGNED  ${c.brand.slice(0, 22).padEnd(22)} ${c.name.slice(0, 52)}`);
  }

  emitJson({
    dry, examined: products.length, written: toWrite.length, cleared: toClear.length,
    totalAfter: dry ? null : total,
    byMerchant: Object.keys(PRIVATE_LABEL_BRANDS).map((m) => ({ merchant: m, products: byMerchant.get(m) ?? 0 })),
    sample: toWrite.slice(0, 100),
    pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
