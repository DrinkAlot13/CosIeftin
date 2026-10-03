// Price the basket and store today's snapshot. Run nightly, after the scrape.
//
// ── THIS NOW COMPUTES BASKET v2, AND v1 IS HISTORY.
//
// v1 pinned forty products by slug. v2 defines forty equivalence classes, so each shop prices
// each line with its own equivalent — which is what makes "cât costă coșul la fiecare magazin"
// answerable at all. See lib/index-basket-v2.ts for why, and what it costs.
//
// v1's stored days are KEPT and never recomputed. They are a real record of what that basket
// cost on those dates. What stops here is ADDING to them: two series measuring different
// baskets, both growing, is how somebody eventually plots one line through both.
//
// The snapshot carries its `version`, and (day, version) is unique — so the switch-over day can
// hold both a v1 row and a v2 row without either overwriting the other.
//
// Run: npm run index:compute

import { prisma } from "../src/lib/db";
import { BASKET_V2_VERSION, INDEX_BASKET_V2 } from "../src/lib/index-basket-v2";
import { priceBasketV2 } from "../src/lib/index-v2";

const lei = (bani: number): string => (bani / 100).toFixed(2);
const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  const idx = await priceBasketV2();
  const day = idx.computedAt.toISOString().slice(0, 10);

  console.log(`\nIndexul CosIeftin — ${day}  (coș v${BASKET_V2_VERSION}, ${INDEX_BASKET_V2.length} clase)\n`);

  console.log(`  PER MAGAZIN — un coș este comparabil doar cu unul care a acoperit aceleași linii`);
  console.log(`  ${pad("magazin", 18)} ${lp("linii", 7)} ${lp("total", 11)}`);
  for (const s of idx.shops.filter((x) => x.found > 0)) {
    console.log(`  ${pad(s.merchantSlug, 18)} ${lp(`${s.found}/${s.lines.length}`, 7)} ${lp(lei(s.totalBani), 11)} lei`);
  }

  console.log(`\n  cel mai mic preț per produs, de oriunde: ${lei(idx.bestAnywhereBani)} lei`);
  const filled = idx.bestAnywhereLines.filter((l) => l.priceBani != null).length;
  console.log(`  ${filled}/${INDEX_BASKET_V2.length} linii acoperite de cel puțin un magazin`);
  if (idx.unfillable.length > 0) {
    console.log(`  ⚠ ${idx.unfillable.length} linie(i) pe care NICIUN magazin nu le poate acoperi: ${idx.unfillable.map((u) => u.key).join(", ")}`);
  }
  if (idx.missingClasses.length > 0) {
    console.log(`  ⚠ clase inexistente în baza de date: ${idx.missingClasses.join(", ")}`);
  }

  // The stored total is the SHOPPING-AROUND price — cheapest per class from anywhere — because
  // that is the one number with a stable meaning across days. A per-shop total moves when that
  // shop's coverage moves, which is a different signal and is kept in `perShop` beside it.
  await prisma.indexSnapshot.upsert({
    where: { day_version: { day, version: BASKET_V2_VERSION } },
    update: {
      total: idx.bestAnywhereBani / 100,
      covered: filled,
      ofItems: INDEX_BASKET_V2.length,
      lines: JSON.stringify(idx.bestAnywhereLines.map((l) => ({ key: l.item.key, label: l.item.label, price: l.priceBani == null ? null : l.priceBani / 100, storeName: l.merchantSlug, productName: l.productName }))),
      perShop: JSON.stringify(idx.shops.map((s) => ({ merchantSlug: s.merchantSlug, merchantName: s.merchantName, found: s.found, of: s.lines.length, totalBani: s.totalBani }))),
    },
    create: {
      day,
      version: BASKET_V2_VERSION,
      total: idx.bestAnywhereBani / 100,
      covered: filled,
      ofItems: INDEX_BASKET_V2.length,
      lines: JSON.stringify(idx.bestAnywhereLines.map((l) => ({ key: l.item.key, label: l.item.label, price: l.priceBani == null ? null : l.priceBani / 100, storeName: l.merchantSlug, productName: l.productName }))),
      perShop: JSON.stringify(idx.shops.map((s) => ({ merchantSlug: s.merchantSlug, merchantName: s.merchantName, found: s.found, of: s.lines.length, totalBani: s.totalBani }))),
    },
  });
  console.log(`\n  snapshot v${BASKET_V2_VERSION} saved for ${day}\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
