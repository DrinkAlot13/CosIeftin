// Price the Indexul CoșMic basket now and print it. Run nightly after the scrape so the
// monthly "basket inflation" figure has a daily series behind it.
//
// Run: npm run index:compute

import { prisma } from "../src/lib/db";
import { computeCosmicIndex, saveCosmicIndex } from "../src/lib/cosmic-index";

async function main() {
  const idx = await computeCosmicIndex();
  await saveCosmicIndex(idx);
  console.log(`\nIndexul CoșMic — ${idx.computedAt.toISOString().slice(0, 10)}\n`);
  for (const l of idx.lines) {
    const price = l.price != null ? `${l.price.toFixed(2)} lei` : "—";
    console.log(`  ${l.label.padEnd(30)} ${price.padStart(11)}  ${l.storeName ?? ""}`);
  }
  console.log(`\n  TOTAL ${idx.total.toFixed(2)} lei  (${idx.covered}/${idx.of} produse acoperite)\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
