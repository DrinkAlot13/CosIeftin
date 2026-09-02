// Phase 1 backfill: populate the additive Offer columns from data we already hold.
// Idempotent — safe to re-run. Prints a verification table at the end.
//
// Run: npm run backfill:phase1

import { prisma } from "../src/lib/db";
import { leiToBaniExact } from "../src/lib/price/parsePrice";

// The flyer window the Kaufland scraper observed for the current run.
const KAUFLAND_PROMO = { from: new Date("2026-08-24T00:00:00Z"), to: new Date("2026-09-06T23:59:59Z") };

/** priceSource follows how the merchant actually sells, not how we fetched it. */
function priceSourceFor(slug: string, storeType: string): string {
  if (slug === "kaufland") return "FLYER"; // weekly promo feed, not a standing catalog
  if (storeType === "online") return "ONLINE";
  return "SHELF"; // hybrid + physical
}

async function main() {
  const merchants = await prisma.merchant.findMany({ select: { id: true, slug: true, name: true, storeType: true, lastScrapeAt: true } });

  // ── priceSource only. lastSeenAt is NOT backfilled here, and must never be again.
  //
  // This used to also write `lastSeenAt: m.lastScrapeAt` for EVERY offer of the merchant —
  // including the ones that scrape never saw. That makes the field mean "the merchant ran"
  // rather than "this offer was observed", which is the opposite of what a staleness check
  // needs, and every staleness check reads it. 10,388 offers ended up stamped forward, and
  // three offers last actually seen on 6 August were shown as current prices 26 days later,
  // one of them badged "cel mai mic preț".
  //
  // There is no correct value to backfill here. An offer we did not observe has no observation
  // date, and inventing one is exactly the harm. lastSeenAt is written by the scrape, on the
  // rows the scrape actually saw, and nowhere else.
  console.log("=== priceSource ===");
  for (const m of merchants) {
    const src = priceSourceFor(m.slug, m.storeType);
    const r = await prisma.offer.updateMany({
      where: { merchantId: m.id },
      data: { priceSource: src },
    });
    if (r.count) console.log(`  ${m.name.padEnd(16)} ${src.padEnd(18)} ${r.count} offers`);
  }

  // ── oldPrice → referencePriceBani (STRIKETHROUGH). Real data we already hold. ──
  console.log("\n=== oldPrice → referencePriceBani (STRIKETHROUGH) ===");
  const withOld = await prisma.offer.findMany({
    where: { oldPrice: { not: null } },
    select: { id: true, price: true, oldPrice: true, merchant: { select: { name: true } } },
  });
  let migrated = 0;
  let skipped = 0;
  for (const o of withOld) {
    // Only a reference ABOVE the current price is a real "was" price; anything else would
    // invent a discount. The audit found 172/172 Kaufland rows qualify.
    if (o.oldPrice == null || o.oldPrice <= o.price) { skipped++; continue; }
    await prisma.offer.update({
      where: { id: o.id },
      data: { referencePriceBani: leiToBaniExact(o.oldPrice), referencePriceKind: "STRIKETHROUGH" },
    });
    migrated++;
  }
  console.log(`  migrated ${migrated}, skipped ${skipped} (reference not above price)`);

  // ── Kaufland promo window ──
  console.log("\n=== Kaufland promo window ===");
  const kauf = merchants.find((m) => m.slug === "kaufland");
  if (kauf) {
    const r = await prisma.offer.updateMany({
      where: { merchantId: kauf.id },
      data: { promoType: "PROMO", promoValidFrom: KAUFLAND_PROMO.from, promoValidTo: KAUFLAND_PROMO.to },
    });
    console.log(`  ${r.count} offers → ${KAUFLAND_PROMO.from.toISOString().slice(0, 10)} … ${KAUFLAND_PROMO.to.toISOString().slice(0, 10)}`);
    // An offer whose promo window has already closed is EXPIRED (not stale — we still see it).
    const expired = await prisma.offer.updateMany({
      where: { merchantId: kauf.id, promoValidTo: { lt: new Date() } },
      data: { isExpired: true },
    });
    console.log(`  marked expired (window already closed): ${expired.count}`);
  }

  // ── productUrl: only where the URL is genuinely per-product ──
  console.log("\n=== productUrl (null where the source has no deep link) ===");
  for (const m of merchants) {
    const offers = await prisma.offer.findMany({ where: { merchantId: m.id }, select: { id: true, url: true } });
    if (offers.length === 0) continue;
    const distinct = new Set(offers.map((o) => o.url)).size;
    // Distinguish two very different reasons offers share a URL:
    //   • a genuine PAGE link (Kaufland: 1 URL for 319 offers) — there is no deep link
    //   • the FAN-OUT BUG (Freshful/Mega/DCNeu) — the URLs *are* real product links, one
    //     product just wrongly backs several catalog rows. Those keep their deep link;
    //     the fix belongs in the matcher, not here.
    // So only a near-degenerate URL count counts as "no deep link available".
    const perProduct = distinct > Math.max(2, offers.length * 0.02);
    if (perProduct) {
      for (const o of offers) await prisma.offer.update({ where: { id: o.id }, data: { productUrl: o.url } });
      console.log(`  ${m.name.padEnd(16)} ${offers.length} deep links kept`);
    } else {
      console.log(`  ${m.name.padEnd(16)} productUrl left NULL (${distinct} distinct URLs for ${offers.length} offers — not per-product)`);
    }
  }

  // ── verification ──
  console.log("\n=== VERIFICATION ===");
  const total = await prisma.offer.count();
  const rows = [
    ["offers total", total],
    ["with priceSource set", await prisma.offer.count({ where: { priceSource: { in: ["SHELF", "ONLINE", "DELIVERY_PLATFORM", "FLYER"] } } })],
    ["with lastObservedAt", await prisma.offer.count({ where: { lastObservedAt: { not: null } } })],
    ["with referencePriceBani", await prisma.offer.count({ where: { referencePriceBani: { not: null } } })],
    ["with promo window", await prisma.offer.count({ where: { promoValidTo: { not: null } } })],
    ["with productUrl (deep link)", await prisma.offer.count({ where: { productUrl: { not: null } } })],
    ["productUrl NULL (no deep link available)", await prisma.offer.count({ where: { productUrl: null } })],
    ["rawPriceText (fills on next scrape)", await prisma.offer.count({ where: { rawPriceText: { not: null } } })],
  ] as const;
  for (const [label, n] of rows) console.log(`  ${String(label).padEnd(42)} ${n}`);

  const bad = await prisma.offer.count({ where: { referencePriceBani: { not: null }, AND: { referencePriceKind: null } } });
  console.log(`  ${"reference w/o kind (must be 0)".padEnd(42)} ${bad}`);
  if (bad !== 0) { console.error("\n✗ referencePriceBani set without a kind"); process.exit(1); }
  console.log("\n✓ Phase 1 backfill verified.");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
