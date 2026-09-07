// THE KEY THAT DECIDES WHETHER TWO CATALOG ENTRIES ARE THE SAME PRODUCT.
//
// A word-order-independent token bag of the product NAME, plus its unit and pack size. It is a
// good DETECTOR and a dangerous MERGER — "Lapte 1,5% 1 l" and "Lapte 1 l 1,5%" share a bag, and
// so would two genuinely different variants whose distinguishing word happens to be noise-listed.
// Nothing that imports this may merge on it.
//
// ── WHY IT LIVES HERE RATHER THAN IN THE AUDIT THAT USES IT.
//
// `audit:duplicates` owned this privately, and the projection of what `addNew` would create had
// to guess at it — so "this merchant would create 280 duplicate groups" and "the catalog has 648
// duplicate groups" were two different questions wearing one word, and the 200-group stop
// condition in the brief could not be checked against either. A threshold measured with one
// definition and enforced with another is not a threshold.
//
// One definition, imported by both.

const NOISE = new Set(["de", "cu", "la", "si", "din", "fara", "pentru", "sau", "un", "o", "g", "gr", "kg", "ml", "l", "buc"]);

export function normForKey(s: string): string {
  return s.toLowerCase()
    .split("ș").join("s").split("ş").join("s").split("ț").join("t").split("ţ").join("t")
    .split("ă").join("a").split("â").join("a").split("î").join("i")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/** The token bag. Order-independent, noise words removed, deduplicated. */
export function nameBag(name: string): string {
  return [...new Set(normForKey(name).split(" ").filter((t) => t && !NOISE.has(t)))].sort().join("|");
}

/** The full duplicate key: section, name bag, unit and size. Two products sharing it are one. */
export function duplicateKey(p: { section: string; name: string; unit: string; unitSize: number }): string {
  return `${p.section}::${nameBag(p.name)}::${p.unit}:${p.unitSize}`;
}
