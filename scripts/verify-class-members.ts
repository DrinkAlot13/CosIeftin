// Print EVERY candidate a class would match — not the 2-example summary
// `propose:equivalence`'s dry run prints. For flavour-dense clusters (chocolate, biscuits,
// chips, candy) the dangerous members are rarely in the top 2 by score, so this exists to make
// a full read possible before `--apply` rather than after.
//
//   npm run verify:class -- cascaval-400g ciocolata-lapte-90g

import { prisma } from "../src/lib/db";
import { normalizeRo, tokensRo, overlapTokensRo, jaccard } from "../src/lib/text/normalizeRo";
import { membershipOk, rulesFromAttributes } from "../src/lib/substitution/class-rules";

const MIN_SCORE = 0.34;

async function main() {
  const slugs = process.argv.slice(2);
  if (slugs.length === 0) {
    console.error("Usage: npm run verify:class -- <slug> [slug...]");
    process.exit(1);
  }
  for (const slug of slugs) {
    const cls = await prisma.equivalenceClass.findUnique({ where: { slug } });
    if (!cls) { console.error(`\n=== ${slug}: NOT FOUND ===`); continue; }
    const rules = rulesFromAttributes(cls.attributes);
    const head = tokensRo(cls.label)[0] ?? "";
    const labelTokens = new Set(overlapTokensRo(cls.label));
    const products = await prisma.product.findMany({
      where: { section: cls.section, unit: cls.unit, offers: { some: { isStale: false, flagged: false } } },
      select: { name: true, brand: true, unitSize: true },
    });
    const hits = products.filter((p) => {
      let lo: number, hi: number;
      if (rules.anySize) { lo = rules.minUnitSize ?? 0; hi = rules.maxUnitSize ?? Infinity; }
      else if (rules.strictRules) { lo = rules.minUnitSize ?? Infinity; hi = rules.maxUnitSize ?? -Infinity; }
      else { lo = cls.unitSize * 0.85; hi = cls.unitSize * 1.15; }
      if (p.unitSize < lo || p.unitSize > hi) return false;
      const brandParts = new Set(normalizeRo(p.brand ?? "").split(/\s+/).filter(Boolean));
      const lead = tokensRo(p.name).filter((t) => !brandParts.has(t)).slice(0, 2);
      const heads = [head, ...(rules.require ?? []).flatMap((t) => t.split("|").map((x) => normalizeRo(x)))];
      if (!heads.some((h) => h && lead.includes(h))) return false;
      if (!membershipOk(p.name, rules).ok) return false;
      const score = jaccard(labelTokens, new Set(overlapTokensRo(p.name)));
      const hasOwnRules = (rules.require ?? []).length > 0;
      const floor = (rules.anySize || rules.strictRules) && hasOwnRules ? 0 : MIN_SCORE;
      return score >= floor;
    });
    console.log(`\n=== ${slug} (${cls.label}): ${hits.length} ===`);
    for (const h of hits) console.log(`  ${h.name} (${h.unitSize})`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
