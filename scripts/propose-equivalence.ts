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
import { membershipOk, rulesFromAttributes } from "../src/lib/substitution/class-rules";

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

  // EVERY SECTION THAT HAS CLASSES, not just grocery.
  //
  // This was hard-coded to `section: "grocery"`, so the two cosmetice classes the Index basket
  // needs — pastă de dinți, șampon — could never receive a product however well their rules
  // matched. The basket reported both as "no shop can fill it", which reads as a catalog gap
  // and was actually a tooling one. Those are different problems with different fixes, and the
  // page was about to state the wrong one.
  //
  // Derived from the classes themselves so adding a class in a new section does not require
  // remembering to edit this line.
  const sections = [...new Set(classes.map((c) => c.section))];
  const products = await prisma.product.findMany({
    where: { section: { in: sections }, offers: { some: { isStale: false, flagged: false } } },
    select: { id: true, name: true, brand: true, unit: true, unitSize: true, section: true, equivalenceClassId: true },
    take: 40000,
  });

  // A PRODUCT MAY ONLY JOIN A CLASS OF ITS OWN SECTION.
  //
  // Widening the product query above to every section that has classes made cross-section
  // matching possible for the first time — a grocery toothpaste could join a cosmetice class.
  // Sections are storefront groupings, not a product taxonomy, and a class quietly spanning two
  // of them changes what the substitution engine offers on every page of both.
  const sectionOf = new Map(products.map((p) => [p.id, p.section]));

  const prepared = classes.map((c) => ({
    c,
    tokens: new Set(overlapTokensRo(c.label)),
    head: tokensRo(c.label)[0] ?? "",
    dose: doseTokens(c.label),
    // The class's OWN discriminators, from its `attributes`. Label-token overlap plus a
    // head-noun rule is not enough on its own: it proposed "Branza de burduf" for telemea,
    // "Cartofi pai" for potatoes and "Slanina de porc" for pork. See lib/substitution/class-rules.
    rules: rulesFromAttributes(c.attributes),
  }));
  const rejected = new Map<string, number>();

  const proposals = new Map<number, { productId: number; name: string; score: number }[]>();
  let considered = 0;

  for (const p of products) {
    considered++;
    const pTokens = new Set(overlapTokensRo(p.name));
    const pDose = doseTokens(p.name);
    let best: { classId: number; score: number } | null = null;

    for (const k of prepared) {
      // Same section, always. See the note on `sectionOf` above.
      if (k.c.section !== (sectionOf.get(p.id) ?? p.section)) continue;
      if (k.c.unit !== p.unit) continue;
      // QUANTITY IS NOT A DISCRIMINATOR FOR GOODS SOLD BY WEIGHT.
      //
      // A class normally pins a pack: 400 g of yoghurt is not 900 g, and the size gate is what
      // keeps those apart. Loose produce is the opposite case — Auchan sells bananas as
      // "+/- 1 kg", Sezamo as "(bucata) cca 200 g", Metro by the piece, and they are the SAME
      // BANANAS. The size gate rejected every such pairing, which is most of why fresh produce
      // sits single-merchant: not a naming problem, a pack-size problem.
      //
      // `anySize` says so explicitly, per class, and it is only honest because lei/kg carries
      // the comparison for these goods — 83.4% of fresh produce is already stored in kg. It is
      // NOT a licence to ignore size generally: a class without it still pins its pack.
      if (k.rules.anySize) {
        // Any size UP TO the ceiling. Without one, a 10 kg catering sack joined the loose
        // class and the loose-vs-packaged distinction vanished — the thing anySize exists
        // alongside, not instead of.
        const cap = k.rules.maxUnitSize ?? Infinity;
        if (p.unitSize > cap) continue;
        if (p.unitSize < (k.rules.minUnitSize ?? 0)) continue;
      } else if (k.rules.strictRules) {
        // AN EXPLICIT WINDOW, NOT A PERCENTAGE.
        //
        // ±26% of 500 g is 370-630 g, and nothing in the class says so. Written out, the window
        // is readable and arguable: a 400 g tin is not a 500 g tin, and whether 690 g belongs
        // with 680 g is a decision somebody should make on purpose rather than inherit from a
        // constant. A strict class states its own bounds and is refused below if it does not.
        if (p.unitSize < (k.rules.minUnitSize ?? Infinity)) continue;
        if (p.unitSize > (k.rules.maxUnitSize ?? -Infinity)) continue;
      } else {
        const sizeOk = k.c.unitSize > 0 && Math.abs(p.unitSize - k.c.unitSize) <= k.c.unitSize * SIZE_TOLERANCE;
        if (!sizeOk) continue;
      }
      // The class's head noun must be what the product IS, not merely something it
      // CONTAINS. Romanian marks the difference with "cu": "Cartofiori cu sare" is a
      // potato snack, not salt; "Crenvurști cu piept de pui" is sausage, not chicken
      // breast; "Banane roșii" are red bananas, not tomatoes. Requiring the class noun to
      // sit in the product's first two significant tokens removes that whole family of
      // false assignments — and they are the dangerous kind, because a wrong class makes
      // the resolver offer a substitute that is not equivalent.
      if (k.head) {
        const lead = tokensRo(p.name).slice(0, 2);
        // The class's own discriminator counts as a head noun too. "Brânză telemea" has head
        // "branza", but every telemea in the catalog is named "Telemea de vaca ..." — leading
        // with the discriminator, not the category word. Requiring the label's head alone
        // rejected all 26 of them.
        const heads = [k.head, ...(k.rules.require ?? []).flatMap((t) => t.split("|").map((x) => normalizeRo(x)))];
        if (!heads.some((h) => h && lead.includes(h))) continue;
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
      // …and the class's own require/exclude discriminators must hold.
      const member = membershipOk(p.name, k.rules);
      if (!member.ok) {
        rejected.set(k.c.slug, (rejected.get(k.c.slug) ?? 0) + 1);
        continue;
      }
      // THE LABEL-OVERLAP FLOOR IS A PROXY, AND A CLASS WITH EXPLICIT RULES DOES NOT NEED IT.
      //
      // `jaccard` compares the class LABEL's tokens with the product's, which is the only
      // signal available when a class has no discriminators of its own. Where require/exclude
      // ARE written, they have already decided membership — and re-litigating it with label
      // overlap rejects correct members for having extra words. "Banane, la kg" against
      // "Banane (bucata) cca 200 g" scores 0.33 and fell under the 0.34 floor: Sezamo's
      // bananas, excluded from the banana class for saying which size the bunch is.
      //
      // Scoped to `anySize` classes — the loose-produce ones written with full require/exclude
      // lists — so the original 30, which lean on the floor, are untouched.
      const score = jaccard(k.tokens, pTokens);
      const hasOwnRules = (k.rules.require ?? []).length > 0;
      const floor = (k.rules.anySize || k.rules.strictRules) && hasOwnRules ? 0 : MIN_SCORE;
      if (score >= floor && (!best || score > best.score)) best = { classId: k.c.id, score };
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
  console.log("CLASS                          PROPOSED  REJECT  EXAMPLES");
  console.log("-".repeat(96));
  for (const k of prepared) {
    const list = (proposals.get(k.c.id) ?? []).sort((a, b) => b.score - a.score);
    const ex = list.slice(0, 2).map((x) => `${x.name.slice(0, 34)} (${x.score.toFixed(2)})`).join(" · ");
    const rej = rejected.get(k.c.slug) ?? 0;
    console.log(`${k.c.slug.padEnd(30)} ${String(list.length).padStart(8)} ${String(rej).padStart(7)}  ${ex}`);
  }

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Read the table above, then re-run with --apply.");
    await prisma.$disconnect();
    return;
  }

  // ── A CORRECTION MUST BE ABLE TO REMOVE A WRONG ASSIGNMENT, not only add a right one.
  //
  // This step was write-only. Tightening a class did nothing: "Ceapa granulata Kamis 20g" stayed
  // in `ceapa-galbena-kg` after `granulat` was added to the exclusions and a 150 g floor was
  // introduced, because the product was already assigned and nothing ever re-checked it. The
  // basket then priced "ceapă galbenă, la kg" from a 20 g jar of dried seasoning — a 100x size
  // spread inside one class — and every subsequent run agreed with itself.
  //
  // `assign-categories` has carried exactly this fix for months, in almost these words. Same
  // defect, second address, found the same way: by measuring the output instead of trusting the
  // input.
  //
  // Clearing happens FIRST, and only for products whose CURRENT class no longer accepts them.
  // A product this run simply did not propose is left alone — the assigner is conservative by
  // design and absence of a proposal is not evidence against an existing assignment.
  const assigned = await prisma.product.findMany({
    where: { equivalenceClassId: { not: null } },
    select: { id: true, name: true, unit: true, unitSize: true, equivalenceClassId: true },
  });
  const classById = new Map(classes.map((c) => [c.id, c]));
  const stale: number[] = [];
  for (const p of assigned) {
    const cls = classById.get(p.equivalenceClassId!);
    if (!cls) continue; // class deleted; leave it for a migration to deal with, not a heuristic
    const rules = rulesFromAttributes(cls.attributes);
    const nameOk = membershipOk(p.name, rules).ok;
    const sizeOk =
      (rules.minUnitSize == null || p.unitSize >= rules.minUnitSize) &&
      (rules.maxUnitSize == null || p.unitSize <= rules.maxUnitSize);
    if (!nameOk || !sizeOk) stale.push(p.id);
  }
  if (stale.length > 0) {
    for (let i = 0; i < stale.length; i += 500) {
      await prisma.product.updateMany({ where: { id: { in: stale.slice(i, i + 500) } }, data: { equivalenceClassId: null } });
    }
    console.log(`\n  cleared ${stale.length} assignment(s) the class no longer accepts`);
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
