// Shared scraper helpers: match a store's scraped product pool onto the catalog
// (per section: "grocery", "alcohol", …), upsert that store's offers, and — when
// addNew is set — CREATE catalog products for pool items that match nothing yet.
//
// Data-quality invariants baked in here (see CLAUDE.md):
//   • EAN is a JOIN, not a guess — an exact GTIN match always wins.
//   • Human MatchOverride decisions survive a rebuild and beat the heuristic.
//   • Every match carries a confidence score + reason; low ones are flagged for review.
//   • Prices pass a sanity gate (vs the offer's own history + the cross-store median) —
//     which FLAGS and records, and never substitutes the stored price for the fresh one.
//     History-anchoring defends stale data against fresh data, and the four cases examined
//     by hand all went the same way: the refused value was the correct one.
//   • A run that collapses to <60% of the store's last offer count is REFUSED (site
//     redesign / block) instead of wiping good data.
//   • Price history is append-on-change only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "./db";
import { parseSize } from "./ingest-core";
import { normalizeText } from "./matching";
import { parseEan } from "./product/ean";
import { baniToLei, leiToBaniExact, perUnitBaniOrNull } from "./price/parsePrice";
import { tally as tallyCensus } from "./offer-census";
import { ensureBackup } from "./ensure-backup";
import { recordRefusal, MAX_PRE_OFFER_REFUSALS } from "./record-refusal";
import { toPriceSource, isPriceSource, type PriceSource } from "./price-source";
import { variantConflict } from "./variant-classes";
import { depositFor, readPublishedDepositBani } from "./deposit";
import { parseQuantity } from "./units/parseQuantity";
import { exclusionReason } from "./excluded-categories";
import { recordScraperRun } from "./scraper-run";
import { rejectedPairs, reassertStandingDecisions } from "./standing-decisions";

/**
 * THE contract between a scraper and the matcher. Every scraper builds `StoreProduct[]`
 * directly and passes it through unchanged.
 *
 * Do NOT re-map the pool into a narrower object at the call site. That is not a style
 * preference — it is how `productUrl` and `rawPriceText` were silently dropped at Metro and
 * Mega Image, and how Carrefour lost its reference prices too: the scraper set the fields
 * correctly, then `pool.map((c) => ({ name, brand, price, available, url, image }))` at the
 * matcher call threw them away. TypeScript cannot object, because a narrower object is a
 * perfectly valid StoreProduct. Passing `pool` unmapped is what makes the compiler an ally.
 */
export type StoreProduct = {
  name: string;
  brand: string;
  price: number;
  available: boolean;
  url: string;
  image: string | null;
  /// the merchant's own id for this product (SKU / product code), where it publishes one.
  /// Used for dedupe within a run, and is the closest thing to a stable key most RO
  /// merchants offer given that none of them publish a GTIN.
  sourceId?: string | null;
  /// optional category slug used only when creating NEW catalog products
  category?: string;
  /// THE MERCHANT'S OWN CATEGORY for this product, as the scraper saw it — "lactate-si-oua",
  /// "alimentare/bacanie". Distinct from `category` above, which is a slug in OUR taxonomy
  /// used only at product creation; this is the merchant's fact, recorded whether or not it
  /// maps onto anything of ours, and it outranks any category we infer from a name.
  ///
  /// Scrapers that iterate a category list to FIND products already know this and were
  /// dropping it at the write. Set it at the read site; never guess it.
  categoryPath?: string | null;
  /// optional EAN/GTIN (from JSON-LD / product JSON) — turns matching into a join
  ean?: string | null;
  /// "SHELF" | "ONLINE" | "DELIVERY_PLATFORM" | "FLYER" — overrides the merchant default
  priceSource?: string;
  /// THE exact source string the price came from. Persisted verbatim so a future parser
  /// change can be verified against history (see CLAUDE.md → Prices).
  rawPriceText?: string | null;
  /// raw structured record where the source has one; truncated on write
  rawSourceBlob?: string | null;
  /// deep link to THIS product; null when the source genuinely has none (flyers)
  productUrl?: string | null;
  /// advertised "was"/30-day-low price, in bani
  referencePriceBani?: number | null;
  referencePriceKind?: string | null;
  promoValidFrom?: Date | null;
  promoValidTo?: Date | null;
};

/** What a pool carries, as a fraction of its rows. Reported per run and gated on. */
export type PoolCompleteness = {
  /** items carrying the merchant's own payload — the only basis for an independent check */
  withSourceBlob: number;
  sourceBlobPct: number;
  total: number;
  withRawPriceText: number;
  withProductUrl: number;
  withEan: number;
  withImage: number;
  rawPriceTextPct: number;
  productUrlPct: number;
  /** items carrying the merchant's OWN category — merchant truth, not our inference */
  withCategoryPath: number;
  categoryPathPct: number;
};

/** How much of a pool must carry rawPriceText before the run is allowed to write. */
export const MIN_RAW_PRICE_TEXT_PCT = 95;

export function poolCompleteness(pool: StoreProduct[]): PoolCompleteness {
  const total = pool.length;
  const nonEmpty = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;
  const withRawPriceText = pool.filter((p) => nonEmpty(p.rawPriceText)).length;
  const withProductUrl = pool.filter((p) => nonEmpty(p.productUrl)).length;
  const withEan = pool.filter((p) => nonEmpty(p.ean)).length;
  const withImage = pool.filter((p) => nonEmpty(p.image)).length;
  // The source payload is what makes an INDEPENDENT check possible. Kaufland's own
  // per-unit price found 25 real size bugs; ten of twelve merchants could not be checked at
  // all, because their payload was discarded here. Coverage is reported so that gap is
  // visible per run rather than discovered a month later.
  const withSourceBlob = pool.filter((p) => nonEmpty(p.rawSourceBlob)).length;
  // REPORTED SO A SCRAPER THAT STOPS SUPPLYING IT IS LOUD RATHER THAN SILENT. Three scrapers
  // iterated categories to find products and dropped the category before the write, and the
  // catalog then inferred from the product name a fact the merchant had already stated. The
  // only way that stays fixed is if the number is on screen every run.
  const withCategoryPath = pool.filter((p) => nonEmpty(p.categoryPath)).length;
  const pct = (n: number): number => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
  return {
    total, withRawPriceText, withProductUrl, withEan, withImage, withSourceBlob,
    withCategoryPath,
    rawPriceTextPct: pct(withRawPriceText), productUrlPct: pct(withProductUrl),
    sourceBlobPct: pct(withSourceBlob), categoryPathPct: pct(withCategoryPath),
  };
}

/**
 * Refuse a pool that has lost its provenance.
 *
 * `rawPriceText` is the exact source string a price was parsed from. Without it no parser
 * change can ever be verified against history — which is precisely why a strikethrough diff
 * was once impossible to run here. It is also the one field a scraper can always supply, since
 * it is the very string it just parsed. So a pool arriving without it has been mangled between
 * the scraper and this function, and writing it would quietly destroy the audit trail.
 *
 * `productUrl` is reported, not enforced: flyer sources genuinely have no per-product link.
 */
export function assertPoolContract(pool: StoreProduct[], label: string): PoolCompleteness {
  const c = poolCompleteness(pool);
  if (c.total > 0 && c.rawPriceTextPct < MIN_RAW_PRICE_TEXT_PCT) {
    throw new Error(
      `[${label}] pool contract violated: only ${c.withRawPriceText}/${c.total} products ` +
      `(${c.rawPriceTextPct}%) carry rawPriceText, minimum is ${MIN_RAW_PRICE_TEXT_PCT}%. ` +
      `Without the exact source string no parser change can be verified against history. ` +
      `The usual cause is a pool.map() at the matchPoolToCatalog call site dropping fields ` +
      `the scraper set correctly — pass the pool unmapped.`,
    );
  }
  return c;
}

/**
 * This merchant's offers, bucketed, as JSON — recorded against the run that produced them.
 *
 * Uses the same classifier as `npm run census`, so a per-run number and the whole-database
 * number can never tell different stories.
 */
