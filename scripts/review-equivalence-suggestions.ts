// Review queue for shopper-submitted equivalence suggestions ("🔁 Propune un produs echivalent"
// on the product page).
//
// THIS DOES NOT WRITE EquivalenceClass OR Product.equivalenceClassId. It cannot: `seed-equivalence
// .ts` treats the `CLASSES` arrays in src/data/*.ts as the single source of truth and DELETES any
// EquivalenceClass row whose slug is not defined in code, clearing every product assigned to it —
// see that script's own "A SEEDER THAT ADDS MUST ALSO BE ABLE TO REMOVE" comment. A class created
// only in the database would be silently wiped the next time anyone runs `npm run
// seed:equivalence`, which is a normal step in the existing curation workflow. So a CONFIRMED
// suggestion still has to become a real `pack(...)` entry in the right file, reviewed and
// committed like every one of the 247 classes that already exist — this script gets a person to
// that decision fast, it does not make it for them.
//
//   npm run review:equivalence-suggestions                      list PENDING, with both products' real data
//   npm run review:equivalence-suggestions -- --confirm=<id>    mark CONFIRMED, print a pack() draft
//   npm run review:equivalence-suggestions -- --reject=<id> [--note="..."]

import { prisma } from "../src/lib/db";
import { headNoun, overlapTokens } from "../src/lib/scrape-util";
import { normalizeText } from "../src/lib/matching";

const bani = (n: number | null | undefined) => (n == null ? "—" : (n / 100).toFixed(2));

async function printPending() {
  const rows = await prisma.equivalenceSuggestion.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: {
      productA: { select: { id: true, name: true, brand: true, unit: true, unitSize: true, equivalenceClassId: true, offers: { select: { priceBani: true, merchant: { select: { slug: true } } } } } },
      productB: { select: { id: true, name: true, brand: true, unit: true, unitSize: true, equivalenceClassId: true, offers: { select: { priceBani: true, merchant: { select: { slug: true } } } } } },
      user: { select: { username: true } },
    },
  });

  if (rows.length === 0) {
    console.log("No pending suggestions.");
    return;
  }

  console.log(`${rows.length} PENDING suggestion(s):\n`);
  for (const r of rows) {
    const shopsA = [...new Set(r.productA.offers.map((o) => o.merchant.slug))];
    const shopsB = [...new Set(r.productB.offers.map((o) => o.merchant.slug))];
    const pricesA = r.productA.offers.map((o) => o.priceBani).filter((x): x is number => x != null);
    const pricesB = r.productB.offers.map((o) => o.priceBani).filter((x): x is number => x != null);
    console.log(`[#${r.id}] proposed by ${r.user.username}${r.note ? ` — "${r.note}"` : ""}${r.corroborations > 1 ? `  (${r.corroborations} shoppers agree)` : ""}`);
    console.log(`  A: ${r.productA.name}${r.productA.brand ? ` (${r.productA.brand})` : ""}`);
    console.log(`     ${r.productA.unitSize} ${r.productA.unit} · ${bani(Math.min(...pricesA, Infinity))}-${bani(Math.max(...pricesA, -Infinity))} lei · ${shopsA.join(", ") || "no live offers"}${r.productA.equivalenceClassId ? "  [already in a class]" : ""}`);
    console.log(`  B: ${r.productB.name}${r.productB.brand ? ` (${r.productB.brand})` : ""}`);
    console.log(`     ${r.productB.unitSize} ${r.productB.unit} · ${bani(Math.min(...pricesB, Infinity))}-${bani(Math.max(...pricesB, -Infinity))} lei · ${shopsB.join(", ") || "no live offers"}${r.productB.equivalenceClassId ? "  [already in a class]" : ""}`);
    if (r.productA.unit !== r.productB.unit) {
      console.log(`  ⚠ DIFFERENT UNITS (${r.productA.unit} vs ${r.productB.unit}) — almost certainly not comparable as-is.`);
    }
    console.log();
  }
  console.log("Confirm or reject one:");
  console.log("  npm run review:equivalence-suggestions -- --confirm=<id>");
  console.log("  npm run review:equivalence-suggestions -- --reject=<id> [--note=\"why\"]");
}

/** A rough first draft only — require/exclude still need a human's judgement, same as every
 *  other class in this codebase. This just saves re-typing the two names and the size window. */
function draftPack(aName: string, aBrand: string | null, bName: string, bBrand: string | null, unit: string, unitSize: number): string {
  const headA = headNoun(normalizeText(aName), normalizeText(aBrand ?? ""));
  const bTokens = new Set(overlapTokens(normalizeText(bName)));
  const overlap = overlapTokens(normalizeText(aName)).filter((t) => bTokens.has(t));
  const require = overlap.length > 0 ? overlap : [headA ?? "?"];
  const slugGuess = `${headA ?? "produs"}-${Math.round(unitSize * 1000)}${unit}`.replace(/[^a-z0-9-]/gi, "");
  return [
    `  pack("${slugGuess}", "${aName.length < bName.length ? aName : bName}", "${unit}", ${unitSize},`,
    `    [${require.map((r) => `"${r}"`).join(", ")}],`,
    `    [...BIO /* , add real exclusions after reading both names and any siblings */]),`,
  ].join("\n");
}

async function confirm(id: number) {
  const r = await prisma.equivalenceSuggestion.update({
    where: { id },
    data: { status: "CONFIRMED", reviewedAt: new Date() },
    include: { productA: true, productB: true },
  });
  console.log(`[#${id}] marked CONFIRMED.`);
  if (r.productA.unit !== r.productB.unit || r.productA.unitSize == null || r.productB.unitSize == null) {
    console.log("Units/sizes differ or are missing — write the class by hand, this draft would be wrong.");
    return;
  }
  console.log("\nDraft pack() — READ BOTH NAMES AND VERIFY SIBLINGS before pasting into src/data/*.ts:\n");
  console.log(draftPack(r.productA.name, r.productA.brand, r.productB.name, r.productB.brand, r.productA.unit, r.productA.unitSize));
  console.log("\nThen: add it to the right *-classes.ts file, npm run seed:equivalence, verify:class, propose:equivalence --apply.");
}

async function reject(id: number, note: string | null) {
  await prisma.equivalenceSuggestion.update({
    where: { id },
    data: { status: "REJECTED", reviewedAt: new Date(), reviewNote: note },
  });
  console.log(`[#${id}] marked REJECTED.${note ? ` Note: ${note}` : ""}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const confirmArg = argv.find((a) => a.startsWith("--confirm="));
  const rejectArg = argv.find((a) => a.startsWith("--reject="));
  const noteArg = argv.find((a) => a.startsWith("--note="));
  const note = noteArg ? noteArg.slice("--note=".length).replace(/^"|"$/g, "") : null;

  if (confirmArg) await confirm(Number(confirmArg.split("=")[1]));
  else if (rejectArg) await reject(Number(rejectArg.split("=")[1]), note);
  else await printPending();

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
