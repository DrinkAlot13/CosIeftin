// What the REVIEW band is worth, and what the thresholds would do to it.
//
// Read-only. Run: npm run audit:pending

import { PrismaClient } from "@prisma/client";
import { pendingUpperBound } from "../src/lib/pending-matches";

const prisma = new PrismaClient();
const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  const total = await prisma.pendingMatch.count({ where: { resolved: false } });
  const byMerchant = await prisma.pendingMatch.groupBy({ by: ["merchantId"], where: { resolved: false }, _count: true });
  const byReason = await prisma.pendingMatch.groupBy({ by: ["reason"], where: { resolved: false }, _count: true });
  const merchants = new Map(
    (await prisma.merchant.findMany({ select: { id: true, slug: true } })).map((m) => [m.id, m.slug]),
  );

  console.log("\n════ PENDING (REVIEW band) ═══════════════════════════════════════════════");
  console.log(`  queued and unresolved: ${total}\n`);
  console.log("  BY MERCHANT");
  for (const m of byMerchant.sort((a, b) => b._count - a._count)) {
    console.log(`    ${pad(merchants.get(m.merchantId) ?? "?", 16)}${lp(m._count, 7)}`);
  }
  console.log("\n  BY RULE THAT PRODUCED IT");
  for (const r of byReason.sort((a, b) => b._count - a._count)) {
    console.log(`    ${pad(r.reason, 22)}${lp(r._count, 7)}`);
  }

  // ── the upper bound ─────────────────────────────────────────────────────────────
  const b = await pendingUpperBound();
  console.log("\n════ IF EVERY PENDING MATCH WERE APPROVED ════════════════════════════════");
  console.log("  (an UPPER BOUND: it assumes every one is correct, and they are not.");
  console.log("   dcneu is excluded — one merchant, no peer, never comparable.)\n");
  console.log(`  ${pad("merchants/product", 20)}${lp("now", 10)}${lp("if approved", 14)}`);
  const keys = [...new Set([...b.before.keys(), ...b.after.keys()])].sort((x, y) => x - y);
  for (const k of keys) {
    console.log(`  ${pad(String(k), 20)}${lp(b.before.get(k) ?? 0, 10)}${lp(b.after.get(k) ?? 0, 14)}`);
  }
  const pct = (n: number): string => ((n / b.liveProducts) * 100).toFixed(1) + "%";
  console.log(`\n  live products (excl. dcneu)   ${b.liveProducts}`);
  console.log(`  COMPARABLE now                ${b.comparableBefore}  (${pct(b.comparableBefore)})`);
  console.log(`  COMPARABLE if all approved    ${b.comparableAfter}  (${pct(b.comparableAfter)})`);
  console.log(`  products gaining a merchant   ${b.productsGainingAMerchant}`);

  const gain = b.comparableAfter - b.comparableBefore;
  console.log(
    `\n  So reviewing the whole queue is worth AT MOST +${gain} comparable products ` +
    `(${pct(b.comparableAfter)} vs ${pct(b.comparableBefore)}).`,
  );
  if (total > 0) {
    console.log(`  That is ${(gain / total).toFixed(2)} comparable products per decision, at ~2 seconds each.`);
  }

  // ── threshold curve ─────────────────────────────────────────────────────────────
  const scores = (await prisma.pendingMatch.findMany({ where: { resolved: false }, select: { score: true } })).map((r) => r.score);
  console.log("\n════ WHERE THE REVIEW FLOOR WOULD PUT THE QUEUE ══════════════════════════");
  console.log("  Raising REVIEW_THRESHOLD shortens the queue and discards the rest unseen.");
  console.log("  Provisional at 0.42 — this is the curve, not a recommendation.\n");
  console.log(`  ${pad("floor", 9)}${lp("queued", 9)}${lp("discarded", 12)}`);
  for (const t of [0.30, 0.34, 0.38, 0.42, 0.46, 0.50, 0.54, 0.58]) {
    const kept = scores.filter((s) => s >= t).length;
    const mark = Math.abs(t - 0.42) < 1e-9 ? "  <- shipped" : "";
    console.log(`  ${pad(t.toFixed(2), 9)}${lp(kept, 9)}${lp(scores.length - kept, 12)}${mark}`);
  }
  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