async function censusForMerchant(merchantId: number): Promise<string> {
  const now = new Date();
  const rows = await prisma.offer.findMany({
    where: { merchantId },
    select: {
      isStale: true, isExpired: true, availability: true, stockStatus: true, flagged: true,
      vatBasis: true, promoValidTo: true, lastObservedAt: true, priceSource: true,
      merchant: { select: { active: true } },
      anomalies: { where: { resolved: false }, select: { id: true } },
    },
  });
  const { totals, total, closes } = tallyCensus(
    rows.map((o) => ({
      merchantActive: o.merchant.active,
      // This run just wrote, by definition.
      merchantScrapedRecently: true,
      anomalies: o.anomalies.length,
      flagged: o.flagged,
      isExpired: o.isExpired,
      promoValidTo: o.promoValidTo,
      isStale: o.isStale,
      lastObservedAt: o.lastObservedAt,
      priceSource: o.priceSource,
      availability: o.availability,
      stockStatus: o.stockStatus,
      vatBasis: o.vatBasis,
    })),
    now,
  );
  const nonZero = Object.fromEntries(Object.entries(totals).filter(([, n]) => n > 0));
  return JSON.stringify({ total, closes, ...nonZero });
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Romanian filler/size words that never make a good matching anchor.
const STOP = new Set(["de", "cu", "la", "si", "din", "fara", "pentru", "sau", "un", "cel"]);

/** Significant name tokens: length >= 3, not a stopword, not a number/size. Used as the
 *  blocking key (head-noun + token index), where short tokens would be useless noise. */
export function sigTokens(nname: string): string[] {
  return nname.split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t) && !/\d/.test(t));
}

/** Tokens used for the OVERLAP score: every alphabetic token, including SHORT ones.
 *  Short tokens are exactly where variants hide ("Cuvée I" vs "Cuvée IX", "Rose" vs "Brut"),
 *  so dropping them under 3 chars silently merges distinct bottles. Numbers/sizes stay out —
 *  size is already checked separately and would inflate the score. */
// Bare unit letters are size noise, not name content.
const UNIT_NOISE = new Set(["l", "g", "kg", "ml", "cl", "x", "buc", "gr", "bax"]);

/** A pure size token: a number, optionally with a unit suffix. "250ml", "1kg", "0", "75l". */
// Dosage units (mg/UI/mcg) belong here too: `doseTokens` compares strength explicitly, so
// leaving "2000ui" in the overlap set made it a phantom distinguishing token against a name
// that wrote the same dose as "2000 UI".
const SIZE_TOKEN = /^\d+(?:[.,]\d+)?(?:ml|l|kg|g|gr|cl|mg|mcg|ui|iu|buc|x)?$/;

export function overlapTokens(nname: string): string[] {
  return nname
    .split(/\s+/)
    // Keep SHORT tokens — that is where variants hide — but drop bare unit letters: the
    // stray "x" and "l" from "6 x 1,5 l" dragged genuinely identical multipacks under the
    // overlap threshold.
    //
    // Crucially, only PURE size tokens are dropped, not everything containing a digit.
    // Alphanumeric names ARE the product: "WELLAFLEX FIXATIV PAR 250ML 2VOLUME" lost
    // "2volume" — its only distinguishing token — and became a generic "wellaflex fixativ
    // par" that every other Wellaflex variant matched. Same for "3in1", "5+", "12yo".
    .filter((t) => t.length >= 1 && !STOP.has(t) && !SIZE_TOKEN.test(t) && !UNIT_NOISE.has(t));
}

/** The catalog item's anchor noun = its first significant token (RO names are noun-first). */
export function headNoun(nname: string): string {
  return sigTokens(nname)[0] ?? "";
}

/**
 * Tokens that ARE the product rather than describing it.
 *
 * Jaccard alone cannot separate "Nivea Men Deep Clean 500ml" from "Nivea Men Energy 500ml":
 * they differ by two short tokens inside a mostly-identical name, which still scores high.
 * But those two tokens are the entire difference a shopper cares about. So any of these
 * appearing on one side and not the other blocks the match outright.
 *
 * Kept deliberately narrow — a marker only earns a place here if its presence genuinely
 * changes which product you get.
 */
const VARIANT_MARKERS = new Set([
  // audience / line
  "men", "women", "barbati", "femei", "copii", "kids", "baby", "junior",
  // dietary / provenance claims — these change the product AND its price
  "bio", "eco", "organic", "vegan", "light", "zero", "fara", "diet",
  // preparation / state
  "instant", "macinat", "macinata", "boabe", "feliat", "feliata",
  "afumat", "afumata", "congelat", "congelata",
  // NOTE: "proaspat"/"uscat" and colour words are deliberately NOT here. Outside wine they
  // are descriptive ("Zahar ALB tos", "ECO Baby Spanac PROASPAT") and blocking on them cost
  // real cross-store matches. Wine styles are handled by the alcohol-only list below.
  // pack framing
  "cadou", "set", "caseta", "borseta", "pachet", "multipack",
  // strength / concentration framing
  "forte", "intense", "extra", "max", "plus", "premium", "sensitive", "clasic", "classic",
]);

/** Wine/spirits styles. Colour and sweetness ARE the product in alcohol ("Brut" vs "Rose"),
 *  but are mere description in grocery ("zahar alb"), so they only apply outside grocery. */
const ALCOHOL_VARIANT_MARKERS = new Set([
  "brut", "rose", "sec", "demisec", "dulce", "demidulce", "spumant", "alb", "rosu", "negru", "neon", "magnum",
]);

/** The variant markers present in a token set. */
export function variantTokens(tokens: Set<string>, section = "grocery"): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) {
    if (VARIANT_MARKERS.has(t)) out.add(t);
    else if (section !== "grocery" && ALCOHOL_VARIANT_MARKERS.has(t)) out.add(t);
  }
  return out;
}

/** Tokens in `a` with no counterpart in `b`.
 *
 * "Counterpart" is deliberately fuzzy, because retailers abbreviate and misspell constantly:
 * "comprimate"/"compr.", "capsule"/"caps", "bucati"/"buc", "deodorant"/"deo",
 * "paprica"/"paprika". Treating those as distinguishing tokens rejected genuinely identical
 * products across stores. A counterpart is a prefix (>=3 chars) or a single-character typo. */
export function difference(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const t of a) {
    if (b.has(t)) continue;
    let matched = false;
    for (const u of b) {
      const short = t.length <= u.length ? t : u;
      const long = t.length <= u.length ? u : t;
      if (short.length >= 3 && long.startsWith(short)) { matched = true; break; }
      // 6+ only: at 5 chars a single-letter difference is often a real variant
      // ("crema" vs "creme"), not a typo. "paprica"/"paprika" is 7 and still matches.
      if (t.length === u.length && t.length >= 6 && oneCharApart(t, u)) { matched = true; break; }
    }
    if (!matched) out.add(t);
  }
  return out;
}

/** Same length, differing in exactly one position (paprica / paprika). */
function oneCharApart(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
  return diff === 1;
}

/**
 * Dosage / strength / fat content, normalised into a comparable signature.
 *
 * The overlap scorer drops numeric tokens on purpose (pack size is validated separately,
 * and leaving numbers in inflates the score). But strength is a NUMBER and it is the whole
 * product: 500 mg vs 1000 mg paracetamol, 2000 UI vs 4000 UI vitamin D, 1.5% vs 3.5% milk.
 * Those must be compared explicitly or they slip through as identical names.
 *
 * Returns a stable string like "500mg|3.5%" — "" when the name states no strength.
 */
export function doseTokens(nname: string): string {
  const out: string[] = [];
  // milligrams / grams of active substance, international units
  for (const m of nname.matchAll(/(\d+(?:[.,]\d+)?)\s*(mg|ui|iu|mcg)\b/g)) {
    out.push(`${parseFloat(m[1].replace(",", "."))}${m[2]}`);
  }
  // Garment/egg size codes: "marimea L" vs "marimea M" is a different product, but the
  // letter is a single character that the overlap tokens drop as unit noise.
  //
  // THIS REGEX HAD NEVER MATCHED ANYTHING. It was written through a shell heredoc that ate a
  // layer of backslashes, so `\s*` became `s*` (a literal letter s) and the trailing `\b`
  // became an actual BACKSPACE character, 0x08 — which no product name contains, so the whole
  // pattern was unsatisfiable. It compiled, it ran, it returned nothing, for as long as it has
  // existed. Found by `npm run check:hygiene` on its first run.
  //
  // The cost was visible the whole time and attributed elsewhere: the golden set's standing
  // false match is "Oua de gaina marimea L, 10 bucati" against "…marimea M, 10 bucati".
  for (const m of nname.matchAll(/m[aă]rim[ea]*\s*:?\s*(xs|s|m|l|xl|xxl)(?![a-z])/gi)) {
    out.push(`size:${m[1].toLowerCase()}`);
  }
  // percentages: fat content, alcohol, concentration
  for (const m of nname.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)) {
    out.push(`${parseFloat(m[1].replace(",", "."))}%`);
  }
  return out.sort().join("|");
}

