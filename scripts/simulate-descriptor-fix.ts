// WHAT WOULD THE DESCRIPTOR FIX ACTUALLY BUY? Simulated over every blocked pair. READ-ONLY.
//
// Before commissioning a language model to classify a few hundred tokens, measure the ceiling on
// what that classification could achieve. If treating EVERY plausible descriptor as
// non-distinguishing unblocks 1% of the queue, the classification is not worth doing however
// good it is.
//
// THE MEASURE HAS TO BE PAIRS, NOT INCIDENCES. A token appearing in 150 blocks does not unblock
// 150 pairs: the pair only unblocks if, after removing descriptors from BOTH sides' unique-token
// sets, one side becomes empty — because mutual distinction needs uniqueness on both sides.
// Counting incidences would overstate the payoff, which is the same shape as the pooled-vs-
// written ratio that overstated Mega Image's write rate.
//
// The descriptor list here is DELIBERATELY GENEROUS — every word either of us has proposed, plus
// obvious siblings. That makes the result an upper bound: the real classification would mark
// some of these as identity tokens and unblock fewer pairs still.
//
//   npm run simulate:descriptors

import { PrismaClient } from "@prisma/client";
import { prep, difference } from "../src/lib/scrape-util";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

/**
 * GENEROUS on purpose — this is a ceiling, not a proposal.
 *
 * Treatment, packaging, form and the words that describe how a thing is sold rather than which
 * thing it is. If the answer with all of these is small, no subset is larger.
 */
const DESCRIPTORS = new Set([
  // treatment / process
  "uht", "pasteurizat", "sterilizat", "proaspat", "proaspata", "refrigerat", "congelat",
  "consum", "integral", "integrala", "degresat", "semidegresat", "grasime", "natur", "natural",
  // packaging / format
  "pet", "cutie", "sticla", "punga", "plasa", "caserola", "borcan", "doza", "tetra", "brick",
  "pachet", "ambalat", "vidat", "felii", "feliat", "feliata", "bucati", "bucata", "portie",
  // generic descriptors
  "premium", "extra", "special", "clasic", "traditional", "romanesc", "romanesti", "calitate",
  "superior", "fin", "fina", "mare", "mic", "mica", "nou", "noua", "gust", "aroma",
]);

async function main(): Promise<void> {
  const rows = await prisma.pendingMatch.findMany({
    where: { reason: "mutually-distinct" },
    select: {
      id: true, storeName: true, storeBrand: true, score: true,
      merchant: { select: { slug: true } },
      product: { select: { id: true, name: true, brand: true } },
    },
  });

  let blocked = 0;
  let unblocked = 0;
  const examples: string[] = [];
  const stillBlockedBy = new Map<string, number>();

  for (const r of rows) {
    const st = prep(r.storeName, r.storeBrand, null);
    const cat = prep(r.product.name, r.product.brand, null);
    const stOnly = [...difference(st.over, cat.over)];
    const catOnly = [...difference(cat.over, st.over)];
    if (stOnly.length === 0 || catOnly.length === 0) continue;
    blocked++;

    // The proposed rule: a descriptor present on one side and ABSENT on the other is not a
    // contradiction, so it stops counting toward uniqueness. Everything else still does.
    const stReal = stOnly.filter((t) => !DESCRIPTORS.has(t));
    const catReal = catOnly.filter((t) => !DESCRIPTORS.has(t));

    if (stReal.length === 0 || catReal.length === 0) {
      unblocked++;
      if (examples.length < 12) {
        examples.push(`    ${r.merchant.slug.padEnd(13)} ${r.storeName.slice(0, 44).padEnd(44)}\n         ↔ ${r.product.name.slice(0, 60)}`);
      }
    } else {
      // What is STILL doing the blocking? That is where the queue actually lives.
      for (const t of [...stReal, ...catReal]) stillBlockedBy.set(t, (stillBlockedBy.get(t) ?? 0) + 1);
    }
  }

  console.log("═".repeat(100));
  console.log("CEILING ON THE DESCRIPTOR FIX — every blocked pair, generous descriptor list");
  console.log("═".repeat(100));
  console.log(`  pairs blocked by mutually-distinct        ${blocked}`);
  console.log(`  pairs that would UNBLOCK                  ${unblocked}  (${((unblocked / Math.max(1, blocked)) * 100).toFixed(1)}%)`);
  console.log(`  pairs still blocked                       ${blocked - unblocked}`);
  console.log(`\n  This is a CEILING. The list above is deliberately generous — a real`);
  console.log(`  classification would mark some of these as identity tokens and unblock fewer.`);

  console.log(`\n── PAIRS THAT WOULD UNBLOCK (a sample) ──`);
  for (const e of examples) console.log(e);

  console.log(`\n── WHAT STILL BLOCKS THE REST, top 25 ──`);
  const still = [...stillBlockedBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  for (const [t, n] of still) console.log(`  ${t.padEnd(20)} ${String(n).padStart(6)}`);
  console.log(`\n  If these are mostly flavours, variants and product lines, the queue is large`);
  console.log(`  because there are genuinely that many near-miss pairs — and the rule is right.`);

  emitJson({
    blocked, unblocked, share: unblocked / Math.max(1, blocked),
    stillBlockedBy: still.map(([token, n]) => ({ token, n })),
    pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
