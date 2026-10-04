// Pricing basket v2: per shop, per class, per day.
//
// The question this answers is the one a shopper opens the page for — "cât costă coșul la
// fiecare magazin" — and v1 could not answer it. Forty pinned products, no merchant carrying
// all forty, so the table was a column of dashes.
//
// ── THE RULE THE PER-SHOP COLUMN LIVES BY.
//
// For a shop's basket, every line is priced AT THAT SHOP or not at all. There is no borrowing.
// A shop missing eight classes has a basket of thirty-two lines and is reported as incomplete,
// and its total is NOT comparable with a shop that filled all forty. Filling the gap from
// somewhere else would turn "this shop is cheaper" into "this shop plus a bit of that one",
// which is not a claim anybody could act on.
//
// The headline "cel mai mic preț per produs, de oriunde" is a SEPARATE number, computed across
// all shops, and is labelled as the shopping-around price rather than any one shop's basket.
//
// ── AND THE SIZE WINDOW IS NOT OPTIONAL.
//
// `pickForClass` picks the cheapest buyable offer in a class. What stops that becoming "the
// cheapest thing that vaguely matches" is the class's own membership rules — `require`,
// `exclude`, and the size bounds. `audit:basket-classes` measures whether they are holding: it
// reports the size spread of what each class resolves to across shops, and a class that
// resolves to 200 ml at one shop and 1 l at another is a bad class, not a cheap shop.

import { prisma } from "@/lib/db";
import { INDEX_BASKET_V2, BASKET_V2_VERSION, type BasketV2Item } from "@/lib/index-basket-v2";
import { loadOffers } from "@/lib/substitution/load";
import { pickForClass } from "@/lib/substitution/pick";
import { rulesFromAttributes } from "@/lib/substitution/class-rules";
import { unitPriceBani, type OfferLike, type UserContext } from "@/lib/substitution/resolve";

/** No favourites, no blocks, no loyalty cards: the Index is a public measurement, not a
 *  personalised one. Every shop is priced under identical assumptions or the comparison is
 *  between two different questions. */
export const NEUTRAL_CONTEXT: UserContext = {
  favouriteProductIds: new Set(),
  inferredFavouriteProductIds: new Set(),
  blockedProductIds: new Set(),
  blockedBrands: new Set(),
  blockedAttributeTags: new Set(),
  preferPrivateLabel: false,
  hasLoyaltyCards: false,
};

export type ResolvedLine = {
  item: BasketV2Item;
  /** null when this shop has nothing in the class. */
  priceBani: number | null;
  productName: string | null;
  productSlug: string | null;
  /** The pack actually chosen, in the class's own unit — what the size audit reads. */
  packQuantity: number | null;
  unit: string | null;
  /** True when the line was priced per canonical quantity rather than per pack. */
  pricedPerUnit: boolean;
  /** Other buyable candidates at this shop, so "only option" is distinguishable from "cheapest". */
  alternatives: number;
};

export type ShopBasketV2 = {
  merchantSlug: string;
  merchantName: string;
  lines: ResolvedLine[];
  found: number;
  missing: number;
  /** Sum of the lines this shop COULD price. Only comparable with another shop that filled the
   *  same number of lines — the page says so rather than leaving it to be inferred. */
  totalBani: number;
  complete: boolean;
};

export type BasketV2Now = {
  version: number;
  shops: ShopBasketV2[];
  /** Cheapest per class ACROSS all shops — the shopping-around price, not any shop's basket. */
  bestAnywhereBani: number;
  bestAnywhereLines: { item: BasketV2Item; priceBani: number | null; merchantSlug: string | null; productName: string | null }[];
  /** Classes no shop can fill at all. Catalog gaps, and the page states them. */
  unfillable: BasketV2Item[];
  /** Basket lines whose class does not exist in the database. A definition error, not a gap. */
  missingClasses: string[];
  computedAt: Date;
};

