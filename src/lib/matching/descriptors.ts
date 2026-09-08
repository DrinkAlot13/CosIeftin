// DESCRIPTORS — words that describe a product without naming a different one.
//
// ── WHY THIS FILE EXISTS.
//
// `mutually-distinct` blocks a pair when EACH side carries a significant token the other lacks.
// That rule is right and it is the decisive one. But two merchants describing the same product
// in different vocabularies trip it:
//
//     "Lapte de consum integral Napolact, 3.5% grasime, 1 l"   catalog-only: consum, integral
//     "Lapte UHT Napolact 3.5% grasime 1L"                     store-only:   uht
//
// Both name one milk. `uht` and `de consum integral` answer different questions about the same
// carton, and neither says the other is a different product. Eleven catalog rows for Napolact
// exist because of this shape, and Freshful's habit of omitting the brand from its names
// produces about 2,000 more.
//
// ── THE RULE, AND ITS LIMIT.
//
//   A descriptor on one side and SILENCE on the other is not a contradiction.
//   A descriptor CONTRADICTING one on the other side still blocks.
//
// `uht` against nothing is a naming difference. `uht` against `proaspat` is a real one — fresh
// milk quoted at UHT's price is a wrong price, not a lost comparison. That is what DIMENSIONS
// are for: two descriptors in the same dimension with different values disagree, and the pair
// stays blocked.
//
// ── WHY THE LIST IS SHORTER THAN THE ONE THAT MEASURED THE CEILING.
//
// The 3.0% ceiling was measured with a deliberately generous fifty-word list, to answer "is this
// worth doing at all". A ceiling may over-include; a shipped rule may not. These were dropped
// after reading them, each because it can NAME a product rather than describe one:
//
//   natural, natur   "Iaurt natural" is a distinct product from "Iaurt cu fructe"
//   clasic           "Crema de branza Hochland Clasic" is a product line
//   traditional      likewise, and it carries a price premium
//   premium, extra, special, superior     all appear inside product-line names
//   fin, mare, mic, nou                   grind, size and recipe variants
//   gust, aroma      "cu gust de …" introduces the flavour, which is identity
//   romanesc         origin, and it is a real premium a shopper chooses
//
// Every entry below is a word I would defend in a code review as never, on its own,
// distinguishing two products of the same brand and size.
//
// ── MAINTENANCE.
//
// A token absent from this list keeps today's behaviour, which is the safe direction: it blocks.
// But it means the list can go stale invisibly as the catalog grows, so `audit:descriptor-gap`
// reports how many blocked pairs turn on a high-frequency token that is not here.

/**
 * Descriptor → the dimension it answers.
 *
 * `null` means the word is pure noise: it can never contradict anything because it carries no
 * value of its own ("grasime" is always accompanied by the number that matters).
 */
export const DESCRIPTORS: Record<string, string | null> = {
  // ── TREATMENT. How the product was processed. uht vs proaspat is a REAL difference.
  uht: "treatment",
  pasteurizat: "treatment",
  pasteurizata: "treatment",
  sterilizat: "treatment",
  sterilizata: "treatment",
  proaspat: "treatment",
  proaspata: "treatment",
  refrigerat: "treatment",
  refrigerata: "treatment",

  // ── FAT LEVEL, as a word. integral vs degresat is a REAL difference; integral vs silence is
  //    not, because the percentage is almost always stated separately and compared numerically.
  integral: "fat-level",
  integrala: "fat-level",
  degresat: "fat-level",
  degresata: "fat-level",
  semidegresat: "fat-level",
  semidegresata: "fat-level",

  // ── PACKAGING. A PET bottle and a carton of the same milk are the same purchase; the site
  //    compares by unit price and the pack shape is already governed by size and packCount.
  pet: "packaging",
  cutie: "packaging",
  sticla: "packaging",
  punga: "packaging",
  caserola: "packaging",
  borcan: "packaging",
  doza: "packaging",
  bidon: "packaging",
  brick: "packaging",
  tetra: "packaging",

  // ── CUT / PRESENTATION: DELIBERATELY ABSENT, and this was a mistake I made and reverted.
  //
  // `feliat`, `feliata`, `felii` and `cuburi` were in this list. They are ALSO in
  // `VARIANT_MARKERS` in scrape-util, which blocks on them — so two lists in one codebase
  // disagreed about one word, which is the exact shape CLAUDE.md warns about for enum columns
  // and for the assign/unassign rule.
  //
  // VARIANT_MARKERS wins, because a whole salami and a pack of sliced salami genuinely are
  // different purchases and only one of them can be quoted at the other's price. The cost is
  // that "Salam de Sibiu Agricola, 120 g" stays unmatched to Freshful's "Salam de Sibiu,
  // feliat 120g" — a LOST COMPARISON, which CLAUDE.md ranks well below a wrong price.
  //
  // `tests/descriptors-disjoint.test.ts` now asserts the two lists can never overlap again.

  // ── PURE NOISE. No value of its own, so it can never contradict.
  grasime: null,
  consum: null,
  ambalat: null,
  ambalata: null,
  vidat: null,
  vidata: null,
};

export function isDescriptor(token: string): boolean {
  return Object.prototype.hasOwnProperty.call(DESCRIPTORS, token);
}

/**
 * Do these two token sets contradict on a descriptor dimension?
 *
 * Returns the dimension and both values when they do, so the caller can say WHY it blocked
 * rather than only that it did.
 */
export function descriptorConflict(a: Iterable<string>, b: Iterable<string>): { dimension: string; a: string; b: string } | null {
  const byDim = new Map<string, string>();
  for (const t of a) {
    const d = DESCRIPTORS[t];
    if (d) byDim.set(d, t);
  }
  for (const t of b) {
    const d = DESCRIPTORS[t];
    if (!d) continue;
    const other = byDim.get(d);
    if (other && other !== t) return { dimension: d, a: other, b: t };
  }
  return null;
}
