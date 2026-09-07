// How much of the live catalog is inside an equivalence class today, and how much of the
// PRIVATE-LABEL catalog is. READ-ONLY.
//
// The brief asks to extend classes to private-label staples. Before writing any, this says what
// the existing ~100 classes already reach — otherwise the new work either duplicates them or,
// worse, steals their members: Product.equivalenceClassId is a single FK, so a product can only
// ever be in ONE class, and a new class that matches an assigned product is a conflict rather
// than an addition.

import { PrismaClient } from "@prisma/client";
import { currentOfferWhere } from "../src/lib/queries";

const prisma = new PrismaClient();

const PL_BRANDS = [
  "MEGA", "Gusturi romanesti", "Nature's Promise", "Emma", "Auchan", "Carrefour Classic",
  "Sezamo", "Metro Chef", "Fine Life", "K-Classic", "Nr.1", "ARO", "Pouce", "Carrefour",
  "Carrefour Bio", "Carrefour Sensation", "Filiera Auchan", "Nature's Promise Bio",
  "Din Gradina by Freshful", "Cosmia", "RIOBA", "METRO PROFESSIONAL", "TARRINGTON HOUSE",
  "World's Market",
].map((b) => b.toLowerCase());

async function main(): Promise<void> {
  const live = currentOfferWhere();
  const products = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: live } },
    select: {
      id: true, name: true, brand: true, equivalenceClassId: true,
      equivalenceClass: { select: { slug: true } },
      offers: { where: live, select: { merchant: { select: { slug: true } } } },
    },
  });

  const isPL = (p: (typeof products)[number]) => p.brand != null && PL_BRANDS.includes(p.brand.trim().toLowerCase());

  const total = products.length;
  const classed = products.filter((p) => p.equivalenceClassId != null);
  const pl = products.filter(isPL);
  const plClassed = pl.filter((p) => p.equivalenceClassId != null);
  const single = (p: (typeof products)[number]) => new Set(p.offers.map((o) => o.merchant.slug)).size === 1;

  console.log("=".repeat(84));
  console.log("CLASS COVERAGE TODAY");
  console.log("=".repeat(84));
  console.log(`live grocery products                 ${total}`);
  console.log(`  in an equivalence class             ${classed.length}  (${((classed.length / total) * 100).toFixed(1)}%)`);
  console.log(`private-label (by brand field only)   ${pl.length}`);
  console.log(`  in an equivalence class             ${plClassed.length}  (${((plClassed.length / Math.max(1, pl.length)) * 100).toFixed(1)}%)`);
  console.log(`  single-shop AND unclassed           ${pl.filter((p) => single(p) && p.equivalenceClassId == null).length}   <- the gap the brief is aiming at`);

  const classCount = await prisma.equivalenceClass.count();
  const byClass = new Map<string, number>();
  for (const p of classed) byClass.set(p.equivalenceClass!.slug, (byClass.get(p.equivalenceClass!.slug) ?? 0) + 1);
  console.log(`\nclasses defined ${classCount}; classes with at least one LIVE member ${byClass.size}`);
  const empty = classCount - byClass.size;
  console.log(`classes with no live member ${empty}`);

  console.log(`\nTOP CLASSES BY LIVE MEMBERS`);
  for (const [slug, n] of [...byClass.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    console.log(`  ${slug.padEnd(30)} ${String(n).padStart(4)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
