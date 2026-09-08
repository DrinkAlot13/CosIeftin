// FULL-CATALOG DIFF for the descriptor exemption. READ-ONLY.
//
// CLAUDE.md: "Every serious bug in this project was found by running the new code and the old
// code over the WHOLE catalog and diffing them — never by a passing test."
//
// The old decision is not re-derived here; it is READ from `PendingMatch.reason`, which the old
// code wrote when the pair was queued. Re-implementing the old rule to compare against would
// share whatever I misunderstood about it.
//
// WHY THE SINGLE-GATE SIMULATION OVERSTATED THIS. `simulate:descriptors` reported 2,097 pairs
// unblocking, by modelling ONE step: whether mutual distinction still fires. But `decide()` is a
// pipeline — a pair that clears mutual distinction then meets `variant-mismatch`, `dose-mismatch`
// and the `low-overlap` floor, and most of these meet one of them. This runs the WHOLE pipeline,
// which is the only number that means anything.
//
//   npm run diff:descriptors
//   npm run diff:descriptors -- --sample=100

import { PrismaClient } from "@prisma/client";
import { prep, decide } from "../src/lib/scrape-util";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const sampleSize = Number((process.argv.find((a) => a.startsWith("--sample=")) ?? "--sample=100").split("=")[1]);

  const rows = await prisma.pendingMatch.findMany({
    select: {
      id: true, storeName: true, storeBrand: true, reason: true, score: true, section: true,
      merchant: { select: { slug: true } },
      product: { select: { id: true, name: true, brand: true, ean: true, unit: true, unitSize: true } },
    },
  });

  type Change = { from: string; to: string; ok: boolean; store: string; catalog: string; merchant: string };
  const changes: Change[] = [];
  const transitions = new Map<string, number>();
  let unchanged = 0;

  for (const r of rows) {
    const st = prep(r.storeName, r.storeBrand, null);
    const cat = prep(r.product.name, r.product.brand, r.product.ean);
    // The queued row carries no store size; use the catalog's, which is what the size gate
    // compared against when the pair was queued.
    const size = { unit: r.product.unit, unitSize: r.product.unitSize };
    const now = decide(cat, size, st, size, r.section);
    if (now.reason === r.reason) { unchanged++; continue; }
    const key = `${r.reason} → ${now.reason}${now.ok ? " (MATCHES)" : ""}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
    changes.push({ from: r.reason, to: now.reason, ok: now.ok, store: r.storeName, catalog: r.product.name, merchant: r.merchant.slug });
  }

  console.log("═".repeat(104));
  console.log(`FULL-CATALOG DIFF — every queued pair re-decided under the new rule`);
  console.log("═".repeat(104));
  console.log(`  pairs re-decided                    ${rows.length}`);
  console.log(`  decision UNCHANGED                  ${unchanged}`);
  console.log(`  decision CHANGED                    ${changes.length}`);
  console.log(`  …of which now MATCH                 ${changes.filter((c) => c.ok).length}`);

  console.log(`\n── EVERY TRANSITION, by frequency ──`);
  for (const [k, n] of [...transitions.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(7)}  ${k}`);
  }

  const nowMatch = changes.filter((c) => c.ok);
  console.log(`\n── ${Math.min(sampleSize, nowMatch.length)} PAIRS THAT NOW MATCH — read these ──`);
  for (const c of nowMatch.slice(0, sampleSize)) {
    console.log(`  ${c.merchant.padEnd(13)} ${c.store.slice(0, 46).padEnd(46)}`);
    console.log(`  ${"".padEnd(13)} ↔ ${c.catalog.slice(0, 62)}`);
  }
  if (nowMatch.length === 0) {
    console.log(`  NONE. Clearing mutual distinction is not enough on its own — the pairs then meet`);
    console.log(`  the later gates. See the transitions above for where they actually land.`);
  }

  emitJson({
    reDecided: rows.length, unchanged, changed: changes.length,
    nowMatch: nowMatch.length,
    transitions: [...transitions.entries()].map(([k, n]) => ({ transition: k, n })),
    sample: nowMatch.slice(0, 200),
    pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
