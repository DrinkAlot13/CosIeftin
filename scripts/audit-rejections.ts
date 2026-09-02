// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// Counts EVERY row, shown or not — matcher rejections, none of which are on a page.
// That is deliberate and is the opposite of the user-facing audits: a withheld row is
// still data, and a corruption hiding inside one is still a corruption. Do not add a
// visibility filter here.
// WHY is a merchant's pool being rejected? Replays the matcher and shows the near-misses.
//
// Mega Image pools 7,160 products and writes 724 offers. The pool census says 5,170 (72%)
// are ACTIVELY REJECTED — they reach the matcher and it says no — so this is a matching
// question, not a pipeline one. But "rejected" is a verdict, not a diagnosis: a rejection is
// correct when the products really are different and wrong when they are the same product
// described differently, and nothing distinguishes those without looking.
//
// This replays PHASE 1 offline, per store item, and reports the BEST candidate each rejected
// item had — its score, the band, and which tokens each side carried that the other did not.
// That last column is the whole diagnosis: mutual distinction is the decisive rule, so the
// tokens it fired on are the reason.
//
// Read-only, no network, no writes. Run: npm run audit:rejections -- mega-image [limit]

import { PrismaClient } from "@prisma/client";
import {
  prep, decide, headNoun, difference, overlapTokens, slugify,
  AUTO_MATCH_THRESHOLD, REVIEW_THRESHOLD, type PrepItem, type Decision,
} from "../src/lib/scrape-util";
import { parseSize } from "../src/lib/ingest-core";

const prisma = new PrismaClient();

const SLUG = process.argv[2] ?? "mega-image";
const LIMIT = Number(process.argv[3] ?? 50);

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

type Best = { score: number; band: string; reason: string; catName: string; catId: number };

async function main(): Promise<void> {
  const m = await prisma.merchant.findUnique({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!m) throw new Error(`no merchant ${SLUG}`);

  // The store side: use the offers we DID write plus, more importantly, the store names the
  // pool carried. `storeName` is the offer's own name, which is what the matcher saw.
  // For a full pool replay we would need the pool itself, so this works from PendingMatch
  // (the REVIEW band, persisted) plus the catalog, and reports the shape of the near-misses.
  const section = "grocery";
  const rows = await prisma.product.findMany({
    where: { section },
    select: { id: true, name: true, brand: true, ean: true, unit: true, unitSize: true },
  });
  console.log(`catalog: ${rows.length} ${section} products`);

  // Index the catalog by head noun, mirroring PHASE 1.
  const byHead = new Map<string, { id: number; item: PrepItem; size: { unit: string; unitSize: number }; name: string }[]>();
  for (const cp of rows) {
    const item = prep(cp.name, cp.brand, cp.ean);
    const h = headNoun(item.nname);
    if (!h) continue;
    const list = byHead.get(h) ?? [];
    list.push({ id: cp.id, item, size: { unit: cp.unit, unitSize: cp.unitSize }, name: cp.name });
    byHead.set(h, list);
  }

  // The store items to test: everything this merchant has queued for review, which IS the
  // near-miss population, plus its written offers' own store names for contrast.
  const pending = await prisma.pendingMatch.findMany({
    where: { merchantId: m.id },
    select: { storeName: true, storeBrand: true, score: true, reason: true, product: { select: { name: true } } },
    take: 5000,
  });
  console.log(`review-band items to diagnose: ${pending.length}\n`);

  type Row = { store: string; best: Best | null; storeOnly: string[]; catOnly: string[] };
  const out: Row[] = [];
  const seen = new Set<string>();

  for (const p of pending) {
    const name = p.storeName ?? "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const sItem = prep(name, p.storeBrand, null);
    const sSize = parseSize(name);
    const h = headNoun(sItem.nname);
    const cands = h ? byHead.get(h) ?? [] : [];
    let best: Best | null = null;
    let bestCat: PrepItem | null = null;
    for (const c of cands) {
      const d: Decision = decide(c.item, c.size, sItem, sSize, section);
      if (!best || d.score > best.score) {
        best = { score: d.score, band: d.band, reason: d.reason, catName: c.name, catId: c.id };
        bestCat = c.item;
      }
    }
    const sTok = new Set(overlapTokens(sItem.nname));
    const cTok = bestCat ? new Set(overlapTokens(bestCat.nname)) : new Set<string>();
    out.push({
      store: name,
      best,
      storeOnly: [...difference(sTok, cTok)].slice(0, 5),
      catOnly: [...difference(cTok, sTok)].slice(0, 5),
    });
    if (out.length >= LIMIT) break;
  }

  console.log(`════ ${m.name.toUpperCase()}: ${out.length} NEAR-MISSES, WITH THE DECIDING TOKENS ════`);
  console.log(`  bands: AUTO >= ${AUTO_MATCH_THRESHOLD} · REVIEW >= ${REVIEW_THRESHOLD} · below that REJECT\n`);
  const byBand = new Map<string, number>();
  for (const r of out) {
    const b = r.best?.band ?? "no-candidate";
    byBand.set(b, (byBand.get(b) ?? 0) + 1);
    console.log(`  ${pad(r.store, 48)}`);
    console.log(`     -> ${pad(r.best?.catName ?? "(no candidate)", 46)} ${r.best ? r.best.score.toFixed(2) : "—"}  ${r.best?.band ?? ""}  ${r.best?.reason ?? ""}`);
    console.log(`        store-only tokens: ${JSON.stringify(r.storeOnly)}   catalog-only: ${JSON.stringify(r.catOnly)}`);
  }
  console.log(`\n  bands: ${[...byBand.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