/** Strict Jaccard overlap of two token sets (0..1). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Jaccard that counts an abbreviation or typo as a shared token.
 *  Retailers write "comprimate" and "compr.", "capsule" and "caps", "paprica" and
 *  "paprika" — scoring those as disjoint made identical products look unrelated. */
export function fuzzyJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const aOnly = difference(a, b).size;
  const bOnly = difference(b, a).size;
  const shared = Math.max(a.size - aOnly, b.size - bOnly);
  const union = shared + aOnly + bOnly;
  return union === 0 ? 0 : shared / union;
}

// ─── pure matching decision (unit-tested against the golden set) ──────────────────
export type CatalogLite = { name: string; brand?: string | null; unit: string; unitSize: number; ean?: string | null };
export type StoreLite = { name: string; brand?: string | null; unit: string; unitSize: number; ean?: string | null };
/**
 * Three-band outcome, not a boolean.
 *
 * The mutual-distinction rule is right but blunt: it REJECTS where it should sometimes
 * DEFER. Coverage fell hard when it shipped (Freshful 1786 -> 343, Mega 2572 -> 732), and
 * most of what vanished was neither clearly right nor clearly wrong. A middle band keeps
 * those as PENDING for review instead of discarding them.
 */
export type MatchBand = "AUTO_MATCH" | "REVIEW" | "REJECT";
export type Decision = { ok: boolean; band: MatchBand; score: number; reason: string };

/** Score at or above this is published live. */
export const AUTO_MATCH_THRESHOLD = 0.62;
/** Score at or above this (but below AUTO) is persisted PENDING and reviewed, not shown. */
export const REVIEW_THRESHOLD = 0.42;

export type PrepItem = { nname: string; raw: string; nbrand: string; tokens: Set<string>; over: Set<string>; ean: string };
export function prep(name: string, brand: string | null | undefined, ean: string | null | undefined): PrepItem {
  const nname = normalizeText(name);
  // keep the raw name too: normalizeText strips % and unit letters, which is exactly
  // where dosage lives ("1,5% grasime", "500 mg")
  return { nname, raw: String(name).toLowerCase(), nbrand: normalizeText(brand ?? ""), tokens: new Set(sigTokens(nname)), over: new Set(overlapTokens(nname)), ean: parseEan(ean) };
}

/** Core rule: does store item `st` correspond to catalog item `cat` in this section? */
/**
 * How far two sizes may differ and still be the same product. Also the tolerance used to decide
 * that an offer's own size DISAGREES with the catalog product it was matched to.
 */
export const SIZE_TOLERANCE = 0.06;

/**
 * EVERY verdict `decide()` can return. Enumerated so that coverage can be MEASURED.
 *
 * `doseTokens()` carried a regex that had never matched anything: present, referenced, and
 * unsatisfiable because a shell had eaten a backslash. Nothing distinguished "this rule is
 * wrong" from "this rule never runs", and the cost showed up in the golden set as a false
 * match on eggs, attributed to matcher tuning for weeks.
 *
 * So every run counts how often each rule fired, and a rule at ZERO is reported. Zero is not
 * proof of a bug — `ean` legitimately never fires on a merchant that publishes no GTIN — but
 * it is the only signal that separates a dead rule from a quiet one, and it costs nothing.
 *
 * `tests/decision-coverage.test.ts` asserts this list still matches the literals in
 * `decide()`, so a new rule cannot be added without appearing here.
 */
export const DECISION_REASONS = [
  // accept
  "ean", "brand+size", "name+size",
  // reject / review
  "size-unit", "size", "head-noun", "brand",
  // hard blocks: a disagreement inside a variant class, or a different pack shape
  "variant-flavour", "variant-qualifier", "variant-fat", "variant-format", "pack-shape",
  "mutually-distinct", "variant-mismatch", "dose-mismatch", "low-overlap",
] as const;
export type DecisionReason = (typeof DECISION_REASONS)[number];

/** Counts how often each rule in `decide()` fired across one run. */
export class DecisionCoverage {
  private readonly counts = new Map<string, number>();
  private readonly banded = new Map<string, number>();

  record(d: Decision): void {
    this.counts.set(d.reason, (this.counts.get(d.reason) ?? 0) + 1);
    const k = `${d.reason}|${d.band}`;
    this.banded.set(k, (this.banded.get(k) ?? 0) + 1);
  }

  /** Rules that never fired. A corrupted pattern lands here; so does a legitimately quiet one. */
  get silent(): string[] {
    return DECISION_REASONS.filter((r) => !this.counts.has(r));
  }

  report(label: string): void {
    const total = [...this.counts.values()].reduce((a, b) => a + b, 0);
    if (total === 0) return;
    console.log(`  rule coverage (${label}): ${total} decisions`);
    const rows = DECISION_REASONS.map((r) => ({ r, n: this.counts.get(r) ?? 0 }))
      .sort((a, b) => b.n - a.n);
    const line = rows
      .map(({ r, n }) => `${r}=${n}${n === 0 ? " ⚠" : ""}`)
      .join("  ");
    console.log(`    ${line}`);
    if (this.silent.length > 0) {
      console.log(
        `    ⚠ ${this.silent.length} rule(s) never fired: ${this.silent.join(", ")} — ` +
        `either legitimately quiet, or a pattern that cannot match (see doseTokens).`,
      );
    }
  }
}

