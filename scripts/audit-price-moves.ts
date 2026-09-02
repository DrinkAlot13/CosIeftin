// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// Counts EVERY row, shown or not — every recorded price change, shown or not.
// That is deliberate and is the opposite of the user-facing audits: a withheld row is
// still data, and a corruption hiding inside one is still a corruption. Do not add a
// visibility filter here.
// Which prices moved far enough that a human should have been asked?
//
// Auchan wrote 28,14 -> 12,00 on one product on 30 August and nothing objected, because
// scrape-auchan does not go through matchPoolToCatalog and therefore has NO price sanity
// gate at all — not the >50%-vs-own-last rule, not the >70%-vs-cross-store-median rule.
// This audit reads PriceHistory across the whole catalog and asks how big that hole is:
// how many moves would the gate have caught, on which merchants, and what they look like.
//
// It is read-only and it is deliberately NOT part of the scraper. A gate that lives inside
// the writer only ever confirms the writer's own opinion.
//
// Run: npm run audit:price-moves [--threshold 40] [--merchant auchan] [--limit 100]

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const THRESHOLD_PCT = Number(arg("--threshold") ?? 40);
const ONLY_MERCHANT = arg("--merchant");
const LIMIT = Number(arg("--limit") ?? 100);

type Move = {
  offerId: number;
  merchant: string;
  product: string;
  fromBani: number;
  toBani: number;
  pct: number;
  at: Date;
  /** The exact source string recorded with the NEW price, when the writer kept one. */
  rawPriceText: string | null;
  productUrl: string | null;
};

const lei = (bani: number): string => (bani / 100).toFixed(2);
const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  // PriceHistory appends on CHANGE ONLY, so consecutive rows for one offer already are the
  // price moves. No sampling, no window — every recorded change in the catalog.
  const history = await prisma.priceHistory.findMany({
    where: ONLY_MERCHANT ? { offer: { merchant: { slug: ONLY_MERCHANT } } } : {},
    select: {
      offerId: true, price: true, priceBani: true, recordedAt: true,
      offer: {
        select: {
          rawPriceText: true, productUrl: true,
          merchant: { select: { slug: true } },
          product: { select: { name: true } },
        },
      },
    },
    orderBy: [{ offerId: "asc" }, { recordedAt: "asc" }],
  });

  const moves: Move[] = [];
  const byMerchant = new Map<string, { points: number; moves: number; big: number; biggestPct: number }>();

  let prevOfferId = -1;
  let prevBani = 0;
  for (const h of history) {
    const bani = h.priceBani ?? Math.round(h.price * 100);
    const slug = h.offer.merchant.slug;
    const m = byMerchant.get(slug) ?? { points: 0, moves: 0, big: 0, biggestPct: 0 };
    m.points++;
    byMerchant.set(slug, m);

    if (h.offerId !== prevOfferId) {
      prevOfferId = h.offerId;
      prevBani = bani;
      continue;
    }
    if (prevBani > 0 && bani > 0 && bani !== prevBani) {
      m.moves++;
      const pct = (Math.abs(bani - prevBani) / prevBani) * 100;
      if (pct > m.biggestPct) m.biggestPct = pct;
      if (pct >= THRESHOLD_PCT) {
        m.big++;
        moves.push({
          offerId: h.offerId, merchant: slug, product: h.offer.product.name,
          fromBani: prevBani, toBani: bani, pct, at: h.recordedAt,
          rawPriceText: h.offer.rawPriceText, productUrl: h.offer.productUrl,
        });
      }
    }
    prevBani = bani;
  }

  moves.sort((a, b) => b.pct - a.pct);

  console.log(`\n════ PRICE MOVES ≥ ${THRESHOLD_PCT}% BETWEEN CONSECUTIVE HISTORY POINTS ═══════════════`);
  console.log(`  ${history.length} history rows${ONLY_MERCHANT ? ` (merchant=${ONLY_MERCHANT})` : ""}.`);
  console.log(`  PriceHistory appends on change only, so every consecutive pair IS a move.\n`);

  console.log(`  ${pad("merchant", 14)}${lp("points", 9)}${lp("moves", 8)}${lp(`≥${THRESHOLD_PCT}%`, 8)}${lp("share", 9)}${lp("biggest", 10)}`);
  for (const [slug, m] of [...byMerchant.entries()].sort((a, b) => b[1].big - a[1].big)) {
    const share = m.moves > 0 ? ((m.big / m.moves) * 100).toFixed(1) + "%" : "—";
    console.log(
      `  ${pad(slug, 14)}${lp(m.points, 9)}${lp(m.moves, 8)}${lp(m.big, 8)}${lp(share, 9)}` +
      `${lp(m.biggestPct > 0 ? m.biggestPct.toFixed(0) + "%" : "—", 10)}${m.big > 0 ? "  ⚠" : ""}`,
    );
  }

  console.log(`\n\n  TOP ${Math.min(LIMIT, moves.length)} OF ${moves.length} MOVES, largest first`);
  console.log(`  ${pad("merchant", 11)}${pad("product", 46)}${lp("from", 10)}${lp("to", 10)}${lp("move", 8)}  when        rawPriceText`);
  for (const mv of moves.slice(0, LIMIT)) {
    const dir = mv.toBani < mv.fromBani ? "↓" : "↑";
    console.log(
      `  ${pad(mv.merchant, 11)}${pad(mv.product, 46)}${lp(lei(mv.fromBani), 10)}${lp(lei(mv.toBani), 10)}` +
      `${lp(dir + mv.pct.toFixed(0) + "%", 8)}  ${mv.at.toISOString().slice(0, 10)}  ` +
      `${mv.rawPriceText === null ? "— NONE KEPT —" : JSON.stringify(mv.rawPriceText).slice(0, 40)}`,
    );
  }

  // The gate that does not run on Auchan: >50% from the offer's own last recorded price.
  const wouldHaveBeenRefused = moves.filter((m) => m.pct > 50);
  const byM = new Map<string, number>();
  for (const m of wouldHaveBeenRefused) byM.set(m.merchant, (byM.get(m.merchant) ?? 0) + 1);
  console.log(`\n\n  MOVES >50% — the "vs its own last price" gate in matchPoolToCatalog would refuse these:`);
  console.log(`  ${wouldHaveBeenRefused.length} total  ${[...byM.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`  Rows written by a scraper that BYPASSES that gate were never offered to it.\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
