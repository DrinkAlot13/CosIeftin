// The reads behind /api/v1. Separate from `lib/queries.ts` on purpose: the website's queries
// select what a PAGE renders, and this selects what a CONTRACT publishes. They overlap heavily
// and they are not the same thing — a column added for a card would silently join the API's
// payload if they shared a select, and removing it later would then be a breaking change to
// software we do not control.

import { prisma } from "@/lib/db";
import { MAX_DISPLAY_AGE_DAYS } from "@/lib/pricing";
import { comparisonOf, publishableOffers, serializeOffer, serializeProduct, summaryOf, type OfferLike } from "./serialize";

/** Every Offer column the API publishes, and not one more. */
const offerSelect = {
  id: true, price: true, priceBani: true, pricePerUnit: true, pricePerUnitBani: true,
  availability: true, isStale: true, flagged: true, priceSource: true,
  productUrl: true, url: true, lastObservedAt: true, packLabel: true,
  requiresLoyaltyCard: true, loyaltyPriceBani: true,
  merchant: { select: { slug: true, name: true, storeType: true } },
} as const;

const productSelect = {
  slug: true, name: true, brand: true, unit: true, unitSize: true, image: true, section: true,
  category: { select: { slug: true, name: true } },
} as const;

/**
 * Offers worth publishing at all.
 *
 * `flagged: false` is here AND in `publishableOffers`. Deliberate belt-and-braces on the one
 * rule whose failure publishes a price a gate refused to trust: the query should not fetch them
 * and the serialiser will not emit them, and neither is trusted to be the only guard.
 */
function liveWhere() {
  return {
    merchant: { active: true },
    flagged: false,
    lastObservedAt: { gte: new Date(Date.now() - MAX_DISPLAY_AGE_DAYS * 86_400_000) },
  } as const;
}

export type ProductPayload = {
  product: ReturnType<typeof serializeProduct>;
  comparison: ReturnType<typeof comparisonOf>;
  summary: ReturnType<typeof summaryOf>;
  offers: ReturnType<typeof serializeOffer>[];
};

function build(
  p: { slug: string; name: string; brand: string | null; unit: string | null; unitSize: number | null; image: string | null; section: string; category: { slug: string; name: string } | null; offers: OfferLike[] },
  includeDeliveryPlatform: boolean,
): ProductPayload {
  const kept = publishableOffers(p.offers, includeDeliveryPlatform);
  const offers = kept
    .map((o) => serializeOffer(o))
    .sort((a, b) => a.priceBani - b.priceBani);
  return {
    product: serializeProduct(p),
    // The comparison counts only offers a shopper could ACT on. A product priced at three shops
    // where two are out of stock is not a three-way comparison, and saying so is the whole point
    // of the field.
    comparison: comparisonOf(offers.filter((o) => o.inStock && !o.isStale)),
    summary: summaryOf(offers),
    offers,
  };
}

export async function productBySlug(slug: string, includeDeliveryPlatform: boolean): Promise<ProductPayload | null> {
  const p = await prisma.product.findUnique({
    where: { slug },
    select: { ...productSelect, offers: { where: liveWhere(), select: offerSelect } },
  });
  return p ? build(p, includeDeliveryPlatform) : null;
}

/**
 * Look an offer up by the merchant's own product URL — the extension's primary key.
 *
 * Exact first, then a NORMALISED form. Normalising is not fuzzy matching: it strips only the
 * things that provably do not identify a different product — scheme, `www.`, a trailing slash,
 * and the tracking parameters a shopper's URL picks up on the way (`utm_*`, `gclid`, `fbclid`).
 * A URL either names a row or it does not; there is no score here and no threshold.
 */
export function normalizeProductUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    for (const k of [...u.searchParams.keys()]) {
      if (/^utm_/i.test(k) || ["gclid", "fbclid", "msclkid", "from", "ref"].includes(k.toLowerCase())) {
        u.searchParams.delete(k);
      }
    }
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "");
    const qs = u.searchParams.toString();
    return `${host}${path}${qs ? `?${qs}` : ""}`;
  } catch {
    return null;
  }
}

export async function productByUrl(rawUrl: string, includeDeliveryPlatform: boolean): Promise<{ payload: ProductPayload; merchant: string } | null> {
  const norm = normalizeProductUrl(rawUrl);
  if (!norm) return null;

  // Exact stored value first — the common case, one indexed equality.
  let hit = await prisma.offer.findFirst({
    where: { productUrl: rawUrl.trim(), merchant: { active: true } },
    select: { productId: true, merchant: { select: { slug: true } } },
  });

  if (!hit) {
    // Then the normalised comparison. Bounded by the host so this stays an indexed range scan
    // rather than a scan of every offer we hold.
    const host = norm.split("/")[0];
    const candidates = await prisma.offer.findMany({
      where: { productUrl: { contains: host }, merchant: { active: true } },
      select: { productId: true, productUrl: true, merchant: { select: { slug: true } } },
      take: 500,
    });
    const found = candidates.find((c) => c.productUrl && normalizeProductUrl(c.productUrl) === norm);
    hit = found ? { productId: found.productId, merchant: found.merchant } : null;
  }
  if (!hit) return null;

  const p = await prisma.product.findUnique({
    where: { id: hit.productId },
    select: { ...productSelect, offers: { where: liveWhere(), select: offerSelect } },
  });
  return p ? { payload: build(p, includeDeliveryPlatform), merchant: hit.merchant.slug } : null;
}

export async function productBySku(merchantSlug: string, sku: string, includeDeliveryPlatform: boolean): Promise<ProductPayload | null> {
  const hit = await prisma.offer.findFirst({
    where: { sku, merchant: { slug: merchantSlug, active: true } },
    select: { productId: true },
  });
  if (!hit) return null;
  const p = await prisma.product.findUnique({
    where: { id: hit.productId },
    select: { ...productSelect, offers: { where: liveWhere(), select: offerSelect } },
  });
  return p ? build(p, includeDeliveryPlatform) : null;
}

/** Does this merchant publish an SKU we store at all? Answers `unsupported` honestly. */
export async function merchantHasSkus(merchantSlug: string): Promise<boolean> {
  const n = await prisma.offer.count({
    where: { merchant: { slug: merchantSlug, active: true }, isStale: false, sku: { not: null } },
  });
  return n > 0;
}

export async function productById(id: number, includeDeliveryPlatform: boolean): Promise<ProductPayload | null> {
  const p = await prisma.product.findUnique({
    where: { id },
    select: { ...productSelect, offers: { where: liveWhere(), select: offerSelect } },
  });
  return p ? build(p, includeDeliveryPlatform) : null;
}