export function decide(cat: PrepItem, catSize: { unit: string; unitSize: number }, st: PrepItem, stSize: { unit: string; unitSize: number } | null, section: string): Decision {
  if (cat.ean && st.ean && cat.ean === st.ean) return { ok: true, band: "AUTO_MATCH", score: 1, reason: "ean" };
  if (!stSize || stSize.unit !== catSize.unit) return { ok: false, band: "REJECT", score: 0, reason: "size-unit" };
  if (Math.abs(stSize.unitSize - catSize.unitSize) > catSize.unitSize * SIZE_TOLERANCE + 1e-9) return { ok: false, band: "REJECT", score: 0, reason: "size" };
  const chead = headNoun(cat.nname);
  if (chead && !st.tokens.has(chead) && !st.nname.includes(chead)) return { ok: false, band: "REJECT", score: 0, reason: "head-noun" };
  const branded = cat.nbrand.length > 0;
  const brandHit = branded && (st.nbrand.includes(cat.nbrand) || st.nname.includes(cat.nbrand));
  if (branded && !brandHit) return { ok: false, band: "REJECT", score: 0, reason: "brand" };
  // A shared head-noun + size is far too loose where one brand spans many distinct
  // products (all alcohol; also polluted brand fields). OUTSIDE grocery, and for any
  // UNBRANDED grocery name, additionally require high name overlap — scored over
  // overlapTokens so short variant markers ("Rose" vs "Brut", "I" vs "IX") still count.
  // EVERY section requires name overlap now — including branded grocery, which used to
  // skip this check entirely. That exemption was why one Nivea shower gel backed 17
  // products at three merchants and Chio chips fanned out 15×: brand + head-noun + size
  // is not a product, it is a product FAMILY.
  const jac = fuzzyJaccard(cat.over, st.over);

  // ── VARIANT CLASS CONFLICT — A HARD BLOCK, CHECKED BEFORE ANYTHING SCORED ─────────
  //
  // If the two names disagree about flavour, formulation, fat content or container, they are
  // different products and no amount of name overlap changes that.
  //
  // This runs BEFORE mutual distinction on purpose. Mutual distinction fires on the Pepsi
  // case but returns REVIEW rather than REJECT whenever the Jaccard score clears the review
  // threshold — and "Bautura carbogazoasa … Pepsi …" against "Bautura carbogazoasa … Pepsi …"
  // clears it comfortably. A REVIEW verdict still keeps the pair out of the catalog, but the
  // score decided the outcome, and for a flavour difference the score should not get a vote.
  //
  // The size gate could not catch it either: 6 × 0.33 = 1.98 L against a 2 L bottle is a 1%
  // difference and the tolerance is 6%. Two unrelated products agreed on volume by accident.
  const vc = variantConflict(cat.raw, st.raw);
  if (vc) {
    return {
      ok: false, band: "REJECT", score: jac,
      reason: `variant-${vc.klass}`,
    };
  }

  // ── PACK SHAPE — a 6-pack and a single bottle are different products ──────────────
  //
  // The totals can agree to within a percent while the products could not be less alike.
  // Only blocks when both sides state a shape and at least one is a genuine multipack, so a
  // plain "2 l" against a plain "2 l" (both packCount 1 by default) is untouched.
  const catPack = parseQuantity(cat.raw)?.packCount ?? 1;
  const stPack = parseQuantity(st.raw)?.packCount ?? 1;
  if (catPack !== stPack && Math.max(catPack, stPack) > 1) {
    return { ok: false, band: "REJECT", score: jac, reason: "pack-shape" };
  }

  // ── MUTUAL DISTINCTION ────────────────────────────────────────────────────────────
  // The decisive rule, and it is structural rather than a vocabulary list — enumerating
  // every flavour, scent and shade is a game you lose.
  //
  // If EACH side carries a significant token the other lacks, the two names are making
  // DIFFERENT claims, and they are different products:
  //     "Chipsuri cu sare Chio"    unique {sare}
  //     "Chipsuri cu paprica Chio" unique {paprica}   → both distinguish → reject
  //
  // When only ONE side has extra tokens, it is usually the same product described more
  // fully ("Nurofen 200mg 24 comprimate" vs "…comprimate filmate") → allowed, and the
  // Jaccard threshold below still governs how much extra is tolerable.
  const catOnly = difference(cat.over, st.over);
  const stOnly = difference(st.over, cat.over);
  if (catOnly.size > 0 && stOnly.size > 0) {
    // A near-miss on mutual distinction is exactly the case that should be reviewed rather
    // than discarded — it is where the lost Freshful/Mega coverage lives.
    return { ok: false, band: jac >= REVIEW_THRESHOLD ? "REVIEW" : "REJECT", score: jac, reason: "mutually-distinct" };
  }

  // One-sided extras are still disqualifying when the extra word is a VARIANT marker
  // ("Neon", "Magnum", "Cutie Cadou", "Forte"): those name a different product rather
  // than describe the same one.
  const catVariant = variantTokens(cat.over, section);
  const stVariant = variantTokens(st.over, section);
  for (const v of catVariant) if (!stVariant.has(v)) return { ok: false, band: "REJECT", score: jac, reason: "variant-mismatch" };
  for (const v of stVariant) if (!catVariant.has(v)) return { ok: false, band: "REJECT", score: jac, reason: "variant-mismatch" };

  // Dosage and strength live in NUMBERS, which the overlap scorer deliberately drops
  // (size is checked separately). But 500 mg and 1000 mg are different medicines, and
  // 1.5% and 3.5% are different milks — so compare those explicitly.
  const catDose = doseTokens(cat.raw);
  const stDose = doseTokens(st.raw);
  // Only a CONTRADICTION disqualifies. One side omitting the strength ("Unt Covalact 200g"
  // vs "Unt de masa Covalact 82% 200 g") is silence, not disagreement.
  if (catDose && stDose && catDose !== stDose) return { ok: false, band: "REJECT", score: jac, reason: "dose-mismatch" };

  // Beyond variants, require genuine name overlap. Grocery is tuned looser than
  // wine (0.55 vs 0.6): grocery names carry more boilerplate ("de consum", "grasime")
  // that dilutes the score between two genuinely identical products.
  const threshold = section === "grocery" ? 0.55 : 0.6;
  // A single-token unbranded name has nothing to compare; fall back to the head-noun rule.
  const canScore = cat.over.size >= 2 && st.over.size >= 2;
  if (canScore && jac < threshold) {
    return { ok: false, band: jac >= REVIEW_THRESHOLD ? "REVIEW" : "REJECT", score: jac, reason: "low-overlap" };
  }

  const score = Math.min(1, 0.45 + 0.4 * jac + (brandHit ? 0.15 : 0));
  // Above AUTO it is published; between the thresholds it is persisted PENDING and shown
  // only in the admin queue.
  const band: MatchBand = score >= AUTO_MATCH_THRESHOLD ? "AUTO_MATCH" : score >= REVIEW_THRESHOLD ? "REVIEW" : "REJECT";
  return { ok: band === "AUTO_MATCH", band, score, reason: branded ? "brand+size" : "name+size" };
}

/** Test-friendly wrapper: decide from raw catalog/store items. */
export function matchDecision(cat: CatalogLite, store: StoreLite, section = "grocery"): Decision {
  return decide(
    prep(cat.name, cat.brand, cat.ean),
    { unit: cat.unit, unitSize: cat.unitSize },
    prep(store.name, store.brand, store.ean),
    { unit: store.unit, unitSize: store.unitSize },
    section,
  );
}

// A store pool product with its parse results cached.
type Prepared = { sp: StoreProduct; item: PrepItem; size: { unit: string; unitSize: number } | null; storeKey: string };

export type IngestResult = {
  offers: number;
  created: number;
  flagged: number;
  /** REVIEW-band candidates queued for /admin/matches. Never counted as coverage. */
  pending?: number;
  aborted?: boolean;
  reason?: string;
};

/**
 * Match `pool` onto the catalog for one merchant.
 * @param opts.section  which catalog section to match within / create into (default "grocery")
 * @param opts.addNew   create a new catalog product for pool items that match nothing
 */
/**
 * Which price source to write: the OFFER's own value when it already states one, otherwise a
 * translation of the MERCHANT's channel.
 *
 * This exists because `toPriceSource(sp.priceSource ?? merchant.priceChannel)` silently
 * corrupted every adapter that sets the offer value explicitly. `toPriceSource` translates the
 * MERCHANT vocabulary ("shelf" | "delivery" | "aggregator"); handed an OFFER value like
 * "DELIVERY_PLATFORM" it matches no case and returns SHELF from its default branch. Every one of
 * the 2,217 Glovo offers was therefore written as a SHELF price — the one thing CLAUDE.md's
 * ninth invariant forbids, since a marked-up platform price would then compete in "cel mai mic
 * preț" against real shelf prices.
 *
 * It is the same class of mistake `lib/price-source` was created to end: a value copied across a
 * vocabulary boundary because the two vocabularies share a field name. The fix is to stop
 * translating something that is already in the target vocabulary.
 */
function resolvePriceSource(offerValue: string | null | undefined, merchantChannel: string | null | undefined): PriceSource {
  if (isPriceSource(offerValue)) return offerValue;
  return toPriceSource(merchantChannel);
}

