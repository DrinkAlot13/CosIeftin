// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// Do the CURRENT rules still produce the assignments that are actually stored?
//
// A stale assignment is a product sitting in a category that the rules, as they stand today,
// would no longer put it in. They appear whenever a rule is tightened without a re-apply, and
// they are invisible from the inside: the product has a category, the tree looks populated, and
// nothing about the row says the reason it was filed there has since been withdrawn.
//
// This is how cream cheese stayed under Curățenie și igienă. A bare "crema" rule had matched it;
// the rule was fixed; NONE writes nothing, so the old assignment simply survived. The apply step
// now clears what it no longer stands behind, which means a healthy catalog reports ZERO here —
// and any non-zero count dates a rule change that was never applied.
//
// WHAT THIS IS NOT. It shares the assigner's vocabulary on purpose, because the question is
// literally "do these rules still yield this answer". So it measures DRIFT, never correctness:
// a rule that is confidently wrong agrees with itself here. Correctness lives in
// `audit:categories`, which imports only PrismaClient precisely so it cannot agree by
// construction. The two answer different questions and neither replaces the other.
//
// Read-only. Run: npm run audit:stale-categories

import { PrismaClient } from "@prisma/client";
import { assignByMerchantPath, assignByName } from "../src/lib/category/assign";
import { recoverPath } from "../src/lib/category/recover";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number) => String(s).padStart(n);

async function main(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { section: "grocery", categoryId: { not: null } },
    select: {
      id: true, name: true,
      category: { select: { slug: true, name: true } },
      offers: {
        select: {
          rawSourceBlob: true, productUrl: true, url: true, categoryPath: true,
          merchant: { select: { slug: true } },
        },
      },
    },
  });

  console.log(`\n════ STALE CATEGORY ASSIGNMENTS ═════════════════════════════════════════════`);
  console.log(`  ${products.length} grocery product(s) currently hold a category.\n`);

  type Stale = { id: number; name: string; stored: string; now: string; reason: string };
  const stale: Stale[] = [];
  const moved: Stale[] = [];

  for (const p of products) {
    // Same order as the assigner: merchant truth first, inference only after.
    let a = null as ReturnType<typeof assignByName> | null;
    for (const o of p.offers) {
      const rp = recoverPath({
        merchantSlug: o.merchant.slug, rawSourceBlob: o.rawSourceBlob,
        productUrl: o.productUrl, url: o.url, categoryPath: o.categoryPath,
      });
      if (!rp) continue;
      const cand = assignByMerchantPath(rp.levels);
      if (cand.leafSlug) { a = cand; break; }
    }
    if (!a) a = assignByName(p.name);

    const stored = p.category!.slug;
    if (a.band !== "AUTO" || !a.leafSlug) {
      // The rules no longer place this product anywhere, yet it is filed somewhere.
      stale.push({ id: p.id, name: p.name, stored, now: `(${a.band})`, reason: a.reason });
    } else if (a.leafSlug !== stored) {
      // The rules place it, but somewhere else.
      moved.push({ id: p.id, name: p.name, stored, now: a.leafSlug, reason: a.reason });
    }
  }

  const total = stale.length + moved.length;
  console.log(`  no longer assigned by any rule : ${lp(stale.length, 6)}`);
  console.log(`  assigned somewhere DIFFERENT   : ${lp(moved.length, 6)}`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  STALE ASSIGNMENTS              : ${lp(total, 6)}  ${products.length ? ((total / products.length) * 100).toFixed(1) : "0.0"}%`);

  if (total === 0) {
    console.log(`\n  ✓ every stored assignment is one the current rules still produce.\n`);
  } else {
    console.log(`\n  Run \`npm run assign:categories -- --apply\` to bring the catalog back in line.`);
    console.log(`  Until then these rows show a category the rules have withdrawn.\n`);
    const show = (rows: Stale[], title: string) => {
      if (!rows.length) return;
      console.log(`  ${title}`);
      console.log(`  ${pad("product", 46)}${pad("stored", 22)}${pad("rules now say", 22)}`);
      for (const r of rows.slice(0, 15)) {
        console.log(`  ${pad(r.name, 46)}${pad(r.stored, 22)}${pad(r.now, 22)}`);
      }
      if (rows.length > 15) console.log(`  … and ${rows.length - 15} more`);
      console.log();
    };
    show(stale, "NO LONGER PLACED BY ANY RULE");
    show(moved, "PLACED SOMEWHERE ELSE NOW");
  }

  emitJson({
    categorised: products.length,
    staleTotal: total,
    noLongerAssigned: stale.length,
    movedElsewhere: moved.length,
  });

  await prisma.$disconnect();
  // Non-zero is a real finding, but it is a drift report rather than a corruption: exit 0 so a
  // nightly reports it without failing the whole chain on a rule change that was simply not
  // applied yet. `audit:db` remains the gate.
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
