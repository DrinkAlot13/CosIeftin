// Shared scraper helpers: match a store's scraped product pool onto the catalog
// (per section: "grocery", "alcohol", …), upsert that store's offers, and — when
// addNew is set — CREATE catalog products for pool items that match nothing yet.
//
// Data-quality invariants baked in here (see CLAUDE.md):
//   • EAN is a JOIN, not a guess — an exact GTIN match always wins.
//   • Human MatchOverride decisions survive a rebuild and beat the heuristic.
//   • Every match carries a confidence score + reason; low ones are flagged for review.
//   • Prices pass a sanity gate (vs the offer's own history + the cross-store median);
//     an implausible value is flagged and the old price is kept rather than written.
//   • A run that collapses to <60% of the store's last offer count is REFUSED (site
//     redesign / block) instead of wiping good data.
//   • Price history is append-on-change only.
import { prisma } from "./db";
import { parseSize } from "./ingest-core";
import { normalizeText } from "./matching";
import { parseEan } from "./product/ean";
import { perUnitBaniOrNull } from "./price/parsePrice";
import { recordScraperRun } from "./scraper-run";

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
  total: number;
  withRawPriceText: number;
  withProductUrl: number;
  withEan: number;
  withImage: number;
  rawPriceTextPct: number;
  productUrlPct: number;
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
  const pct = (n: number): number => (total === 0 ? 0 : Math.round((n / total) * 1000) / 10);
  return {
    total, withRawPriceText, withProductUrl, withEan, withImage,
    rawPriceTextPct: pct(withRawPriceText), productUrlPct: pct(withProductUrl),
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
  for (const m of nname.matchAll(/m[aă]rim[ea]*s*:?s*(xs|s|m|l|xl|xxl)/gi)) {
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

type PrepItem = { nname: string; raw: string; nbrand: string; tokens: Set<string>; over: Set<string>; ean: string };
function prep(name: string, brand: string | null | undefined, ean: string | null | undefined): PrepItem {
  const nname = normalizeText(name);
  // keep the raw name too: normalizeText strips % and unit letters, which is exactly
  // where dosage lives ("1,5% grasime", "500 mg")
  return { nname, raw: String(name).toLowerCase(), nbrand: normalizeText(brand ?? ""), tokens: new Set(sigTokens(nname)), over: new Set(overlapTokens(nname)), ean: parseEan(ean) };
}

/** Core rule: does store item `st` correspond to catalog item `cat` in this section? */
function decide(cat: PrepItem, catSize: { unit: string; unitSize: number }, st: PrepItem, stSize: { unit: string; unitSize: number } | null, section: string): Decision {
  if (cat.ean && st.ean && cat.ean === st.ean) return { ok: true, band: "AUTO_MATCH", score: 1, reason: "ean" };
  if (!stSize || stSize.unit !== catSize.unit) return { ok: false, band: "REJECT", score: 0, reason: "size-unit" };
  if (Math.abs(stSize.unitSize - catSize.unitSize) > catSize.unitSize * 0.06 + 1e-9) return { ok: false, band: "REJECT", score: 0, reason: "size" };
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

export type IngestResult = { offers: number; created: number; flagged: number; aborted?: boolean; reason?: string };

/**
 * Match `pool` onto the catalog for one merchant.
 * @param opts.section  which catalog section to match within / create into (default "grocery")
 * @param opts.addNew   create a new catalog product for pool items that match nothing
 */
export async function matchPoolToCatalog(
  merchantId: number,
  pool: StoreProduct[],
  opts: { section?: string; addNew?: boolean; label?: string } = {},
): Promise<IngestResult> {
  const section = opts.section ?? "grocery";
  const addNew = opts.addNew ?? false;
  const startedAt = new Date();

  // Check provenance BEFORE any database work: a mangled pool must not write at all.
  const completeness = assertPoolContract(pool, opts.label ?? `merchant ${merchantId}`);
  console.log(
    `  pool contract: ${completeness.total} products · rawPriceText ${completeness.rawPriceTextPct}%` +
    ` · productUrl ${completeness.productUrlPct}%` +
    ` · ean ${completeness.withEan}` +
    ` · image ${completeness.withImage}`,
  );

  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId }, select: { lastOfferCount: true, priceSource: true } });
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
  for (const sp of pool) {
    if (!(sp.price > 0) || !sp.name) continue;
    const item = prep(sp.name, sp.brand, sp.ean);
    const pr: Prepared = { sp, item, size: parseSize(sp.name), storeKey: slugify(sp.name) || sp.url };
    prepared.push(pr);
    for (const t of item.tokens) {
      let b = storeByToken.get(t);
      if (!b) { b = []; storeByToken.set(t, b); }
      b.push(pr);
    }
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

  const chosen = new Map<number, { unitSize: number; price: number; available: boolean; url: string; image: string | null; fillImage: boolean; category?: string; score: number; reason: string; source: string; sp: StoreProduct }>();
  const consider = (productId: number, unitSize: number, catImage: string | null, c: Prepared, score: number, reason: string) => {
    const prev = chosen.get(productId);
    const better = !prev || (c.sp.available && !prev.available) || (c.sp.available === prev.available && c.sp.price < prev.price);
    if (better) chosen.set(productId, { unitSize, price: c.sp.price, available: c.sp.available, url: c.sp.url, image: c.sp.image, fillImage: !catImage, category: c.sp.category, score, reason, source: c.sp.priceSource ?? merchant?.priceSource ?? "SHELF", sp: c.sp });
  };
  // productId a store item is forbidden from (reject override), keyed by storeKey.
  const rejects = new Set<string>();
  for (const [k, o] of overrides) if (o.decision === "reject") rejects.add(`${k}:${o.productId}`);
  const rowById = new Map(rows.map((r) => [r.id, r]));

  const explained = new Set<Prepared>();

  // PHASE 0 — human overrides + EAN joins take priority over any heuristic.
  for (const c of prepared) {
    const ov = overrides.get(c.storeKey);
    if (ov && ov.decision === "confirm") {
      const r = rowById.get(ov.productId);
      if (r) { explained.add(c); consider(r.id, r.unitSize, r.image, c, 1, "override"); continue; }
    }
    if (c.item.ean) {
      const pid = eanToProduct.get(c.item.ean);
      if (pid != null && !rejects.has(`${c.storeKey}:${pid}`)) {
        const r = rowById.get(pid);
        if (r) { explained.add(c); consider(pid, r.unitSize, r.image, c, 1, "ean"); }
      }
    }
  }

  // PHASE 1 — catalog coverage: each catalog product takes the cheapest store product that
  // shares its head-noun and clears decide() (size ±6% + brand + section-aware overlap).
  for (const cp of rows) {
    const cItem = prep(cp.name, cp.brand, cp.ean);
    const chead = headNoun(cItem.nname);
    if (!chead) continue;
    const cands = storeByToken.get(chead);
    if (!cands) continue;
    const cSize = { unit: cp.unit, unitSize: cp.unitSize };
    for (const c of cands) {
      if (rejects.has(`${c.storeKey}:${cp.id}`)) continue;
      const d = decide(cItem, cSize, c.item, c.size, section);
      if (!d.ok) continue;
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
  const baseline = await prisma.offer.count({
    where: { merchantId, product: { section }, isStale: false },
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
    let writePrice = o.price;
    let flagged = false;
    let flagReason: string | null = null;
    if (jump || outlier) {
      flagged = true;
      flagReason = jump ? `price jump ${prev}→${o.price}` : `outlier vs median ${med.toFixed(2)}`;
      if (prev && prev > 0) writePrice = prev; // keep the trusted price; don't write garbage
    } else if (lowConf) {
      flagged = true;
      flagReason = `low match confidence ${o.score.toFixed(2)} (${o.reason})`;
    }
    if (flagged) flaggedCount++;

    // Provenance travels with every write: the raw string that produced this price, the
    // deep link (null when the source has none), and any advertised reference price.
    const provenance = {
      rawPriceText: o.sp.rawPriceText ?? null,
      rawSourceBlob: o.sp.rawSourceBlob ? o.sp.rawSourceBlob.slice(0, 4096) : null,
      productUrl: o.sp.productUrl ?? null,
      referencePriceBani: o.sp.referencePriceBani ?? null,
      referencePriceKind: o.sp.referencePriceKind ?? null,
      promoValidFrom: o.sp.promoValidFrom ?? null,
      promoValidTo: o.sp.promoValidTo ?? null,
      lastSeenAt: new Date(),
      isStale: false,
      isExpired: o.sp.promoValidTo ? o.sp.promoValidTo.getTime() < Date.now() : false,
    };
    const ppu = o.unitSize > 0 ? writePrice / o.unitSize : writePrice;
    // Null rather than a crash or a lie: a mis-parsed pack size ("3 mg/ml" read as the pack)
    // can push this past what an INT column holds, and the column is nullable for exactly
    // that reason. See perUnitBaniOrNull.
    const ppuBani = perUnitBaniOrNull(writePrice, o.unitSize);
    const avail = o.available ? "in stock" : "out of stock";
    const offer = await prisma.offer.upsert({
      where: { productId_merchantId: { productId, merchantId } },
      update: { price: writePrice, pricePerUnit: ppu, pricePerUnitBani: ppuBani, availability: avail, url: o.url, matchedBy: o.reason, matchScore: o.score, priceSource: o.source, flagged, flagReason, lastSeen: new Date(), ...provenance },
      create: { productId, merchantId, price: writePrice, pricePerUnit: ppu, pricePerUnitBani: ppuBani, availability: avail, url: o.url, currency: "RON", matchedBy: o.reason, matchScore: o.score, priceSource: o.source, flagged, flagReason, ...provenance },
    });
    // append a history point only when the price actually changed (20–50× fewer rows)
    if (prev === undefined || Math.abs(prev - writePrice) > 1e-9) {
      await prisma.priceHistory.create({ data: { offerId: offer.id, price: writePrice, referencePriceBani: o.sp.referencePriceBani ?? null } });
    }
  }

  await prisma.merchant.update({ where: { id: merchantId }, data: { lastOfferCount: chosen.size, lastScrapeAt: new Date() } }).catch(() => {});
  // Persist the run so /admin/health can distinguish "found fewer products" from
  // "could not READ the products" the next morning.
  await recordScraperRun({
    merchantId, startedAt,
    tally: { label: "", attempted: pool.length, parsed: prepared.length, nulls: pool.length - prepared.length, nullRate: pool.length ? (pool.length - prepared.length) / pool.length : 0, samples: [], exceedsThreshold: false },
    offersRejected: flaggedCount,
    previousRunCount: merchant?.lastOfferCount ?? 0,
  });
  return { offers: chosen.size, created: createdIds.size, flagged: flaggedCount };
}