export async function matchPoolToCatalog(
  merchantId: number,
  pool: StoreProduct[],
  opts: { section?: string; addNew?: boolean; label?: string } = {},
): Promise<IngestResult> {
  const section = opts.section ?? "grocery";
  const addNew = opts.addNew ?? false;
  const startedAt = new Date();

  // A snapshot before anything writes. Short-circuits if one is under an hour old, so twelve
  // scrapers in one session produce one snapshot, not twelve.
  ensureBackup(`${opts.label ?? "merchant " + merchantId} scrape`);

  // Check provenance BEFORE any database work: a mangled pool must not write at all.
  const completeness = assertPoolContract(pool, opts.label ?? `merchant ${merchantId}`);
  console.log(
    `  pool contract: ${completeness.total} products · rawPriceText ${completeness.rawPriceTextPct}%` +
    ` · productUrl ${completeness.productUrlPct}%` +
    ` · ean ${completeness.withEan}` +
    ` · image ${completeness.withImage}` +
    ` · sourceBlob ${completeness.sourceBlobPct}%${completeness.sourceBlobPct === 0 ? " ⚠ no independent check possible" : ""}` +
    ` · merchantCategory ${completeness.categoryPathPct}%`,
  );

  // ── EXCLUDED CATEGORIES, refused HERE so they can never enter the catalog.
  //
  // Tobacco and nicotine. Legea 349/2002 prohibits advertising and promotion of tobacco
  // products and Legea 201/2016 extends the regime to electronic cigarettes and refills; a
  // public price-comparison page is not an obvious fit for the narrow exceptions, and a
  // grocery basket optimiser has no reason to carry it at all.
  //
  // The exclusion happens BEFORE matching, not at display time, because a row that exists in
  // the database is a worse place to discover a legal question from than a row that was never
  // written. It also puts it out of reach of `addNew`, which would otherwise CREATE the
  // catalog entry — Mega Image's pool alone carries 126 tobacco head nouns.
  const kept: StoreProduct[] = [];
  const excludedByReason = new Map<string, number>();
  const excludedSamples: string[] = [];
  for (const sp of pool) {
    const reason = exclusionReason(sp.name, sp.brand);
    if (reason === null) { kept.push(sp); continue; }
    excludedByReason.set(reason, (excludedByReason.get(reason) ?? 0) + 1);
    if (excludedSamples.length < 8) excludedSamples.push(sp.name.slice(0, 60));
  }
  if (excludedByReason.size > 0) {
    console.log(
      `  excluded ${pool.length - kept.length} product(s) we do not carry: ` +
      `${[...excludedByReason.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`,
    );
    for (const x of excludedSamples) console.log(`      ${x}`);
  }
  pool = kept;

  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId }, select: { slug: true, lastOfferCount: true, priceChannel: true } });
  const merchantSlugForDeposit = merchant?.slug ?? "";
  const rows = await prisma.product.findMany({ where: { section }, select: { id: true, name: true, brand: true, ean: true, unit: true, unitSize: true, image: true } });
  const catMap = new Map((await prisma.category.findMany({ select: { slug: true, id: true } })).map((c) => [c.slug, c.id]));
  const overrides = new Map((await prisma.matchOverride.findMany({ where: { merchantId }, select: { storeKey: true, productId: true, decision: true } })).map((o) => [o.storeKey, o]));
  const eanToProduct = new Map<string, number>();
  for (const r of rows) { const e = parseEan(r.ean); if (e) eanToProduct.set(e, r.id); }

  // Existing prices for the sanity gate: this merchant's own last price per product,
  // and the cross-store median (other merchants) per product.
  const existingOffers = await prisma.offer.findMany({ where: { product: { section } }, select: { productId: true, merchantId: true, price: true } });
  const prevPrice = new Map<number, number>();
  const othersByProduct = new Map<number, number[]>();
  for (const o of existingOffers) {
    if (o.merchantId === merchantId) prevPrice.set(o.productId, o.price);
    else { const a = othersByProduct.get(o.productId) ?? []; a.push(o.price); othersByProduct.set(o.productId, a); }
  }
  const median = (arr: number[]): number => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // Prepare + index the store pool by each significant name token.
  const prepared: Prepared[] = [];
  const storeByToken = new Map<string, Prepared[]>();
  // A POOL ITEM WITH NO USABLE PRICE IS A REFUSAL, NOT A NON-EVENT.
  //
  // This line used to be a bare `continue`: silent, uncounted, and unrecoverable. An item
  // whose price could not be read simply did not exist, which is indistinguishable from the
  // store not selling it. Now it is recorded like any other refusal — with no offerId,
  // because it never got that far, which is exactly why it needed recording.
  const preOfferRefusals: { storeName: string; rawPriceText: string | null; reason: string }[] = [];
  for (const sp of pool) {
    if (!(sp.price > 0) || !sp.name) {
      if (sp.name) {
        preOfferRefusals.push({
          storeName: sp.name,
          rawPriceText: sp.rawPriceText ?? null,
          reason: `no usable price in the pool (price=${sp.price})`,
        });
      }
      continue;
    }
    const item = prep(sp.name, sp.brand, sp.ean);
    const pr: Prepared = { sp, item, size: parseSize(sp.name), storeKey: slugify(sp.name) || sp.url };
    prepared.push(pr);
    for (const t of item.tokens) {
      let b = storeByToken.get(t);
      if (!b) { b = []; storeByToken.set(t, b); }
      b.push(pr);
    }
  }
  // Flush the pre-offer refusals. Capped: a wholly broken run would otherwise write one row
  // per product, and the run-level tripwires already say "this run is broken" far louder.
  for (const r of preOfferRefusals.slice(0, MAX_PRE_OFFER_REFUSALS)) {
    await recordRefusal({
      offerId: null, merchantId, storeName: r.storeName,
      rejectedPriceBani: 0, acceptedPriceBani: null,
      rawPriceText: r.rawPriceText, reason: r.reason,
    });
  }
  if (preOfferRefusals.length > 0) {
    console.log(
      `  ${preOfferRefusals.length} pool item(s) had no usable price` +
      `${preOfferRefusals.length > MAX_PRE_OFFER_REFUSALS ? ` (first ${MAX_PRE_OFFER_REFUSALS} recorded)` : " (recorded)"}`,
    );
  }

  // FABRICATION GUARD (pool level, BEFORE matching): distinct store products sharing one
  // identical (price, url) pair means the scraper paired names with a neighbour's data
  // rather than reading each card. That is how DCNeu shipped 347 groups of invented
  // prices, one with 73 products at 7.96 lei. Note this is deliberately measured on the
  // POOL: duplicates AFTER matching are matcher fan-out, a different bug with its own fix.
  {
    // Only meaningful where the source HAS per-product links. A flyer (Kaufland) genuinely
    // has none, so every offer shares the page URL and same-priced products would look like
    // fabrication — the guard must not fire on a source it cannot judge.
    const linked = prepared.filter((p) => p.sp.productUrl);
    const byPair = new Map<string, Set<string>>();
    for (const p of linked) {
      const key = `${p.sp.price}|${p.sp.productUrl}`;
      const set = byPair.get(key) ?? new Set<string>();
      set.add(p.sp.name);
      byPair.set(key, set);
    }
    let duplicated = 0;
    let worst = 0;
    for (const names of byPair.values()) if (names.size > 1) { duplicated += names.size; worst = Math.max(worst, names.size); }
    const share = linked.length ? duplicated / linked.length : 0;
    if (linked.length >= 50 && share > 0.02) {
      const reason = `fabrication guard: ${(share * 100).toFixed(1)}% of scraped products share an identical (price,url) with a DIFFERENT product (largest group ${worst}) — the scraper is not reading per-card prices`;
      console.error(`[matchPool] ⚠ ${reason}`);
      await recordScraperRun({ merchantId, startedAt, previousRunCount: merchant?.lastOfferCount ?? 0, aborted: true, abortReason: reason });
      return { offers: 0, created: 0, flagged: 0, aborted: true, reason };
    }
  }

  const chosen = new Map<number, { unitSize: number; ownSize: { unit: string; unitSize: number } | null; price: number; available: boolean; url: string; image: string | null; fillImage: boolean; category?: string; score: number; reason: string; source: string; sp: StoreProduct }>();
  const consider = (productId: number, unitSize: number, catImage: string | null, c: Prepared, score: number, reason: string) => {
    const prev = chosen.get(productId);
    const better = !prev || (c.sp.available && !prev.available) || (c.sp.available === prev.available && c.sp.price < prev.price);
    // ownSize is the size parsed from THIS offer's own name. It is what the unit price must be
    // computed from; the catalog product's size is a different product's size.
    if (better) chosen.set(productId, { unitSize, ownSize: c.size, price: c.sp.price, available: c.sp.available, url: c.sp.url, image: c.sp.image, fillImage: !catImage, category: c.sp.category, score, reason, source: resolvePriceSource(c.sp.priceSource, merchant?.priceChannel), sp: c.sp });
  };
  // PRODUCTS THIS MERCHANT IS FORBIDDEN FROM, keyed on the PRODUCT and not on the store name.
  //
  // This used to be keyed `${storeKey}:${productId}`, and storeKey is `slugify(storeName)` — a
  // field that changes between scrapes. Freshful's "Mici din carne de porc și vită 500g" came
  // back as "Mici din carne de vită și oaie 500g"; three of five reject keys stopped matching
  // and the rejects silently stopped applying. Consulted and MISSED, not overruled.
  //
  // A reject is a human saying this shop's item does not belong on this product. Reading it per
  // product is broader than the old key and errs the right way: a false miss costs a comparison,
  // a false match publishes one product's price on another. A CONFIRM on a specific store item
  // still wins in PHASE 0, so a merchant that genuinely starts stocking it can be paired.
  const rejectedProducts = await rejectedPairs(merchantId);
  const rejects = { has: (pid: number): boolean => rejectedProducts.has(pid) };
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const catUnitById = new Map(rows.map((r) => [r.id, r.unit]));

  const explained = new Set<Prepared>();

  // REVIEW-band candidates. These used to be discarded by `if (!d.ok) continue` — the middle
  // band existed in the type system and nowhere else, so every mid-confidence match was thrown
  // away on every run, unrecorded and uncounted. They are collected here and persisted as
  // PendingMatch: never shown, never counted, never in the optimizer, but reviewable.
  const review = new Map<string, { productId: number; c: Prepared; score: number; reason: string }>();
  const noteReview = (productId: number, c: Prepared, d: Decision): void => {
    if (d.band !== "REVIEW") return;
    if (rejects.has(productId)) return;
    const key = `${c.storeKey}:${productId}`;
    const prev = review.get(key);
    if (!prev || d.score > prev.score) review.set(key, { productId, c, score: d.score, reason: d.reason });
  };

  // PHASE 0 — human overrides + EAN joins take priority over any heuristic.
  for (const c of prepared) {
    const ov = overrides.get(c.storeKey);
    if (ov && ov.decision === "confirm") {
      const r = rowById.get(ov.productId);
      if (r) { explained.add(c); consider(r.id, r.unitSize, r.image, c, 1, "override"); continue; }
    }
    if (c.item.ean) {
      const pid = eanToProduct.get(c.item.ean);
      if (pid != null && !rejects.has(pid)) {
        const r = rowById.get(pid);
        if (r) { explained.add(c); consider(pid, r.unitSize, r.image, c, 1, "ean"); }
      }
    }
  }

  // PHASE 1 — catalog coverage: each catalog product takes the cheapest store product that
  // shares its head-noun and clears decide() (size ±6% + brand + section-aware overlap).
  // POOL CENSUS. Where every pool item ends up, counted rather than inferred.
  //
  // Mega Image pools 7,160 products and writes 724 offers, and until now NOTHING said where
  // the other 6,436 went. The three possible answers are completely different problems: the
  // matcher rejected them, the matcher was unsure and queued them, or the matcher never saw
  // them at all — and only the last is a pipeline bug. Guessing between those cost a session.
  const consideredPool = new Set<Prepared>();
  const coverage = new DecisionCoverage();
  for (const cp of rows) {
    const cItem = prep(cp.name, cp.brand, cp.ean);
    const chead = headNoun(cItem.nname);
    if (!chead) continue;
    const cands = storeByToken.get(chead);
    if (!cands) continue;
    const cSize = { unit: cp.unit, unitSize: cp.unitSize };
    for (const c of cands) {
      if (rejects.has(cp.id)) continue;
      consideredPool.add(c);
      const d = decide(cItem, cSize, c.item, c.size, section);
      coverage.record(d);
      if (!d.ok) { noteReview(cp.id, c, d); continue; }
      explained.add(c);
      consider(cp.id, cp.unitSize, cp.image, c, d.score, d.reason);
    }
  }

  // PHASE 2 — addNew: store products that match no catalog product become new products.
  const existingIds = new Set(rows.map((r) => r.id));
  const createdIds = new Set<number>();
  if (addNew) {
    for (const c of prepared) {
      if (explained.has(c)) continue;
      const unit = c.size?.unit ?? "buc";
      const unitSize = c.size?.unitSize ?? 1;
      const base = slugify(c.sp.name) || "produs";
      const slug = `${base}-${section[0]}${Math.round(unitSize * 1000)}${unit}`;
      const categoryId = c.sp.category ? catMap.get(c.sp.category) ?? null : null;
      const ean = c.item.ean || null;
      const nameNorm = `${c.item.nname} ${c.item.nbrand}`.trim();
      const prod = await prisma.product
        .upsert({ where: { slug }, update: { categoryId: categoryId ?? undefined, nameNorm, ean: ean ?? undefined }, create: { slug, name: c.sp.name, nameNorm, brand: c.sp.brand || null, ean, section, unit, unitSize, image: c.sp.image, categoryId } })
        .catch(() => null);
      if (!prod) continue;
      if (!existingIds.has(prod.id)) createdIds.add(prod.id);
      consider(prod.id, unitSize, prod.image, c, 0.5, "new");
    }
  }

  // ── Report the census. A match-only merchant (addNew false) DISCARDS everything it does
  //    not match, and that is a deliberate design — Auchan is the catalog master and the
  //    others attach prices to products it already carries. Deliberate is not the same as
  //    measured: nothing had ever printed how much a match-only run throws away.
  {
    const reviewKeys = new Set([...review.values()].map((r) => r.c.storeKey));
    const matched = prepared.filter((c) => explained.has(c)).length;
    const seen = prepared.filter((c) => consideredPool.has(c)).length;
    const inReview = prepared.filter((c) => !explained.has(c) && reviewKeys.has(c.storeKey)).length;
    const rejected = seen - matched - inReview;
    const neverSeen = prepared.length - seen;
    const pct = (n: number): string => (prepared.length ? ((n / prepared.length) * 100).toFixed(1) : "0.0") + "%";
    console.log(
      `  pool census: ${prepared.length} items · matched ${matched} (${pct(matched)}) · ` +
      `review ${inReview} (${pct(inReview)}) · rejected ${rejected} (${pct(rejected)}) · ` +
      `never considered ${neverSeen} (${pct(neverSeen)})` +
      `${addNew ? "" : " · addNew OFF, so everything unmatched is discarded"}`,
    );
    if (!addNew && neverSeen > prepared.length * 0.5) {
      console.log(
        `  ⚠ over half this pool shares no head-noun with ANY catalog product. That is a` +
        ` catalog coverage gap, not a matcher decision.`,
      );
    }
    // POOL_DUMP=1 writes the pool with each item's outcome, so the REJECTED population can
    // be sampled offline. Rejections are not persisted anywhere — only the REVIEW band is —
    // so without this the largest bucket in the census is the one nobody can look at.
    coverage.report(opts.label ?? section);
    if (process.env.POOL_DUMP) {
      const dir = join(process.cwd(), "tmp-pools");
      mkdirSync(dir, { recursive: true });
      const dump = prepared.map((c) => ({
        name: c.sp.name,
        brand: c.sp.brand ?? null,
        price: c.sp.price,
        unit: c.size?.unit ?? null,
        unitSize: c.size?.unitSize ?? null,
        outcome: explained.has(c) ? "matched" : reviewKeys.has(c.storeKey) ? "review"
          : consideredPool.has(c) ? "rejected" : "never-considered",
      }));
      const file = join(dir, `${opts.label ?? section}-pool.json`);
      writeFileSync(file, JSON.stringify(dump), "utf8");
      console.log(`  [POOL_DUMP] wrote ${dump.length} items to ${file}`);
    }
  }

  // DROP-GUARD — refuse a run that collapsed (site redesign / anti-bot block) rather than
  // marking everything out-of-stock and wiping good data.
  //
  // The baseline is COUNTED from the offers this run is about to overwrite, not read from
  // `Merchant.lastOfferCount`. That stored counter is per-merchant, and more than one scraper
  // writes to the same merchant: `scrape-carrefour` (grocery) and `scrape-carrefour-alcohol`
  // both target `carrefour`, and `scrape-farmaciatei` loops over several sections. Each run
  // overwrote the counter with its own total, so by the next night the guard was comparing a
  // grocery run against an alcohol run's count — nowhere near the right number, and in
  // Carrefour's case low enough that the guard could not have fired at all.
  //
  // Counting the live offers for THIS merchant and THIS section cannot be clobbered by
  // another scraper, and is the number the guard actually means.
  // AN EXPIRED PROMOTION IS NOT PART OF THE BASELINE.
  //
  // Kaufland aborted twice on `296 offers < 60% of last 594 live`, and the scrape was
  // perfectly healthy — 264 of 265 prices parsed. The 594 was the problem: all observed on
  // one day, and 303 of them carried a promo window that had ALREADY PASSED. Flyer offers
  // accumulate across weeks unless something expires them, so the guard was comparing one
  // week's catalogue against three weeks of dead ones and refusing a good run.
  //
  // Excluding them is not weakening the guard — the guard is right that a collapse means
  // something broke. It is fixing the number the guard reads: 594 - 303 = 291 genuinely
  // current offers, against which 296 is a healthy run rather than a 50% collapse.
  const baseline = await prisma.offer.count({
    where: {
      merchantId,
      product: { section },
      isStale: false,
      OR: [{ promoValidTo: null }, { promoValidTo: { gte: new Date() } }],
    },
  });
  if (baseline > 0 && chosen.size < baseline * 0.6) {
    const reason = `run refused: ${chosen.size} offers < 60% of last ${baseline} live in section "${section}"`;
    console.error(`[matchPool] ⚠ ${reason} — keeping previous data.`);
    await recordScraperRun({ merchantId, startedAt, previousRunCount: baseline, aborted: true, abortReason: reason });
      return { offers: 0, created: 0, flagged: 0, aborted: true, reason };
  }

  // Mark this merchant/section's offers stale first; ones seen this run are re-activated below.
  await prisma.offer.updateMany({ where: { merchantId, product: { section } }, data: { availability: "out of stock", isStale: true } });
  let flaggedCount = 0;
  for (const [productId, o] of chosen) {
    // Backfill image / sub-category / normalized name for any product that got an offer.
    const catId = o.category ? catMap.get(o.category) : undefined;
    const patch: { image?: string; categoryId?: number } = {};
    if (o.fillImage && o.image) patch.image = o.image;
    if (catId != null) patch.categoryId = catId;
    if (patch.image !== undefined || patch.categoryId !== undefined) await prisma.product.update({ where: { id: productId }, data: patch }).catch(() => {});

    // Sanity gate: implausible vs the offer's own last price or the cross-store median.
    const prev = prevPrice.get(productId);
    const others = othersByProduct.get(productId) ?? [];
    const med = median(others);
    const jump = prev && prev > 0 && (o.price > prev * 4 || o.price < prev * 0.25);
    const outlier = med > 0 && others.length >= 2 && (o.price > med * 6 || o.price < med / 6);
    const lowConf = o.score < 0.35;

    // Does this offer's OWN size agree with the catalog product it was matched to?
    //
    // When it does not, the match is wrong — that is what a size disagreement MEANS. The old
    // code computed the unit price from the catalog size, which made a mismatched offer look
    // plausible instead of absurd and hid the disagreement completely. Now the disagreement is
    // the flag, and a flagged offer is withheld from display rather than shown with a
    // believable-looking number.
    const ownSize = o.ownSize;
    // `rows` is the catalog snapshot taken BEFORE this run created anything, so a product
    // created during this run has no entry here and `catUnit` is undefined.
    //
    // SILENCE IS NOT DISAGREEMENT — the same rule the matcher already applies to dosage.
    // `ownSize.unit !== undefined` is true for every unit there is, so comparing against a
    // missing value flagged every newly-created product as a size conflict: 71 of the 74
    // flags on Auchan's first gated run said "offer is 0.5 kg, catalog product is 0.5
    // undefined" — the numbers agreeing and the unit simply absent. A gate that fires on
    // missing data instead of on a contradiction teaches everyone to ignore it.
    const catUnit = catUnitById.get(productId);
    const unitContradicts = catUnit != null && ownSize != null && ownSize.unit !== catUnit;
    const sizeDisagrees =
      ownSize != null && o.unitSize > 0 &&
      (unitContradicts ||
       Math.abs(ownSize.unitSize - o.unitSize) > o.unitSize * SIZE_TOLERANCE + 1e-9);

    // ── THE HISTORY GATE FLAGS. IT DOES NOT SUBSTITUTE. ──────────────────────────────────
    //
    // `writePrice = prev` used to sit here: on a large move we kept the STORED price and
    // discarded the fresh observation. That is backwards, and four cases examined by hand
    // proved it — Auchan 12,00 (independently re-scraped at 11,69), Kaufland 6,89 (the
    // merchant's own JSON says 6,89), a Mega Image 5+1 six-pack holding 5,29 against a real
    // 23,95, and the whole 30 August correction wave.
    //
    // The reason generalizes. A gate anchored on stored history assumes history is more
    // trustworthy than the new observation, and that assumption is exactly inverted while
    // parsers are being corrected — which has been every day of this project. History
    // anchoring defends stale data against fresh data. 135 stored prices in this catalog were
    // kept over a refused one; 106 of them are DCNeu rows from the fabricated-price era
    // holding values four to six times too low, defended against their own correction.
    //
    // It is not uniformly wrong — Glenfiddich 21 kept 899,99 over a mis-parsed 152,42, and
    // there the gate was right. It simply cannot tell a correction from a parse error, so it
    // must not be the thing that decides. It flags; a flagged offer is withheld from display
    // and queued for review; and what decides is an oracle where one exists (a merchant's own
    // published per-unit price) or unit-price plausibility where one does not.
    const writePrice = o.price;
    let flagged = false;
    let flagReason: string | null = null;
    if (jump || outlier) {
      flagged = true;
      flagReason = jump ? `price moved ${prev}→${o.price}` : `outlier vs cross-store median ${med.toFixed(2)}`;
    } else if (sizeDisagrees && ownSize) {
      flagged = true;
      flagReason =
        `size disagreement: offer is ${ownSize.unitSize} ${ownSize.unit}, ` +
        `catalog product is ${o.unitSize} ${catUnit ?? "(unit unknown)"} — the match is wrong`;
    } else if (lowConf) {
      flagged = true;
      flagReason = `low match confidence ${o.score.toFixed(2)} (${o.reason})`;
    }
    if (flagged) flaggedCount++;

    // Provenance travels with every write: the raw string that produced this price, the
    // deep link (null when the source has none), and any advertised reference price.
    // PROVENANCE MUST DESCRIBE THE PRICE WE ACTUALLY WROTE.
    //
    // When a gate refuses a price we keep the previously trusted one — and this block used to
    // overwrite `rawPriceText` with the REFUSED string anyway. The row then claimed a source
    // it did not come from, and the one column that exists so a price can be checked against
    // its source was corrupted for precisely the rows most in need of checking.
    //
    // Measured before the fix: 129 offers in the catalog did not reproduce from their own
    // rawPriceText, and ALL 129 were flagged — 129 of the 130 flagged offers in the database.
    // Not an edge case: a defect on the shared write path that hit every refusal.
    //
    // On a refusal the price-describing fields are simply omitted from the update, so Prisma
    // leaves the previous values in place. Nothing is lost: the refused string, the refused
    // value and the kept value all go to PriceAnomaly. The item-describing fields (name, own
    // size, deep link) and `lastObservedAt` still update — we DID see the product, we just
    // did not believe its price.
    // Always false now that the gate never substitutes. Kept as an explicit guard so that
    // if any future gate DOES substitute, it cannot silently corrupt provenance again.
    // The deposit is computed from the offer's OWN size and pack shape, never the catalog
    // product's — the same rule as the unit price, for the same reason: a 6-pack matched onto
    // a 2 l entry would otherwise inherit the wrong container count.
    const ownPack = parseQuantity(o.sp.name)?.packCount ?? 1;
    const sgr = depositFor({
      unit: ownSize?.unit ?? null,
      unitSize: ownSize?.unitSize ?? null,
      packCount: ownPack,
      categorySlug: o.sp.category ?? null,
      publishedPerContainerBani: readPublishedDepositBani(merchantSlugForDeposit, o.sp.rawSourceBlob ?? null),
    });

    const priceWasRefused = Math.abs(writePrice - o.price) > 1e-9;
    const provenance = {
      // The offer's OWN identity, so the unit price can be re-derived and checked without a
      // re-scrape. Its absence is why the catalog-size bug was unverifiable from stored data.
      storeName: o.sp.name,
      ownUnit: ownSize?.unit ?? null,
      ownUnitSize: ownSize?.unitSize ?? null,
      productUrl: o.sp.productUrl ?? null,
      promoValidFrom: o.sp.promoValidFrom ?? null,
      promoValidTo: o.sp.promoValidTo ?? null,
      lastObservedAt: new Date(),
      isStale: false,
      // SGR container deposit. Read from the merchant's own published figure where it has one
      // (Auchan prints GARANTIE_SGR), derived from pack shape and category otherwise, and
      // NULL when the product is not in the scheme — "no deposit" and "a deposit of zero" are
      // different claims and only one of them is supportable.
      depositBani: sgr?.perContainerBani ?? null,
      containerCount: sgr?.containerCount ?? null,
      isExpired: o.sp.promoValidTo ? o.sp.promoValidTo.getTime() < Date.now() : false,
      // THE MERCHANT'S OWN CATEGORY, into the column that already exists for it.
      //
      // `Offer.categoryPath` was added for DCNeu's breadcrumbs and is what assign-categories
      // already reads. Adding a second column for the same fact is how a field ends up with
      // two spellings and no answer about which one is right — the same mistake as two size
      // parsers disagreeing on 1.78% of the catalog.
      //
      // Written on every run INCLUDING when the price was refused: a refused price means we do
      // not believe the NUMBER, which says nothing about the aisle. But only written when the
      // scraper actually supplied one — a null here must not erase a path recovered earlier.
      ...(o.sp.categoryPath ? { categoryPath: o.sp.categoryPath } : {}),
      // Only when the price we are writing is the price we just read.
      ...(priceWasRefused
        ? {}
        : {
            rawPriceText: o.sp.rawPriceText ?? null,
            rawSourceBlob: o.sp.rawSourceBlob ? o.sp.rawSourceBlob.slice(0, 4096) : null,
            referencePriceBani: o.sp.referencePriceBani ?? null,
            referencePriceKind: o.sp.referencePriceKind ?? null,
          }),
    };
    // BANI IS THE VALUE WE WRITE; the float is derived from it, never the reverse.
    //
    // This write path serves 11 of the 12 merchants and, until now, did not set priceBani AT
    // ALL. Only scrape-auchan did — which is exactly why Auchan was the one merchant with zero
    // nulls and zero disagreements while everything else drifted. New offers got a null
    // priceBani (553 of them); updated offers kept whatever the migration had written while
    // their float moved on (614 rows holding a COMPLETELY different value, not a rounding
    // difference). Nothing caught it because every user-facing read still used the float, so
    // the integer column was validated by nothing at all.
    const priceBani = leiToBaniExact(writePrice);
    const writeFloat = baniToLei(priceBani);
    // ── UNIT PRICE COMES FROM THE OFFER'S OWN SIZE. ALWAYS.
    //
    // This used to divide by the CATALOG product's unitSize, which is the single most damaging
    // bug this codebase has had, because it CONCEALS every matching error instead of exposing
    // one. A 2 L Pepsi Cola wrongly matched to a "6 x 0.33 l zmeura" catalog entry was shown at
    // 10.49 / 1.98 = 5.30 lei/L — a completely plausible number. Divided by its OWN 2 L it is
    // 5.25, and the two sizes disagreeing is the signal that the match is wrong. Using the
    // catalog size threw that signal away and printed a believable price on a wrong product.
    //
    // If the offer's own size cannot be parsed there is no honest unit price, so none is stored.
    // A fallback to the catalog size would reintroduce exactly this bug.
    const ppu = ownSize && ownSize.unitSize > 0 ? writeFloat / ownSize.unitSize : 0;
    // Null rather than a crash or a lie: a mis-parsed pack size ("3 mg/ml" read as the pack)
    // can push this past what an INT column holds, and the column is nullable for exactly
    // that reason. See perUnitBaniOrNull.
    const ppuBani = ownSize && ownSize.unitSize > 0 ? perUnitBaniOrNull(writeFloat, ownSize.unitSize) : null;
    const avail = o.available ? "in stock" : "out of stock";
    const offer = await prisma.offer.upsert({
      where: { productId_merchantId: { productId, merchantId } },
      update: { price: writeFloat, priceBani, pricePerUnit: ppu, pricePerUnitBani: ppuBani, availability: avail, url: o.url, matchedBy: o.reason, matchScore: o.score, priceSource: o.source, flagged, flagReason, ...provenance },
      create: { productId, merchantId, price: writeFloat, priceBani, pricePerUnit: ppu, pricePerUnitBani: ppuBani, availability: avail, url: o.url, currency: "RON", matchedBy: o.reason, matchScore: o.score, priceSource: o.source, flagged, flagReason, ...provenance },
    });
    // append a history point only when the price actually changed (20–50× fewer rows)
    if (prev === undefined || Math.abs(prev - writePrice) > 1e-9) {
      await prisma.priceHistory.create({ data: { offerId: offer.id, price: writeFloat, priceBani, referencePriceBani: o.sp.referencePriceBani ?? null } });
    }
    // THE REJECTED PRICE IS THE EVIDENCE, so it is recorded rather than discarded.
    //
    // CLAUDE.md has always said a price failing the sanity gate "is flagged into a
    // PriceAnomaly table for review". Only `scrape-dcneu` ever wrote one, so the rule held
    // for one merchant out of twelve; on this path the rejected number was replaced by the
    // previous price in memory and then lost. That is what made the Auchan 28,14 -> 12,00
    // question take a scrape to answer: nothing had kept what was refused, or why.
    if (jump || outlier) {
      // rejectedPriceBani is 0 because NOTHING WAS REFUSED any more — the fresh value is what
      // we wrote. The record exists so a human can review a large move, and the previous
      // value is carried in the reason. `audit:kept-over-refused` keys on a non-zero rejected
      // value, so it correctly reports nothing new from here on.
      await recordRefusal({
        offerId: offer.id,
        merchantId,
        storeName: o.sp.name,
        rejectedPriceBani: 0,
        acceptedPriceBani: priceBani,
        rawPriceText: o.sp.rawPriceText ?? null,
        reason: `${flagReason ?? "large move"} — written and flagged for review, not refused`,
      });
    }
  }

  // RE-ASSERT WHAT MUST SURVIVE THE REWRITE, before anything reports success.
  //
  // The gates above judge today's data and are meant to be recomputed. Standing decisions — a
  // human's REJECT, an unresolved PriceAnomaly — are not about today's data and were being
  // cleared by the same write. Two quarantined DCNeu rows fabricated by the pre-fix scraper
  // went back on the site that way.
  const reasserted = await reassertStandingDecisions(merchantId);
  if (reasserted.rejected || reasserted.quarantined || reasserted.tiersCleared) {
    console.log(
      `  standing decisions re-applied: ${reasserted.rejected} rejected pairing(s), ` +
      `${reasserted.quarantined} with an unresolved anomaly — withheld again; ` +
      `${reasserted.tiersCleared} stale bulk tier(s) cleared.`,
    );
  }

  await prisma.merchant.update({ where: { id: merchantId }, data: { lastOfferCount: chosen.size, lastScrapeAt: new Date() } }).catch(() => {});
  // Persist the run so /admin/health can distinguish "found fewer products" from
  // "could not READ the products" the next morning.
  // Where THIS merchant's offers ended up, recorded with the run. Reconstructing that from a
  // backup weeks later is what a 32k-to-24k scare cost a whole night to answer once; recorded
  // per run, the same question is a lookup.
  const censusJson = await censusForMerchant(merchantId).catch(() => null);
  await recordScraperRun({
    merchantId, startedAt,
    tally: { label: "", attempted: pool.length, parsed: prepared.length, nulls: pool.length - prepared.length, nullRate: pool.length ? (pool.length - prepared.length) / pool.length : 0, samples: [], exceedsThreshold: false, unavailable: 0, unavailableRate: 0, unavailableExceedsThreshold: false },
    offersRejected: flaggedCount,
    offersWritten: chosen.size,
    previousRunCount: merchant?.lastOfferCount ?? 0,
    censusJson,
  });
  // Persist the REVIEW band. A candidate that has since been AUTO-matched or explicitly
  // rejected is not pending any more, so those are skipped rather than re-queued.
  let pending = 0;
  for (const { productId, c, score, reason } of review.values()) {
    if (chosen.get(productId)?.sp === c.sp) continue; // it won outright; nothing to review
    try {
      await prisma.pendingMatch.upsert({
        where: { merchantId_storeKey_productId: { merchantId, storeKey: c.storeKey, productId } },
        update: { lastSeenAt: new Date(), score, reason, storePriceBani: leiToBaniExact(c.sp.price) },
        create: {
          merchantId, productId, storeKey: c.storeKey, section,
          storeName: c.sp.name, storeBrand: c.sp.brand || null,
          storePriceBani: leiToBaniExact(c.sp.price),
          storeUrl: c.sp.productUrl ?? c.sp.url ?? null,
          storeImage: c.sp.image ?? null,
          score, reason,
        },
      });
      pending++;
    } catch { /* a pending row is a convenience, never a reason to fail a run */ }
  }
  if (pending > 0) console.log(`  ${pending} REVIEW-band candidate(s) queued for /admin/matches`);

  return { offers: chosen.size, created: createdIds.size, flagged: flaggedCount, pending };
}
