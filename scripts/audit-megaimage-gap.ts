// ── SCOPE: REPORT ONLY ────────────────────────────────────────────────────────
// Where do Mega Image's ~6,500 unmatched pool items go, and are we right to drop them?
//
// The stats page reported "91,973 pooled, 4,395 written" — which is the SUM over fourteen
// nightly runs of the same catalog, placed beside the sum of what they wrote. Two numbers that
// are not a ratio. Per run it is ~7,224 pooled and ~741 written.
//
// And the pool is genuine: 7,224 rows, 7,224 distinct `sourceId`, 7,224 distinct `productUrl`,
// deduplicated on the merchant's own product code as it is built. Not pagination repeating.
//
// So the gap is real, and it has a cause that is not a bug: `scrape-megaimage` calls
// `matchPoolToCatalog` WITHOUT `addNew`, which defaults to false. Mega Image is a MATCH-ONLY
// merchant — it attaches prices to products the catalog already carries and discards the rest.
// Carrefour and Freshful are the same; every other scraper passes `addNew: true`.
//
// THE QUESTION THIS ANSWERS is therefore not "why is the matcher failing" but "of the items we
// discard, how many could the catalog have taken?" — because those are two different repairs.
// A discarded item that no catalog product resembles is a coverage decision working as
// designed. One that a catalog product clearly matches is a matcher miss.
//
// Reads the pool dumped by `POOL_ONLY=1 npm run scrape:megaimage`. Writes nothing.
//
// Run: POOL=tmp-pools/megaimage-pool.json npm run audit:megaimage-gap

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { normalizeText, signature, jaccard } from "../src/lib/matching";

const prisma = new PrismaClient();
const POOL = process.env.POOL ?? "tmp-pools/megaimage-pool.json";
const SAMPLE = Number(process.env.SAMPLE ?? 50);

/** Above this the catalog plainly has the product and dropping it is a matcher miss. */
const CLEAR_MATCH = 0.6;
/** Between this and CLEAR_MATCH: something similar exists, and a human should look. */
const ARGUABLE = 0.4;

