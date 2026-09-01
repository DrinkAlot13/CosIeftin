// End-to-end verification of ONE product: 5942204008190, Pepsi zmeura doza 6 x 0.33 l.
//
// This is the page a user reported. Four merchants, four different products; every fix for
// several sessions made it more accurate about the wrong thing. The variant-class hard block
// and the pack-shape rule are supposed to have ended that.
//
// Answers, in order:
//   1. every offer now attached to the product, with its full provenance
//   2. where the four previous offers went instead, and why each was refused
//   3. whether the product has any offers at all
//   4. left to the caller — the rendered HTML is fetched separately, because a claim about a
//      page must come from the page
//
// Read-only. Run: npm run verify:pepsi

import { PrismaClient } from "@prisma/client";
import { decide, prep } from "../src/lib/scrape-util";
import { variantConflict } from "../src/lib/variant-classes";
import { parseQuantity } from "../src/lib/units/parseQuantity";

const prisma = new PrismaClient();

const EAN = "5942204008190";
/** The four merchants that were on this page when it was reported. */
const PREVIOUS = ["auchan", "freshful", "mega-image", "carrefour"];

const lei = (b: number | null | undefined): string => (b == null ? "—" : (b / 100).toFixed(2));
const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

async function main(): Promise<void> {
  const product = await prisma.product.findFirst({
    where: { OR: [{ ean: EAN }, { slug: { contains: "zmeura-pepsi" } }] },
    select: {
      id: true, slug: true, name: true, ean: true, unit: true, unitSize: true, section: true,
      offers: {
        select: {
          id: true, price: true, priceBani: true, pricePerUnit: true, pricePerUnitBani: true,
          storeName: true, ownUnit: true, ownUnitSize: true, availability: true, stockStatus: true,
          isStale: true, flagged: true, flagReason: true, lastObservedAt: true, rawPriceText: true,
          productUrl: true, matchedBy: true, matchScore: true,
          merchant: { select: { slug: true } },
        },
      },
    },
  });

  console.log("\n════ 1. THE PRODUCT AND EVERY OFFER NOW ATTACHED TO IT ══════════════════════");
  if (!product) {
    console.log(`  No product found for EAN ${EAN}. It may have been removed entirely.`);
    await prisma.$disconnect();
    return;
  }
  console.log(`  id=${product.id}  ean=${product.ean}  section=${product.section}`);
  console.log(`  name: ${product.name}`);
  console.log(`  slug: ${product.slug}`);
  console.log(`  catalog size: ${product.unitSize} ${product.unit}  ` +
    `packCount from name: ${parseQuantity(product.name)?.packCount ?? 1}`);
  console.log(`\n  OFFERS: ${product.offers.length}`);
  if (product.offers.length === 0) {
    console.log(`    (none)`);
  }
  for (const o of product.offers) {
    const pack = o.storeName ? parseQuantity(o.storeName)?.packCount ?? 1 : null;
    console.log(`\n    ${o.merchant.slug}`);
    console.log(`      storeName      ${o.storeName === null ? "NULL (predates the column)" : JSON.stringify(o.storeName)}`);
    console.log(`      ownUnitSize    ${o.ownUnitSize ?? "null"} ${o.ownUnit ?? ""}`);
    console.log(`      packCount      ${pack ?? "n/a (no storeName)"}`);
    console.log(`      price          ${o.price} lei (${o.priceBani} bani)  raw=${JSON.stringify(o.rawPriceText)}`);
    console.log(`      unit price     ${o.pricePerUnit} (${o.pricePerUnitBani} bani)`);
    console.log(`      stockStatus    ${o.stockStatus}   availability=${o.availability}   isStale=${o.isStale}`);
    console.log(`      flagged        ${o.flagged}${o.flagReason ? " — " + o.flagReason : ""}`);
    console.log(`      lastObservedAt ${o.lastObservedAt?.toISOString() ?? "null"}`);
    console.log(`      matchedBy      ${o.matchedBy} (score ${o.matchScore})`);
  }

  // ── 2. Where did the four go, and why was each refused?
  console.log("\n\n════ 2. WHERE THE FOUR PREVIOUS OFFERS WENT ═════════════════════════════════");
  const catItem = prep(product.name, null, product.ean);
  const catSize = { unit: product.unit, unitSize: product.unitSize };
  for (const slug of PREVIOUS) {
    const still = product.offers.find((o) => o.merchant.slug === slug);
    if (still) {
      console.log(`\n  ${pad(slug, 12)} STILL ON THIS PRODUCT — ${lei(still.priceBani)} lei`);
      continue;
    }
    // Find where that merchant's zmeura/pepsi item lives now.
    const moved = await prisma.offer.findMany({
      where: {
        merchant: { slug },
        OR: [
          { storeName: { contains: "Pepsi" } },
          { product: { name: { contains: "Pepsi" } } },
        ],
      },
      select: {
        price: true, storeName: true, ownUnitSize: true, ownUnit: true, availability: true,
        product: { select: { id: true, name: true, slug: true } },
      },
      take: 6,
    });
    console.log(`\n  ${pad(slug, 12)} NO LONGER ON THIS PRODUCT`);
    if (moved.length === 0) {
      console.log(`      no Pepsi offer from this merchant at all right now`);
      continue;
    }
    for (const m of moved.slice(0, 4)) {
      const name = m.storeName ?? m.product.name;
      const d = decide(
        catItem, catSize,
        prep(name, null, null),
        m.ownUnit && m.ownUnitSize ? { unit: m.ownUnit, unitSize: m.ownUnitSize } : catSize,
        product.section,
      );
      const vc = variantConflict(product.name, name);
      console.log(`      now on: ${m.product.name.slice(0, 52)}`);
      console.log(`        its own name: ${JSON.stringify(name.slice(0, 56))}  ${m.price} lei`);
      console.log(`        would this match OUR product? ${d.band} — ${d.reason}` +
        `${vc ? ` (${vc.klass}: ${JSON.stringify(vc.a)} vs ${JSON.stringify(vc.b)})` : ""}` +
        `  pack ${parseQuantity(product.name)?.packCount ?? 1} vs ${parseQuantity(name)?.packCount ?? 1}`);
    }
  }

  // ── 3. Does it have any offers at all?
  console.log("\n\n════ 3. DOES THE PRODUCT STILL HAVE OFFERS? ═════════════════════════════════");
  const showable = product.offers.filter(
    (o) => !o.isStale && !o.flagged && o.availability === "in stock" && (o.priceBani ?? 0) > 0,
  );
  console.log(`  offers attached: ${product.offers.length}`);
  console.log(`  showable to a shopper: ${showable.length}`);
  if (showable.length === 0) {
    console.log(`  → the page has NO price. It must say so rather than show an old one.`);
  } else if (showable.length === 1) {
    console.log(`  → one shop. The page is a price record, not a comparison, and should read that way.`);
  }
  console.log(`\n  URL: /p/${product.slug}\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
