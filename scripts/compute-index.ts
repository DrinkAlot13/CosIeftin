// Price the fixed basket and store today's snapshot. Run nightly, after the scrape.
//
// The page rebuilds its series from PriceHistory, so this snapshot is not what the chart reads —
// it is an INDEPENDENT daily record of what the basket cost, written by a different code path
// from the one that draws it. When the two disagree, that is a finding rather than a mystery.
//
// Run: npm run index:compute

import { prisma } from "../src/lib/db";
import { BASKET_VERSION, INDEX_BASKET } from "../src/lib/index-basket";
import { priceBasketNow } from "../src/lib/index-series";

async function main() {
  const idx = await priceBasketNow();
  const day = idx.computedAt.toISOString().slice(0, 10);

  console.log(`\nIndexul CoșMic — ${day}  (coș v${BASKET_VERSION}, ${INDEX_BASKET.length} produse)\n`);
  for (const l of idx.lines) {
    const price = l.price != null ? `${l.price.toFixed(2)} lei` : (l.found ? "fără preț" : "PIN LIPSĂ");
    console.log(`  ${l.item.label.padEnd(34)}${price.padStart(12)}  ${l.merchant ?? ""}`);
  }
  console.log(`\n  TOTAL ${idx.total.toFixed(2)} lei  (${idx.priced}/${idx.of} produse)`);
  if (!idx.complete) {
    console.log(`  ⚠ COȘ INCOMPLET — ziua nu intră în comparații.`);
    if (idx.missingPins.length) console.log(`    pins that no longer resolve: ${idx.missingPins.join(", ")}`);
  }

  await prisma.indexSnapshot.upsert({
    where: { day },
    update: {
      total: idx.total,
      covered: idx.priced,
      ofItems: idx.of,
      lines: JSON.stringify(idx.lines.map((l) => ({ key: l.item.key, label: l.item.label, price: l.price, storeName: l.merchant }))),
    },
    create: {
      day,
      total: idx.total,
      covered: idx.priced,
      ofItems: idx.of,
      lines: JSON.stringify(idx.lines.map((l) => ({ key: l.item.key, label: l.item.label, price: l.price, storeName: l.merchant }))),
    },
  });
  console.log(`\n  snapshot saved for ${day}\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
