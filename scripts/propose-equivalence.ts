// Propose EquivalenceClass assignments — DRY RUN by default.
//
// Auto-assignment is deliberately not automatic: putting a product in the wrong class makes
// the resolver offer a substitute that is not equivalent, which is worse than offering none.
// So this PROPOSES, prints what it would do, and only writes with --apply.
//
// The gate it unblocks: EQUIVALENT/CHEAPEST substitution modes fall back to EXACT for every
// product with no class, so the v2 optimizer cannot beat v1 until this runs.
//
// Run: npm run propose:equivalence            (dry run, prints a table)
//      npm run propose:equivalence -- --apply (writes, after you have read the table)

import { prisma } from "../src/lib/db";
import { normalizeRo, tokensRo, overlapTokensRo, jaccard } from "../src/lib/text/normalizeRo";
import { doseTokens } from "../src/lib/scrape-util";

/** Minimum name overlap with the class label before we will propose an assignment. */
const MIN_SCORE = 0.34;
/** Size must be within this of the class's canonical size. */
const SIZE_TOLERANCE = 0.26;

/** Concrete product nouns: if a name STARTS with one of these, that is what the product
 *  is, and a class noun appearing later is an adjective or an ingredient. */
const OTHER_HEADS = new Set([
  "banane", "crenvursti", "parizer", "salam", "carnati", "pateu", "sunca", "chipsuri",
  "cartofiori", "biscuiti", "napolitane", "ciocolata", "inghetata", "prajitura", "tort",
  "supa", "sos", "conserva", "pizza", "sandwich", "burger", "snacks", "baton",
]);

async function main() {
  const apply = process.argv.includes("--apply");
  const classes = await prisma.equivalenceClass.findMany();
  if (classes.length === 0) {
    console.error("No EquivalenceClass rows — run `npm run seed:equivalence` first.");
    process.exit(1);
  }

  const products = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: { isStale: false, flagged: false } } },
    select: { id: true, name: true, brand: true, unit: true, unitSize: true, equivalenceClassId: true },
    take: 20000,
  });

  const prepared = classes.map((c) => ({
    c,
    tokens: new Set(overlapTokensRo(c.label)),
    head: tokensRo(c.label)[0] ?? "",
    dose: doseTokens(c.label),
  }));

  const proposals = new Map<number, { productId: number; name: string; score: number }[]>();
  let considered = 0;

  for (const p of products) {
    considered++;
    const pTokens = new Set(overlapTokensRo(p.name));
    const pDose = doseTokens(p.name);
    let best: { classId: number; score: number } | null = null;

    for (const k of prepared) {
      if (k.c.unit !== p.unit) continue;
      const sizeOk = k.c.unitSize > 0 && Math.abs(p.unitSize - k.c.unitSize) <= k.c.unitSize * SIZE_TOLERANCE;
      if (!sizeOk) continue;
      // The class's head noun must be what the product IS, not merely something it
      // CONTAINS. Romanian marks the difference with "cu": "Cartofiori cu sare" is a
      // potato snack, not salt; "Crenvurști cu piept de pui" is sausage, not chicken
      // breast; "Banane roșii" are red bananas, not tomatoes. Requiring the class noun to
      // sit in the product's first two significant tokens removes that whole family of
      // false assignments — and they are the dangerous kind, because a wrong class makes
      // the resolver offer a substitute that is not equivalent.
      if (k.head) {
        const lead = tokensRo(p.name).slice(0, 2);
        if (!lead.includes(k.head)) continue;
        // "cu <noun>" is Romanian for "containing <noun>" — the product is the thing BEFORE
        // it. "Crenvurști cu piept de pui" is sausage; "Parizer cu carne de porc" is parizer.
        if (new RegExp(`\\bcu\\s+(?:\\w+\\s+){0,2}${k.head}\\b`).test(normalizeRo(p.name))) continue;
        // …and the class noun must not be a mere adjective on another product:
        // "Banane roșii" are red bananas, not tomatoes. If the FIRST significant token is
        // some other concrete noun, this product is that noun.
        if (tokensRo(p.name)[0] !== k.head && OTHER_HEADS.has(tokensRo(p.name)[0] ?? "")) continue;
      }
      // a stated strength must not CONTRADICT the class (3,5% milk is not the 1,5% class)
      if (k.dose && pDose && k.dose !== pDose) continue;
      const score = jaccard(k.tokens, pTokens);
      if (score >= MIN_SCORE && (!best || score > best.score)) best = { classId: k.c.id, score };
    }

    if (best) {
      const list = proposals.get(best.classId) ?? [];
      list.push({ productId: p.id, name: p.name, score: best.score });
      proposals.set(best.classId, list);
    }
  }

  const totalProposed = [...proposals.values()].reduce((a, b) => a + b.length, 0);
  console.log(`\nConsidered ${considered} grocery products with live offers.`);
  console.log(`Proposed ${totalProposed} assignments across ${proposals.size}/${classes.length} classes.\n`);
  console.log("CLASS                          PROPOSED  EXAMPLES");
  console.log("-".repeat(96));
  for (const k of prepared) {
    const list = (proposals.get(k.c.id) ?? []).sort((a, b) => b.score - a.score);
    const ex = list.slice(0, 2).map((x) => `${x.name.slice(0, 34)} (${x.score.toFixed(2)})`).join(" · ");
    console.log(`${k.c.slug.padEnd(30)} ${String(list.length).padStart(8)}  ${ex}`);
  }

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Read the table above, then re-run with --apply.");
    await prisma.$disconnect();
    return;
  }

  let written = 0;
  for (const [classId, list] of proposals) {
    for (const p of list) {
      await prisma.product.update({ where: { id: p.productId }, data: { equivalenceClassId: classId } });
      written++;
    }
  }
  console.log(`\n✓ Assigned ${written} products to equivalence classes.`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
