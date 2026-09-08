// ── SCOPE: STANDING SIGNAL ────────────────────────────────────────────────────
// IS THE DESCRIPTOR LIST GOING STALE? READ-ONLY.
//
// A token absent from `lib/matching/descriptors.ts` keeps today's behaviour: it blocks. That is
// the safe direction — a missing descriptor costs a comparison, never a wrong price — but it is
// also SILENT. As merchants change their naming and the catalog grows, new descriptive words
// appear and nothing announces that the list no longer covers them.
//
// ── WHAT THIS CAN AND CANNOT TELL YOU, stated plainly.
//
// It CANNOT tell you which tokens should be descriptors. That is the question the descriptor
// audit proved is not in the data: `uht` and `penne` block equally often and mean opposite
// things, and no frequency measure separates them. See CLAUDE.md, "SOME DEFECTS HAVE NO
// AUTOMATED DETECTOR".
//
// So this is a READING AID, not a verdict, and the list below will be mostly correct blocks —
// `lamaie`, `vanilie`, `sensitive` are product identity and belong nowhere near the descriptor
// list. Its value is in SCANNING: a word that describes rather than names, appearing high in
// this list, is the signal that the list needs extending. And the top-line count moving over
// time is the cheap version of the same signal.
//
//   npm run audit:descriptor-gap

import { PrismaClient } from "@prisma/client";
import { prep, difference } from "../src/lib/scrape-util";
import { DESCRIPTORS, isDescriptor } from "../src/lib/matching/descriptors";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

/** A token below this many blocks is noise for this purpose, not a gap worth reading. */
const HIGH_FREQUENCY = 50;

async function main(): Promise<void> {
  const rows = await prisma.pendingMatch.findMany({
    where: { reason: { in: ["mutually-distinct", "descriptor-conflict"] } },
    select: { storeName: true, storeBrand: true, product: { select: { name: true, brand: true } } },
  });

  const blocks = new Map<string, number>();
  const pairTokens: string[][] = [];
  for (const r of rows) {
    const st = prep(r.storeName, r.storeBrand, null);
    const cat = prep(r.product.name, r.product.brand, null);
    const stOnly = [...difference(st.over, cat.over)];
    const catOnly = [...difference(cat.over, st.over)];
    if (!stOnly.length || !catOnly.length) continue;
    const all = [...new Set([...stOnly, ...catOnly])];
    pairTokens.push(all);
    for (const t of all) blocks.set(t, (blocks.get(t) ?? 0) + 1);
  }

  const highFreqNotListed = new Set(
    [...blocks.entries()].filter(([t, n]) => n >= HIGH_FREQUENCY && !isDescriptor(t)).map(([t]) => t),
  );
  const pairsTurningOnOne = pairTokens.filter((ts) => ts.some((t) => highFreqNotListed.has(t))).length;

  console.log("═".repeat(100));
  console.log("DESCRIPTOR LIST — STALENESS SIGNAL");
  console.log("═".repeat(100));
  console.log(`  tokens currently in the list                      ${Object.keys(DESCRIPTORS).length}`);
  console.log(`  blocked pairs examined                            ${pairTokens.length}`);
  console.log(`  distinct tokens doing the blocking                ${blocks.size}`);
  console.log(`  high-frequency (>=${HIGH_FREQUENCY}) tokens NOT in the list      ${highFreqNotListed.size}`);
  console.log(`  blocked pairs turning on at least one of them     ${pairsTurningOnOne}` +
    `  (${((pairsTurningOnOne / Math.max(1, pairTokens.length)) * 100).toFixed(1)}%)`);
  console.log(`\n  TRACK THE LAST TWO NUMBERS OVER TIME. They are high today and that is expected —`);
  console.log(`  most high-frequency blockers are product identity and belong nowhere near the`);
  console.log(`  descriptor list. A sudden RISE is the signal, not the level.`);

  console.log(`\n${"─".repeat(100)}`);
  console.log(`TOP 40 NON-LISTED BLOCKERS — read for words that DESCRIBE rather than NAME`);
  console.log("─".repeat(100));
  const top = [...blocks.entries()]
    .filter(([t]) => !isDescriptor(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);
  for (const [t, n] of top) console.log(`  ${t.padEnd(22)} ${String(n).padStart(6)}`);

  console.log(`\n── FOR CONTRAST, the tokens already in the list and how often they still block ──`);
  const listed = Object.keys(DESCRIPTORS)
    .map((t) => [t, blocks.get(t) ?? 0] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  for (const [t, n] of listed.slice(0, 15)) {
    console.log(`  ${t.padEnd(22)} ${String(n).padStart(6)}  (still blocking — the OTHER side had a real token too)`);
  }
  if (listed.length === 0) console.log(`  none — every listed descriptor now clears the rule on its own.`);

  emitJson({
    listSize: Object.keys(DESCRIPTORS).length,
    pairsExamined: pairTokens.length,
    distinctBlockers: blocks.size,
    highFrequencyNotListed: highFreqNotListed.size,
    pairsTurningOnNotListed: pairsTurningOnOne,
    topNotListed: top.map(([token, n]) => ({ token, n })),
    pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
