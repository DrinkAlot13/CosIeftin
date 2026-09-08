// WHY IS THE REVIEW QUEUE 73,657? READ-ONLY.
//
// It was 3,775 three weeks ago. A queue that grows 20x in three weeks is not a backlog, it is a
// statement about the BANDS — so this reports the shape of the queue rather than its size, and
// proposes nothing until the shape is on the page.
//
// The specific question worth answering first: how many of these pairs COULD NEVER BE CONFIRMED?
// Two different retailers' own-brand products are, by construction, not the same product. Nobody
// should ever have been asked about them.
//
//   npm run audit:pending-queue

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

/** Retailer own-brand names. A pair of two DIFFERENT ones can never be one product. */
const HOUSE_BRANDS: Record<string, string> = {
  "mega": "mega-image", "gusturi romanesti": "mega-image", "nature's promise": "mega-image",
  "nature's promise bio": "mega-image", "emma": "mega-image", "world's market": "mega-image",
  "auchan": "auchan", "pouce": "auchan", "filiera auchan": "auchan", "cosmia": "auchan",
  "carrefour": "carrefour", "carrefour classic": "carrefour", "carrefour bio": "carrefour",
  "carrefour sensation": "carrefour", "carrefour extra": "carrefour", "carrefour selection": "carrefour",
  "metro chef": "metro", "fine life": "metro", "aro": "metro", "rioba": "metro",
  "metro professional": "metro", "tarrington house": "metro",
  "k-classic": "kaufland", "din gradina by freshful": "freshful", "clever": "profi",
};

function houseOwner(name: string): string | null {
  const n = name.toLowerCase().replace(/[șş]/g, "s").replace(/[țţ]/g, "t").replace(/[ăâ]/g, "a").replace(/î/g, "i");
  let best: string | null = null;
  let bestLen = 0;
  for (const [brand, owner] of Object.entries(HOUSE_BRANDS)) {
    if (n.includes(brand) && brand.length > bestLen) { best = owner; bestLen = brand.length; }
  }
  return best;
}

function bucket(score: number): string {
  if (score < 0.5) return "<0.50";
  if (score < 0.55) return "0.50–0.55";
  if (score < 0.60) return "0.55–0.60";
  if (score < 0.65) return "0.60–0.65";
  if (score < 0.70) return "0.65–0.70";
  return ">=0.70";
}

async function main(): Promise<void> {
  const total = await prisma.pendingMatch.count();
  const rows = await prisma.pendingMatch.findMany({
    select: {
      id: true, score: true, reason: true, storeName: true, storeBrand: true,
      firstSeenAt: true, resolved: true, decision: true,
      merchant: { select: { slug: true } },
      product: { select: { id: true, name: true, brand: true } },
    },
  });

  console.log("═".repeat(104));
  console.log(`REVIEW QUEUE — ${total} rows`);
  console.log("═".repeat(104));

  // ── WHEN did it grow?
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.firstSeenAt.toISOString().slice(0, 10), (byDay.get(r.firstSeenAt.toISOString().slice(0, 10)) ?? 0) + 1);
  console.log(`\nCREATED PER DAY (the growth curve is the finding):`);
  let running = 0;
  for (const [d, n] of [...byDay.entries()].sort()) {
    running += n;
    const bar = "█".repeat(Math.min(60, Math.round(n / Math.max(1, Math.max(...byDay.values())) * 60)));
    console.log(`  ${d}  ${String(n).padStart(6)}  (cum ${String(running).padStart(6)})  ${bar}`);
  }

  // ── STATUS: has anything been decided, and what was the confirm rate?
  const byStatus = new Map<string, number>();
  for (const r of rows) {
    const k = r.resolved ? (r.decision ?? "resolved, no decision recorded") : "pending";
    byStatus.set(k, (byStatus.get(k) ?? 0) + 1);
  }
  console.log(`\nBY STATUS: ${[...byStatus.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`);
  const decided = rows.filter((r) => r.resolved);
  const confirmed = decided.filter((r) => /confirm/i.test(r.decision ?? ""));
  console.log(`  decided ${decided.length}${decided.length ? ` · confirmed ${confirmed.length} (${((confirmed.length / decided.length) * 100).toFixed(1)}%)` : " — NOTHING HAS BEEN DECIDED, so there is no confirm rate to report"}`);

  // ── BY RULE, BY MERCHANT, BY SCORE BAND
  const tally = (f: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(f(r), (m.get(f(r)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  console.log(`\nBY RULE:`);
  for (const [k, v] of tally((r) => r.reason ?? "(null)").slice(0, 12)) console.log(`  ${k.padEnd(26)} ${String(v).padStart(7)}  ${((v / total) * 100).toFixed(1)}%`);
  console.log(`\nBY MERCHANT:`);
  for (const [k, v] of tally((r) => r.merchant.slug)) console.log(`  ${k.padEnd(26)} ${String(v).padStart(7)}  ${((v / total) * 100).toFixed(1)}%`);
  console.log(`\nBY SCORE BAND:`);
  for (const [k, v] of tally((r) => bucket(r.score)).sort()) console.log(`  ${k.padEnd(26)} ${String(v).padStart(7)}  ${((v / total) * 100).toFixed(1)}%`);

  // ── THE PAIRS THAT COULD NEVER BE CONFIRMED.
  //
  // Two different retailers' own brands are not the same product, by construction — Auchan does
  // not sell Carrefour Classic. A pair like that is not a hard judgement call; it is a question
  // nobody should have been asked.
  let bothHouse = 0;
  let differentOwners = 0;
  const examples: string[] = [];
  for (const r of rows) {
    const a = houseOwner(`${r.storeBrand ?? ""} ${r.storeName ?? ""}`);
    const b = houseOwner(`${r.product.brand ?? ""} ${r.product.name}`);
    if (!a || !b) continue;
    bothHouse++;
    if (a !== b) {
      differentOwners++;
      if (examples.length < 8) examples.push(`    ${r.merchant.slug.padEnd(12)} ${(r.storeName ?? "").slice(0, 42).padEnd(42)}  vs  ${r.product.name.slice(0, 42)}`);
    }
  }
  console.log(`\n${"─".repeat(104)}`);
  console.log(`PAIRS THAT CAN NEVER BE CONFIRMED — both sides are a retailer's OWN brand`);
  console.log("─".repeat(104));
  console.log(`  both sides carry a house brand      ${bothHouse}`);
  console.log(`  …and the two houses DIFFER          ${differentOwners}  (${((differentOwners / Math.max(1, total)) * 100).toFixed(1)}% of the queue)`);
  console.log(`  Auchan does not sell Carrefour Classic. These are not hard calls; they are`);
  console.log(`  questions nobody should have been asked.`);
  for (const e of examples) console.log(e);

  emitJson({
    total, byDay: Object.fromEntries(byDay), byStatus: Object.fromEntries(byStatus),
    decided: decided.length, confirmed: confirmed.length,
    neverConfirmable: differentOwners, bothHouseBrand: bothHouse, pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
