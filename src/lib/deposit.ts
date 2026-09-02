// SGR — the container deposit, which we have been ignoring and which differs between the very
// products we put side by side.
//
// Every Romanian retailer prints it on beverage pages: Auchan "+3 lei" on a six-pack,
// Carrefour "Preț + garanție 11,25 LEI", Mega "+0,50 x 1 buc", Freshful "+0,50". It is
// 50 bani per container under the Sistem de Garanție-Returnare, and it is NOT part of the
// price — it comes back when the container does.
//
// WHY IT MATTERS FOR A COMPARISON SITE SPECIFICALLY. The deposit scales with the number of
// containers, not with volume. A 6 x 0.33 l pack carries 3,00 lei of deposit; a 2 l bottle of
// the same drink carries 0,50. Those are two products we show on the same page, and the money
// a shopper hands over at the till differs by 2,50 lei in a way our price column never showed.
//
// AUCHAN PUBLISHES THE VALUE. Its VTEX payload carries `"GARANTIE_SGR":["0,5"]` — the
// merchant's own per-container figure, on 995 offers. That is an oracle in the same sense as
// Kaufland's published unit price: a number computed by someone who is not us, sharing none
// of our assumptions. Read it where present; derive it only where it is not.

/** Per-container deposit under the SGR scheme, in bani. Set by law, not by the merchant. */
export const SGR_PER_CONTAINER_BANI = 50;

/**
 * Category slugs where a deposit applies.
 *
 * Deliberately narrow. SGR covers beverage containers between 0.1 l and 3 l — glass, PET and
 * metal. Deriving a deposit for a product that does not carry one would invent money the
 * shopper never pays, which is the same sin as hiding money they do.
 */
export const SGR_CATEGORIES = new Set([
  "bauturi", "apa", "bere", "sucuri", "racoritoare", "vinuri", "vin", "bauturi-racoritoare",
  "apa-si-sucuri", "sucuri-si-nectaruri", "sucuri-carbogazoase", "bauturi-alcoolice",
]);

/** Volumes outside this range are not in scope for SGR. */
const MIN_L = 0.1;
const MAX_L = 3;

export type DepositInput = {
  /** the offer's own parsed size */
  unit: string | null;
  unitSize: number | null;
  /** containers in the pack — a six-pack is 6, a single bottle is 1 */
  packCount: number;
  categorySlug: string | null;
  /** the merchant's own published per-container figure, in bani, when it publishes one */
  publishedPerContainerBani?: number | null;
};

export type Deposit = {
  /** per container, in bani */
  perContainerBani: number;
  containerCount: number;
  /** what the shopper actually hands over on top of the price */
  totalBani: number;
  /** true when the merchant published the figure rather than us deriving it */
  fromMerchant: boolean;
};

/**
 * The deposit on one offer, or null when SGR does not apply.
 *
 * Returns null rather than zero for out-of-scope products, so "no deposit" and "a deposit of
 * nothing" stay distinguishable in the data — the first is a fact about the product, the
 * second would be a claim we cannot support.
 */
export function depositFor(o: DepositInput): Deposit | null {
  const perContainer = o.publishedPerContainerBani ?? null;

  // The merchant's own figure wins, and it also settles whether SGR applies at all: a shop
  // that prints GARANTIE_SGR on a product is telling us the product carries one.
  if (perContainer != null && perContainer > 0) {
    const containerCount = Math.max(1, o.packCount);
    return {
      perContainerBani: perContainer,
      containerCount,
      totalBani: perContainer * containerCount,
      fromMerchant: true,
    };
  }

  // Derivation, only inside the categories and volumes SGR actually covers.
  if (!o.categorySlug || !SGR_CATEGORIES.has(o.categorySlug)) return null;
  if (o.unit !== "l") return null;
  if (o.unitSize == null || o.unitSize <= 0) return null;

  const containerCount = Math.max(1, o.packCount);
  const perContainerL = o.unitSize / containerCount;
  if (perContainerL < MIN_L || perContainerL > MAX_L) return null;

  return {
    perContainerBani: SGR_PER_CONTAINER_BANI,
    containerCount,
    totalBani: SGR_PER_CONTAINER_BANI * containerCount,
    fromMerchant: false,
  };
}

/** "preț + garanție 14,69 lei" — the number a shopper hands over at the till. */
export function priceWithDepositBani(priceBani: number, d: Deposit | null): number {
  return priceBani + (d?.totalBani ?? 0);
}

/**
 * Read a merchant's published per-container deposit out of its source payload.
 *
 * Auchan: `"GARANTIE_SGR":["0,5"]` inside the VTEX specification attributes — lei, Romanian
 * decimal comma. Kept as a per-merchant reader rather than one loose regex, because "the
 * shape happens to match" is how the wrong number gets read.
 */
export function readPublishedDepositBani(merchantSlug: string, blob: string | null): number | null {
  if (!blob) return null;
  if (merchantSlug === "auchan") {
    const m = blob.match(/"GARANTIE_SGR"\s*:\s*\[\s*"([\d.,]+)"/);
    if (!m) return null;
    const lei = Number(m[1].replace(",", "."));
    return Number.isFinite(lei) && lei > 0 ? Math.round(lei * 100) : null;
  }
  return null;
}