export async function priceBasketV2(): Promise<BasketV2Now> {
  const classes = await prisma.equivalenceClass.findMany({
    where: { slug: { in: INDEX_BASKET_V2.map((i) => i.classSlug) } },
    select: { id: true, slug: true, unit: true, unitSize: true, attributes: true },
  });
  const bySlug = new Map(classes.map((c) => [c.slug, c]));
  // Read from the class's own rules, so "is this sold by weight" has one definition and it is
  // the one the resolver already enforces.
  const anySizeBySlug = new Map(classes.map((c) => [c.slug, rulesFromAttributes(c.attributes).anySize === true]));
  const missingClasses = INDEX_BASKET_V2.filter((i) => !bySlug.has(i.classSlug)).map((i) => i.classSlug);

  const offers = await loadOffers({ classIds: classes.map((c) => c.id) });
  const merchants = await prisma.merchant.findMany({
    where: { active: true },
    select: { id: true, slug: true, name: true, priceChannel: true },
    orderBy: { name: "asc" },
  });

  // DELIVERY_PLATFORM prices carry a platform markup and are excluded from every comparison on
  // the site. An index that included them would be measuring a different thing from the pages.
  const shopsToPrice = merchants.filter((m) => m.priceChannel !== "aggregator");

  const shops: ShopBasketV2[] = [];
  for (const m of shopsToPrice) {
    const lines: ResolvedLine[] = INDEX_BASKET_V2.map((item) => {
      const cls = bySlug.get(item.classSlug);
      if (!cls) return { item, priceBani: null, productName: null, productSlug: null, packQuantity: null, unit: null, pricedPerUnit: false, alternatives: 0 };
      const pick = pickForClass(cls.id, NEUTRAL_CONTEXT, offers, { merchantId: m.id });
      if (!pick) return { item, priceBani: null, productName: null, productSlug: null, packQuantity: null, unit: null, pricedPerUnit: false, alternatives: 0 };

      // ── A WEIGHT-SOLD LINE IS PRICED PER KILO, NOT PER PACK.
      //
      // The first version summed pack prices for every line. For `anySize` classes that is
      // meaningless arithmetic: the audit found Sezamo pricing "banane" with a 200 g single
      // banana at 2,19 and Auchan with a 1 kg bag at 6,99, and the basket read Sezamo as three
      // times cheaper on that line. It was not — it was a fifth of the bananas.
      //
      // For a class that fixes its pack (`unt-200g`, `apa-plata-2l`) the pack price IS the
      // line. For a class that accepts any size because the good is sold by weight, the line is
      // what the class's canonical quantity costs. `unitPriceBani` is denominated per kg/L/piece
      // already, so the canonical size multiplies straight through.
      const perUnit = anySizeBySlug.get(item.classSlug) === true;
      const priceBani = perUnit
        ? Math.round(unitPriceBani(pick.offer) * (cls.unitSize || 1))
        : pick.offer.priceBani;

      return {
        item,
        priceBani,
        productName: pick.offer.product.name,
        productSlug: (pick.offer.product as { slug?: string }).slug ?? null,
        packQuantity: pick.offer.packQuantity,
        unit: pick.offer.unit,
        pricedPerUnit: perUnit,
        alternatives: pick.alternatives,
      };
    });
    const found = lines.filter((l) => l.priceBani != null).length;
    shops.push({
      merchantSlug: m.slug,
      merchantName: m.name,
      lines,
      found,
      missing: lines.length - found,
      totalBani: lines.reduce((s, l) => s + (l.priceBani ?? 0), 0),
      complete: found === lines.length,
    });
  }

  // ── The headline: cheapest per class anywhere. A different question from any shop's basket,
  //    and kept in its own field so the two cannot be mistaken for one another.
  const bestAnywhereLines = INDEX_BASKET_V2.map((item) => {
    let best: { priceBani: number; merchantSlug: string; productName: string } | null = null;
    for (const s of shops) {
      const l = s.lines.find((x) => x.item.key === item.key);
      if (l?.priceBani == null) continue;
      if (!best || l.priceBani < best.priceBani) {
        best = { priceBani: l.priceBani, merchantSlug: s.merchantSlug, productName: l.productName ?? "" };
      }
    }
    return { item, priceBani: best?.priceBani ?? null, merchantSlug: best?.merchantSlug ?? null, productName: best?.productName ?? null };
  });

  return {
    version: BASKET_V2_VERSION,
    shops: shops.sort((a, b) => b.found - a.found || a.totalBani - b.totalBani),
    bestAnywhereBani: bestAnywhereLines.reduce((s, l) => s + (l.priceBani ?? 0), 0),
    bestAnywhereLines,
    unfillable: bestAnywhereLines.filter((l) => l.priceBani == null).map((l) => l.item),
    missingClasses,
    computedAt: new Date(),
  };
}

/**
 * What each class resolves to across shops, for the size audit.
 *
 * Returned as raw picks rather than a verdict: the audit decides what counts as too wide a
 * spread, and it says so with the numbers beside it.
 */
export type ClassResolution = {
  item: BasketV2Item;
  picks: { merchantSlug: string; productName: string; packQuantity: number; unit: string; priceBani: number }[];
  classUnit: string | null;
  classUnitSize: number | null;
  offersInClass: number;
  /** Sold by weight: the line is priced per canonical unit, so pack sizes may legitimately differ. */
  anySize: boolean;
  minUnitSize: number | null;
  maxUnitSize: number | null;
};

export async function resolveClassesAcrossShops(): Promise<ClassResolution[]> {
  const now = await priceBasketV2();
  const classes = await prisma.equivalenceClass.findMany({
    where: { slug: { in: INDEX_BASKET_V2.map((i) => i.classSlug) } },
    select: { id: true, slug: true, unit: true, unitSize: true, attributes: true, _count: { select: { products: true } } },
  });
  const bySlug = new Map(classes.map((c) => [c.slug, c]));

  return INDEX_BASKET_V2.map((item) => {
    const cls = bySlug.get(item.classSlug);
    const picks: ClassResolution["picks"] = [];
    for (const s of now.shops) {
      const l = s.lines.find((x) => x.item.key === item.key);
      if (l?.priceBani == null || l.packQuantity == null || l.unit == null) continue;
      picks.push({
        merchantSlug: s.merchantSlug,
        productName: l.productName ?? "",
        packQuantity: l.packQuantity,
        unit: l.unit,
        priceBani: l.priceBani,
      });
    }
    const rules = cls ? rulesFromAttributes(cls.attributes) : {};
    return {
      item,
      picks,
      classUnit: cls?.unit ?? null,
      classUnitSize: cls?.unitSize ?? null,
      offersInClass: cls?._count.products ?? 0,
      anySize: rules.anySize === true,
      minUnitSize: rules.minUnitSize ?? null,
      maxUnitSize: rules.maxUnitSize ?? null,
    };
  });
}

export type { OfferLike };