type PoolItem = { name: string; brand: string; sourceId?: string | null; productUrl?: string | null; url: string; price: number };

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  const pool = JSON.parse(readFileSync(POOL, "utf8")) as PoolItem[];
  console.log(`\n════ MEGA IMAGE: WHAT THE MATCH-ONLY RUN DISCARDS ═══════════════════════════`);
  console.log(`  pool: ${pool.length} items from ${POOL}\n`);

  const merchant = await prisma.merchant.findUnique({ where: { slug: "mega-image" }, select: { id: true } });
  if (!merchant) { console.log("  no mega-image merchant"); await prisma.$disconnect(); return; }

  // Which pool items already have an offer? Keyed on the merchant's own product URL, which is
  // what the scraper writes as `url` — the one field that is stable between runs.
  const offers = await prisma.offer.findMany({
    where: { merchantId: merchant.id },
    select: { url: true, productId: true, isStale: true },
  });
  const offerByUrl = new Map(offers.map((o) => [o.url, o]));

  const matched: PoolItem[] = [];
  const unmatched: PoolItem[] = [];
  for (const p of pool) (offerByUrl.has(p.url) ? matched : unmatched).push(p);

  console.log(`  pool items WITH an offer row  : ${lp(matched.length, 6)}  (${((matched.length / pool.length) * 100).toFixed(1)}%)`);
  console.log(`  pool items with NONE          : ${lp(unmatched.length, 6)}  (${((unmatched.length / pool.length) * 100).toFixed(1)}%)`);
  const live = matched.filter((p) => offerByUrl.get(p.url)?.isStale === false).length;
  console.log(`  of the matched, not stale     : ${lp(live, 6)}\n`);

  // ── Does the catalog contain anything the unmatched item resembles?
  //
  // Scored with the project's OWN `signature` + `jaccard`, the same primitives the matcher
  // blocks and scores on. This is not a second matcher — it deliberately does NOT apply the
  // size, dosage and mutual-distinction rules, so it OVERSTATES how matchable things are. That
  // is the right direction for this question: an upper bound on what better matching could win.
  const catalog = await prisma.product.findMany({
    where: { section: "grocery" },
    select: { id: true, name: true, brand: true },
  });
  const catSigs = catalog.map((c) => ({ id: c.id, name: c.name, sig: signature(c.brand, c.name) }));

  // Index by token so this is not 6,500 x 25,671 comparisons.
  const byToken = new Map<string, typeof catSigs>();
  for (const c of catSigs) {
    for (const t of c.sig) {
      if (t.length < 4) continue;
      const b = byToken.get(t);
      if (b) b.push(c); else byToken.set(t, [c]);
    }
  }

  type Scored = { item: PoolItem; best: { id: number; name: string; score: number } | null };
  const scored: Scored[] = [];
  for (const item of unmatched) {
    const sig = signature(item.brand || null, item.name);
    const seen = new Set<number>();
    let best: { id: number; name: string; score: number } | null = null;
    for (const t of sig) {
      if (t.length < 4) continue;
      for (const c of byToken.get(t) ?? []) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        const score = jaccard(sig, c.sig);
        if (!best || score > best.score) best = { id: c.id, name: c.name, score };
      }
    }
    scored.push({ item, best });
  }

  const clear = scored.filter((s) => (s.best?.score ?? 0) >= CLEAR_MATCH);
  const arguable = scored.filter((s) => (s.best?.score ?? 0) >= ARGUABLE && (s.best?.score ?? 0) < CLEAR_MATCH);
  const absent = scored.filter((s) => (s.best?.score ?? 0) < ARGUABLE);

  console.log(`  OF THE ${unmatched.length} DISCARDED, WHAT DOES THE CATALOG HOLD?`);
  console.log(`  (scored on name overlap ALONE — no size, dosage or variant rule — so this is an`);
  console.log(`   UPPER BOUND on what better matching could recover, not a target.)\n`);
  console.log(`    a clear catalog counterpart (>= ${CLEAR_MATCH})  ${lp(clear.length, 6)}  ${((clear.length / unmatched.length) * 100).toFixed(1)}%  → matcher misses`);
  console.log(`    something arguable (${ARGUABLE}–${CLEAR_MATCH})         ${lp(arguable.length, 6)}  ${((arguable.length / unmatched.length) * 100).toFixed(1)}%  → a human call`);
  console.log(`    nothing resembling it (< ${ARGUABLE})       ${lp(absent.length, 6)}  ${((absent.length / unmatched.length) * 100).toFixed(1)}%  → the catalog does not carry it`);

  // ── The sample the brief asked for. Deterministic: every Nth row, not random, so re-running
  //    this reports the same fifty and a claim about them can be checked.
  const step = Math.max(1, Math.floor(scored.length / SAMPLE));
  const sample = scored.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  console.log(`\n  SAMPLE OF ${sample.length} DISCARDED ITEMS (every ${step}th, so this is reproducible)\n`);
  console.log(`    ${pad("MEGA IMAGE NAME", 46)} ${lp("score", 6)}  CLOSEST CATALOG PRODUCT`);
  console.log(`    ${"-".repeat(112)}`);
  for (const s of sample) {
    const verdict = (s.best?.score ?? 0) >= CLEAR_MATCH ? "✗" : (s.best?.score ?? 0) >= ARGUABLE ? "?" : " ";
    console.log(
      `  ${verdict} ${pad(s.item.name, 46)} ${lp((s.best?.score ?? 0).toFixed(2), 6)}  ${(s.best?.name ?? "(nothing)").slice(0, 56)}`,
    );
  }

  console.log(`\n  ✗ = the catalog plainly has it and we dropped the price anyway`);
  console.log(`  ? = something similar exists; a size or variant rule may be right to refuse it`);
  console.log(`  (blank) = the catalog does not carry this product at all\n`);

  const distinctNames = new Set(pool.map((p) => normalizeText(p.name))).size;
  console.log(`  Pool integrity: ${pool.length} rows, ${new Set(pool.map((p) => p.sourceId)).size} distinct sourceId,`);
  console.log(`  ${new Set(pool.map((p) => p.productUrl)).size} distinct productUrl, ${distinctNames} distinct normalised names.`);
  console.log(`  Deduplicated on the merchant's own product code as the pool is built.\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
