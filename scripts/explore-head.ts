// Every live grocery product under one head noun, with its size, its merchants, its prices and
// the class it already belongs to. READ-ONLY, for writing class rules by looking rather than
// by guessing.
//
//   npm run explore:head -- lapte
//   npm run explore:head -- lapte --unit=l --min=0.9 --max=1.1

import { PrismaClient } from "@prisma/client";
import { currentOfferWhere } from "../src/lib/queries";
import { headNoun, prep } from "../src/lib/scrape-util";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const heads = argv.filter((a) => !a.startsWith("--")).map((s) => s.toLowerCase());
  const opt = (k: string): string | undefined => argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
  const unit = opt("unit");
  const min = opt("min") ? Number(opt("min")) : undefined;
  const max = opt("max") ? Number(opt("max")) : undefined;
  const contains = opt("contains")?.toLowerCase();

  const live = currentOfferWhere();
  const products = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: live } },
    select: {
      id: true, name: true, brand: true, unit: true, unitSize: true,
      equivalenceClass: { select: { slug: true } },
      category: { select: { name: true } },
      offers: { where: live, select: { priceBani: true, merchant: { select: { slug: true } } } },
    },
  });

  for (const h of heads) {
    const hits = products.filter((p) => {
      if (headNoun(prep(p.name, p.brand, null).nname) !== h) return false;
      if (unit && p.unit !== unit) return false;
      if (min !== undefined && p.unitSize < min) return false;
      if (max !== undefined && p.unitSize > max) return false;
      if (contains && !p.name.toLowerCase().includes(contains)) return false;
      return true;
    });
    console.log(`\n${"=".repeat(110)}\n${h.toUpperCase()} — ${hits.length} live products${unit ? ` in ${unit}` : ""}${min !== undefined || max !== undefined ? ` sized ${min ?? "-"}..${max ?? "-"}` : ""}\n${"=".repeat(110)}`);
    const sorted = hits.sort((a, b) => a.unitSize - b.unitSize || a.name.localeCompare(b.name));
    for (const p of sorted) {
      const prices = p.offers
        .sort((a, b) => a.merchant.slug.localeCompare(b.merchant.slug))
        .map((o) => `${o.merchant.slug} ${o.priceBani == null ? "?" : (o.priceBani / 100).toFixed(2)}`)
        .join("  ");
      const cls = p.equivalenceClass ? `  [${p.equivalenceClass.slug}]` : "";
      console.log(`  ${`${p.unitSize}${p.unit}`.padEnd(9)} ${p.name.slice(0, 62).padEnd(62)} ${prices}${cls}`);
      if (process.argv.includes("--cat")) console.log(`${" ".repeat(12)}cat=${p.category?.name ?? "—"}  brand=${p.brand ?? "—"}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
