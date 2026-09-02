// COMPARISON sections and PRICE sections are different products, and one metric cannot serve
// both.
//
// Comparability — "two or more shops carry this and I can see both prices" — is the whole
// point of grocery and alcool. It is meaningless for DCNeu, cosmetice and farmacie, which are
// single-merchant by construction: one shop supplies each, so nothing in them can ever be
// comparable and the honest figure will always be 0.0%.
//
// Reporting 0.0% for those frames a design decision as a failure, and it does something worse
// to the headline: DCNeu alone grew from 6,019 to 12,914 products when its scraper stopped
// truncating, which pushed blended comparability from 5.6% down to 5.0% while the catalog
// got strictly better. A metric that falls when you fix a bug is measuring the wrong thing.
//
// So the split is stated once, here, and every surface reads it.

export type SectionKind = "comparison" | "price";

/**
 * Which sections are supplied by more than one merchant.
 *
 * This is a fact about the DATA, not a preference: grocery has twelve merchants and alcool
 * has three, while dcneu, cosmetice and farmacie have exactly one each. If that ever changes
 * — a second pharmacy, a second discounter — move the section here and the metric follows.
 */
const COMPARISON_SECTIONS = new Set(["grocery", "alcohol"]);

export function sectionKind(section: string): SectionKind {
  return COMPARISON_SECTIONS.has(section) ? "comparison" : "price";
}

export const SECTION_LABELS: Record<string, string> = {
  grocery: "Alimentare",
  alcohol: "Alcool",
  dcneu: "DCNeu",
  cosmetice: "Cosmetice",
  farmacie: "Farmacie",
};

/** Romanian wording for what each kind of section actually offers a shopper. */
export const KIND_BLURB: Record<SectionKind, string> = {
  comparison:
    "mai multe magazine vând aceleași produse, deci putem compara prețurile între ele",
  price:
    "un singur magazin, deci arătăm prețul și reducerile pe cantitate — nu o comparație între magazine",
};

export function isComparisonSection(section: string): boolean {
  return sectionKind(section) === "comparison";
}
