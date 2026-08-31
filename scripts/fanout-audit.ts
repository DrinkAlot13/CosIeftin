// Fan-out audit: how many catalog products does ONE store product back?
// Success (Phase 3): p95 <= 3 for grocery, no group above 8 anywhere.
//
// Run: npm run audit:fanout
import { prisma } from "../src/lib/db";
const pct = (s: number[], p: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);

async function main() {
  const merchants = await prisma.merchant.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  console.log("MERCHANT        SECTION(S)          OFFERS  KEYS   MEAN   P50   P95   MAX  VERDICT");
  console.log("-".repeat(88));
  let worstAnywhere = 0;
  let groceryP95 = 0;
  for (const m of merchants) {
    const offers = await prisma.offer.findMany({
      // Only LIVE offers — the ones a shopper can actually be shown. Stale rows written by an
      // older matcher are retained on purpose (history) but are excluded by the optimizer,
      // so counting them here would measure the past rather than the product.
      where: { merchantId: m.id, flagged: false, isStale: false, isExpired: false },
      select: { productUrl: true, url: true, price: true, rawSourceBlob: true, product: { select: { name: true, section: true } } },
    });
    if (!offers.length) continue;
    // Store-product identity, best available:
    //   1. productUrl — a real deep link, the strongest identity
    //   2. the source record's own id (Kaufland's flyer offerId) from rawSourceBlob — a
    //      flyer has no per-product URL, and keying on url+price would count every
    //      same-priced product as one store product, inventing fan-out that isn't there
    //   3. url+price as a last resort
    const byKey = new Map<string, Set<string>>();
    for (const o of offers) {
      let sourceId: string | null = null;
      if (!o.productUrl && o.rawSourceBlob) {
        const m = o.rawSourceBlob.match(/"offerId"\s*:\s*"([^"]+)"/);
        if (m) sourceId = m[1];
      }
      const key = o.productUrl ?? sourceId ?? `${o.url}|${o.price}`;
      const s = byKey.get(key) ?? new Set<string>();
      s.add(o.product.name);
      byKey.set(key, s);
    }
    const counts = [...byKey.values()].map((v) => v.size).sort((a, b) => a - b);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const p95 = pct(counts, 0.95);
    const max = counts[counts.length - 1];
    const sections = [...new Set(offers.map((o) => o.product.section))].join("/");
    worstAnywhere = Math.max(worstAnywhere, max);
    if (sections === "grocery") groceryP95 = Math.max(groceryP95, p95);
    const ok = max <= 8 && (sections !== "grocery" || p95 <= 3);
    console.log(
      `${m.name.padEnd(15)} ${sections.padEnd(19)} ${String(offers.length).padStart(6)} ${String(byKey.size).padStart(6)}  ${mean.toFixed(2).padStart(5)} ${String(pct(counts,0.5)).padStart(5)} ${String(p95).padStart(5)} ${String(max).padStart(5)}  ${ok ? "ok" : "⚠"}`,
    );
  }
  console.log(`\nworst group anywhere: ${worstAnywhere} (target <= 8)`);
  console.log(`worst grocery p95   : ${groceryP95} (target <= 3)`);
  console.log(worstAnywhere <= 8 && groceryP95 <= 3 ? "\n✓ PHASE 3 TARGETS MET" : "\n✗ targets not met");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
