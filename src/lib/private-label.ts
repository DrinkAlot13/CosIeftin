// WHOSE OWN BRAND IS THIS? Brand plus merchant, never brand alone.
//
// ── WHY THIS EXISTS. `ProductAttribute` was COMPLETELY EMPTY — no keys, zero rows — so
// `isPrivateLabel` was false everywhere. Two consequences, and the second is the serious one:
//
//   1. The product page's "this is the shop's own brand" sentence could never render.
//   2. `preferPrivateLabel` IN THE OPTIMIZER COULD NEVER FIRE. `lib/substitution/pick.ts` has
//      `else if (ctx.preferPrivateLabel && chosen.product.isPrivateLabel)`, and `load.ts`
//      derives that flag from this table. A shopper who asked to prefer own-brand products got
//      the ordinary cheapest-per-unit answer, with nothing saying their preference did nothing.
//
// That is this project's most-repeated defect — a value never observed, read as an observation —
// and it is the second UI control found backed by an empty table, after EquivalenceClass.
//
// ── BRAND PLUS MERCHANT, and the distinction is the point.
//
// `Carrefour Classic` sold AT METRO is not Metro's own brand. It is a Carrefour own-brand
// product that Metro happens to stock, and calling it Metro's would tell a shopper the opposite
// of the truth about who controls that price. So membership is a pair: the brand, and the
// merchant whose label it is. A product carries `isPrivateLabel` only where it is sold by the
// merchant that owns the label.
//
// ── THE LISTS ARE JUDGEMENTS AND ARE WRITTEN DOWN AS SUCH.
//
// There is no field in any payload that says "this is our own brand", so this is a hand-written
// mapping from public knowledge of Romanian retail. It will be incomplete. That is fine and it
// is why `audit:private-label-coverage` reports per merchant rather than asserting a number.

/** Merchant slug -> the brand names that merchant owns, normalised for comparison. */
export const PRIVATE_LABEL_BRANDS: Readonly<Record<string, readonly string[]>> = {
  "mega-image": [
    "mega", "gusturi romanesti", "gusturi românești", "nature's promise", "natures promise",
    "delhaize",
  ],
  auchan: ["auchan", "pouce", "cora", "actuel", "la masa in romania", "la masa în românia", "baby auchan"],
  carrefour: ["carrefour", "carrefour classic", "carrefour bio", "carrefour selection", "carrefour kids"],
  kaufland: ["k-classic", "k classic", "kaufland", "k-bio", "k bio", "bevola"],
  "glovo-kaufland": ["k-classic", "k classic", "kaufland", "k-bio", "k bio"],
  metro: ["metro chef", "aro", "fine life", "rioba", "horeca select", "tarrington house"],
  penny: ["penny", "boni", "clever", "san fabio"],
  "glovo-penny": ["penny", "boni", "clever", "san fabio"],
  profi: ["profi", "festivo"],
  "glovo-profi": ["profi", "festivo"],
  freshful: ["freshful"],
  sezamo: ["sezamo"],
  dcneu: ["dcneu"],
  lidl: ["milbona", "pilos", "combino", "w5", "freeway", "solevita", "dulano"],
};

// ── WORDS DELIBERATELY NOT IN THE LISTS ABOVE, and why.
//
// A false positive here tells a shopper "only Auchan sells this" about a NATIONAL brand, which
// is worse than saying nothing at all. So a brand earns a place only if the word is distinctive
// enough that a match is almost certainly the label and not a coincidence.
//
//   primo    dropped after it matched exactly two products and BOTH were wrong:
//            "Parizer de pasare Caroli Primo" and "PRIMO Madeleines" are Caroli's and a
//            national brand, not Profi's own label.
//   care     "Body Care", "Baby Care" — a category word, not a brand.
//   365      a number that appears in names for a dozen reasons.
//   today    too common in English-language packaging.
//   sigma    a Metro label, but also a national brand of several other things.
//   cien     Lidl's, and it was listed under Kaufland too by mistake; a brand cannot be two
//            merchants' own label, and listing it twice is how a Lidl product would have been
//            reported as Kaufland's.
//   simpl    Carrefour's, but one letter from ordinary Romanian words in a normalised compare.

/** Comparison form: lower-cased, diacritics folded, punctuation collapsed. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ăâ]/g, "a").replace(/[îi]/g, "i").replace(/[șş]/g, "s").replace(/[țţ]/g, "t")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Every merchant that owns this brand, by slug. Usually one; empty for a national brand. */
export function ownersOfBrand(brand: string | null | undefined): string[] {
  const b = norm(brand ?? "");
  if (!b) return [];
  const out: string[] = [];
  for (const [merchant, brands] of Object.entries(PRIVATE_LABEL_BRANDS)) {
    for (const owned of brands) {
      const o = norm(owned);
      // Whole-token containment, not substring: "aro" must not match "aroma", which is exactly
      // how the brand gate came to accept `aro Detergent` as `Fine Life Detergent`.
      if (b === o || ` ${b} `.includes(` ${o} `)) { out.push(merchant); break; }
    }
  }
  return out;
}

/**
 * Is this product the OWN BRAND of a merchant that actually sells it?
 *
 * `sellingMerchants` is the set of merchant slugs with a live offer. A Carrefour Classic product
 * that only Metro stocks returns false: it is somebody's own brand, but not the seller's, and
 * that is the distinction the brief asked for.
 */
export function privateLabelOwner(
  brand: string | null | undefined,
  sellingMerchants: Iterable<string>,
): string | null {
  const owners = ownersOfBrand(brand);
  if (owners.length === 0) return null;
  const selling = new Set(sellingMerchants);
  for (const o of owners) if (selling.has(o)) return o;
  return null;
}
