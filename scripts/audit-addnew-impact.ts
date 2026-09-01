// What would the catalog look like if a match-only merchant ran with addNew enabled?
//
// `addNew` defaults to FALSE and mega-image, carrefour and freshful never pass it. They are
// match-only against a catalog Auchan built, so those three can only ever carry products
// Auchan also sells. The 7-in-50 rejected items with no catalog counterpart — household,
// tobacco, hardware — are not matching failures. They are catalog gaps by construction, and
// that construction has never been revisited.
//
// THIS SCRIPT ENABLES NOTHING. It reads a POOL_DUMP produced by a normal run and reports what
// PHASE 2 would have created: how many products, in which categories, and — the number that
// actually decides it — how many would be SINGLE-MERCHANT and therefore not comparable at all.
// A comparison site that fills up with products only one shop sells has more rows and no more
// comparisons.
//
// Produce a dump first:  POOL_DUMP=1 npm run scrape:megaimage
// Then:                  npm run audit:addnew-impact -- mega-image

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { slugify, prep, headNoun } from "../src/lib/scrape-util";
import { parseSize } from "../src/lib/ingest-core";

const prisma = new PrismaClient();

const SLUG = process.argv[2] ?? "mega-image";
const SECTION = process.argv[3] ?? "grocery";

type PoolItem = {
  name: string; brand: string | null; price: number;
  unit: string | null; unitSize: number | null; outcome: string;
};

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  const file = join(process.cwd(), "tmp-pools", `${SLUG}-pool.json`);
  if (!existsSync(file)) {
    console.error(`No pool dump at ${file}.\nRun:  POOL_DUMP=1 npm run scrape:${SLUG.replace("-", "")}`);
    await prisma.$disconnect();
    process.exit(1);
  }
  const pool = JSON.parse(readFileSync(file, "utf8")) as PoolItem[];

  // PHASE 2 creates a product for every pool item that PHASE 0/1 did not explain. In the dump
  // that is everything except "matched" — review-band and rejected items are both unexplained.
  const wouldCreate = pool.filter((p) => p.outcome !== "matched");
  console.log(`\n════ IF ${SLUG.toUpperCase()} RAN WITH addNew ENABLED ═══════════════════════════`);
  console.log(`  pool ${pool.length} · already matched ${pool.length - wouldCreate.length} · would create ${wouldCreate.length}\n`);

  // PHASE 2's slug: base + section initial + size. Collisions upsert onto one product, so the
  // real count is distinct slugs, not row count.
  const slugs = new Map<string, PoolItem>();
  for (const c of wouldCreate) {
    const size = parseSize(c.name);
    const unit = size?.unit ?? c.unit ?? "buc";
    const unitSize = size?.unitSize ?? c.unitSize ?? 1;
    const base = slugify(c.name) || "produs";
    slugs.set(`${base}-${SECTION[0]}${Math.round(unitSize * 1000)}${unit}`, c);
  }
  console.log(`  DISTINCT NEW PRODUCTS: ${slugs.size}  (${wouldCreate.length - slugs.size} would collapse onto an existing slug)`);

  const before = await prisma.product.count({ where: { section: SECTION } });
  console.log(`  catalog ${SECTION}: ${before} → ${before + slugs.size} (+${((slugs.size / before) * 100).toFixed(0)}%)\n`);

  // ── THE DECIDING NUMBER: how many would be single-merchant?
  //
  // A new product is comparable only if ANOTHER merchant also sells something that matches it.
  // Since nothing in the current catalog matched these items, by definition none of them has
  // a counterpart TODAY. The question is whether another merchant's pool could reach them, and
  // the only honest proxy available without re-running every scraper is whether any existing
  // catalog product shares this item's head noun at all.
  const existing = await prisma.product.findMany({
    where: { section: SECTION },
    select: { name: true, brand: true, ean: true },
  });
  const catalogHeads = new Set<string>();
  for (const e of existing) {
    const h = headNoun(prep(e.name, e.brand, e.ean).nname);
    if (h) catalogHeads.add(h);
  }
  let noHeadAtAll = 0;
  const byHead = new Map<string, number>();
  for (const [, c] of slugs) {
    const h = headNoun(prep(c.name, c.brand, null).nname);
    if (!h || !catalogHeads.has(h)) noHeadAtAll++;
    if (h) byHead.set(h, (byHead.get(h) ?? 0) + 1);
  }
  console.log(`  OF THOSE, certainly single-merchant (no catalog product shares even the head noun):`);
  console.log(`    ${noHeadAtAll} of ${slugs.size} (${((noHeadAtAll / slugs.size) * 100).toFixed(0)}%)`);
  console.log(`  The remainder share a head noun with something we carry but failed to match on`);
  console.log(`  brand, size or mutual distinction — so they are POSSIBLE comparisons, not likely ones.\n`);

  // ── What KIND of products are these? Head nouns are the cheapest honest categorisation.
  console.log(`  TOP 30 HEAD NOUNS AMONG THE NEW PRODUCTS:`);
  const heads = [...byHead.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  for (let i = 0; i < heads.length; i += 3) {
    console.log(
      "    " + heads.slice(i, i + 3)
        .map(([h, n]) => `${pad(h, 20)}${lp(n, 5)}`)
        .join("   "),
    );
  }

  console.log(`\n  20 SAMPLES OF WHAT WOULD BE CREATED:`);
  for (const [s, c] of [...slugs].slice(0, 20)) {
    console.log(`    ${pad(c.name, 56)} ${lp(c.price.toFixed(2), 8)}  ${s.slice(0, 40)}`);
  }
  console.log(`\n  NOTHING WAS ENABLED OR WRITTEN BY THIS SCRIPT.\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
