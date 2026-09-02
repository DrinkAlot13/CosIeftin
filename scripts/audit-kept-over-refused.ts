// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// Counts EVERY row, shown or not — prices a gate substituted, shown or not.
// That is deliberate and is the opposite of the user-facing audits: a withheld row is
// still data, and a corruption hiding inside one is still a corruption. Do not add a
// visibility filter here.
// Every stored price that a history-anchored gate KEPT over a fresher one it refused.
//
// Four refusals were examined today and in all four the refused value was the better one:
// Auchan 12,00 (real: 11,69 on an independent re-scrape), Kaufland 6,89 (the merchant's own
// JSON says 6,89), Mega Image 23,95 for a 5+1 six-pack that was holding 5,29 — a single
// bottle price — and the whole 30 August correction wave.
//
// The reason generalizes: a gate anchored on stored history assumes history is more
// trustworthy than the new observation, and that assumption is exactly inverted during the
// period when parsers are being corrected. History-anchoring defends stale data against fresh
// data. Every row below is a row where it did.
//
// Read-only. Run: npm run audit:kept-over-refused

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const lei = (b: number | null | undefined): string =>
  b == null ? "—" : (b / 100).toFixed(2);
const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  // A substitution is a PriceAnomaly that recorded BOTH a refused value and a kept value.
  const rows = await prisma.priceAnomaly.findMany({
    where: { rejectedPriceBani: { gt: 0 }, acceptedPriceBani: { not: null } },
    orderBy: { detectedAt: "desc" },
    select: {
      id: true, offerId: true, storeName: true, rawPriceText: true, reason: true,
      rejectedPriceBani: true, acceptedPriceBani: true, resolved: true, detectedAt: true,
      merchant: { select: { slug: true } },
      offer: {
        select: {
          price: true, priceBani: true, flagged: true, isStale: true, availability: true,
          product: { select: { name: true, slug: true } },
        },
      },
    },
  });

  console.log("\n════ PRICES KEPT OVER A REFUSED ONE ════════════════════════════════════════");
  console.log("  Every row here is a stored value a history-anchored gate preferred to a");
  console.log("  fresher observation. All of them are suspect: in four cases examined by hand,");
  console.log("  the refused value was the correct one every single time.\n");

  const byMerchant = new Map<string, { n: number; stillStored: number; up: number; down: number }>();
  for (const r of rows) {
    const e = byMerchant.get(r.merchant?.slug ?? "?") ?? { n: 0, stillStored: 0, up: 0, down: 0 };
    e.n++;
    const current = r.offer?.priceBani ?? (r.offer ? Math.round(r.offer.price * 100) : null);
    if (current != null && r.acceptedPriceBani != null && Math.abs(current - r.acceptedPriceBani) <= 1) e.stillStored++;
    if (r.acceptedPriceBani != null) {
      if (r.rejectedPriceBani > r.acceptedPriceBani) e.up++; else e.down++;
    }
    byMerchant.set(r.merchant?.slug ?? "?", e);
  }

  console.log(`  ${pad("merchant", 14)}${lp("kept-over", 11)}${lp("still stored", 14)}${lp("refused was higher", 20)}${lp("lower", 8)}`);
  let total = 0, stillTotal = 0;
  for (const [k, e] of [...byMerchant.entries()].sort((a, b) => b[1].n - a[1].n)) {
    total += e.n;
    stillTotal += e.stillStored;
    console.log(`  ${pad(k, 14)}${lp(e.n, 11)}${lp(e.stillStored, 14)}${lp(e.up, 20)}${lp(e.down, 8)}`);
  }
  console.log(`  ${pad("TOTAL", 14)}${lp(total, 11)}${lp(stillTotal, 14)}`);
  console.log(`\n  "still stored" = the kept value is STILL what the site shows today.`);
  console.log(`  Those are the ones a shopper can currently see.\n`);

  console.log(`\n  ${pad("product", 44)}${lp("kept", 10)}${lp("refused", 10)}  ${pad("source string", 18)} merchant     status`);
  for (const r of rows) {
    const current = r.offer?.priceBani ?? (r.offer ? Math.round(r.offer.price * 100) : null);
    const still = current != null && r.acceptedPriceBani != null && Math.abs(current - r.acceptedPriceBani) <= 1;
    const shown = r.offer && !r.offer.isStale && r.offer.availability === "in stock";
    console.log(
      `  ${pad(r.offer?.product.name ?? r.storeName ?? "(pre-offer)", 44)}` +
      `${lp(lei(r.acceptedPriceBani), 10)}${lp(lei(r.rejectedPriceBani), 10)}  ` +
      `${pad(r.rawPriceText ?? "—", 18)} ${pad(r.merchant?.slug ?? "?", 12)} ` +
      `${still ? (shown ? "LIVE ON SITE" : "stored, not shown") : "since replaced"}`,
    );
  }

  console.log(`\n  ${rows.length} substitutions recorded. Note this counts only what was RECORDED —`);
  console.log(`  gates discarded silently before the refusal recording existed, so the true`);
  console.log(`  historical figure is higher and unrecoverable.\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
