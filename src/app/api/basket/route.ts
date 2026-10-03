// The MAIN basket optimizer — "where's my cart cheapest, in one shop or split" — for /lista.
//
// ── THIS USED TO BE EXACT-MATCH ONLY, AND THAT WAS THE REAL BUG.
//
// The substitution engine (equivalence classes, structural head-noun matching, embedding
// similarity, all gated by dose-contradiction + mutual-distinction) has existed since last
// session for /api/basket/shop (one-store completion) and /api/basket/v2. This route — the one
// /lista's ListBuilder actually calls — never used it. It called `optimizeBasket` in
// `lib/basket.ts`, which only ever looked up a PRODUCT'S OWN offers: no class, no structural
// fallback, nothing. So a shopper's real complaint ("28 of 30 products weren't found") was in
// part this: the main page was never attempting a substitution at all, while a sibling page three
// clicks away was already doing it safely.
//
// Rebuilt on `lib/basket/optimize.ts` (the substitution-aware engine), with the two things that
// engine does not carry — bulk-tier "next rung" hints and SGR deposits — restored from the
// modules that already compute them (`lib/bulk-tiers.ts`, `substitution/load.ts`'s
// `loadOfferExtras`), exactly as the per-shop route already does. No new matching logic here:
// every accept/reject decision still lives in `queries.ts` / `substitution/resolve.ts`.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { guard } from "@/lib/rate-limit";
import { deliveryPlatformWhere } from "@/lib/platform/visibility";
import { leiToBaniExact } from "@/lib/price/parsePrice";
import { parseQuantity } from "@/lib/units/parseQuantity";
import { validateTiers, type RawTier } from "@/lib/price/bulkTiers";
import { structuralCandidateIds, semanticCandidateIds, BASKET_STRUCTURAL_TOLERANCE } from "@/lib/queries";
import { loadMerchants, loadUserContext, loadOfferExtras } from "@/lib/substitution/load";
import { optimizeBasket, type MerchantBasket } from "@/lib/basket/optimize";
import { resolveLine, type ListLine, type OfferLike, type SubstitutionMode } from "@/lib/substitution/resolve";
import { unitPriceAtQty, nextRungHint, type Ladder } from "@/lib/bulk-tiers";

export const dynamic = "force-dynamic";

type InItem = { slug: string; qty: number };

function parseItems(raw: unknown): InItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const o = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
      return { slug: String(o.slug ?? ""), qty: Math.max(1, Math.min(99, Number(o.qty) || 1)) };
    })
    .filter((r) => r.slug);
}

type StoreTotal = {
  merchantId: number; slug: string; name: string; color: string | null; storeType: string | null;
  subtotal: number; deliveryFee: number; total: number; missing: number; itemsFound: number;
  /** how many of `itemsFound` were NOT the exact product asked for — never folded silently into "found" */
  substituted: number;
  belowMinOrder: boolean; minOrder: number | null; needForMinOrder: number | null; needForFreeDelivery: number | null;
  usesLoyalty: boolean; priceSource: string;
};

function toStoreTotal(mb: MerchantBasket, priceChannel: string): StoreTotal {
  return {
    merchantId: mb.merchant.id, slug: mb.merchant.slug, name: mb.merchant.name,
    color: null, storeType: mb.merchant.storeType,
    subtotal: mb.subtotalBani / 100, deliveryFee: mb.deliveryFeeBani / 100, total: mb.totalBani / 100,
    missing: mb.unavailable.length, itemsFound: mb.resolved.length + mb.substituted.length,
    substituted: mb.substituted.length,
    belowMinOrder: !mb.meetsMinimum,
    minOrder: mb.merchant.minOrderBani != null ? mb.merchant.minOrderBani / 100 : null,
    needForMinOrder: mb.minOrderShortfallBani != null ? mb.minOrderShortfallBani / 100 : null,
    needForFreeDelivery: mb.needForFreeDeliveryBani != null ? mb.needForFreeDeliveryBani / 100 : null,
    usesLoyalty: false,
    priceSource: priceChannel,
  };
}

export async function POST(req: NextRequest) {
  const limited = guard("write", req);
  if (limited) return limited;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const items = parseItems(body.items);
  const includePlatform = Boolean(body.includeDeliveryPlatform);
  const mode: SubstitutionMode = body.mode === "same-brand" ? "SAME_BRAND" : "EQUIVALENT";

  if (items.length === 0) {
    return NextResponse.json({
      perItem: [], splitTotal: 0, totalDeposit: 0, splitGoods: 0, splitDelivery: 0,
      storeTotals: [], bestComplete: null, bestBlockedByMinOrder: null, storesInSplit: 0,
      savings: null, itemCount: 0, useLoyalty: false, unknown: [],
    });
  }

  const slugs = [...new Set(items.map((i) => i.slug))];
  const requested = await prisma.product.findMany({
    where: { slug: { in: slugs } },
    select: {
      id: true, slug: true, name: true, brand: true, unit: true, unitSize: true, section: true,
      equivalenceClassId: true, embedding: true,
    },
  });
  const bySlug = new Map(requested.map((p) => [p.slug, p]));

  const classIds = [...new Set(requested.map((p) => p.equivalenceClassId).filter((x): x is number => x != null))];

  // Same two-tier fallback as /api/basket/shop and /api/basket/v2: curated class first, then
  // structural (head noun) and semantic (embedding) candidates for whatever has no class, both
  // gated by the dose-contradiction + mutual-distinction checks inside `structuralCandidateIds`.
  const noClass = requested.filter((p) => p.equivalenceClassId == null);
  const candidatesByProduct = new Map<number, number[]>(
    await Promise.all(
      noClass.map(async (p) => {
        const [structural, semantic] = await Promise.all([
          structuralCandidateIds(p, BASKET_STRUCTURAL_TOLERANCE, { requireMutualDistinction: true }),
          semanticCandidateIds(p, BASKET_STRUCTURAL_TOLERANCE),
        ]);
        return [p.id, [...new Set([...structural, ...semantic])]] as [number, number[]];
      }),
    ),
  );
  const allStructuralIds = [...new Set([...candidatesByProduct.values()].flat())];

  const offerRows = await prisma.offer.findMany({
    where: {
      OR: [
        { productId: { in: requested.map((p) => p.id) } },
        ...(classIds.length ? [{ product: { equivalenceClassId: { in: classIds } } }] : []),
        ...(allStructuralIds.length ? [{ productId: { in: allStructuralIds } }] : []),
      ],
      flagged: false,
      merchant: { active: true },
      ...deliveryPlatformWhere(includePlatform),
    },
    select: {
      id: true, productId: true, merchantId: true, priceBani: true, price: true,
      availability: true, isStale: true, isExpired: true, promoValidTo: true,
      requiresLoyaltyCard: true, bulkTiers: true,
      product: { select: { id: true, name: true, brand: true, equivalenceClassId: true, unit: true, unitSize: true } },
      _count: { select: { anomalies: { where: { resolved: false } } } },
    },
    take: 5000,
  });

  const offers: OfferLike[] = offerRows.map((o) => {
    const q = parseQuantity(o.product.name);
    const packQuantity = q ? q.value : o.product.unit === "buc" ? o.product.unitSize : o.product.unitSize * 1000;
    const basePriceBani = o.priceBani ?? leiToBaniExact(o.price);
    let tiers: { qty: number; priceBani: number }[] | undefined;
    if (o.bulkTiers) {
      try {
        const parsed = JSON.parse(o.bulkTiers) as { qty: number; price: number }[];
        const raw: RawTier[] = parsed.map((t) => ({ minQuantity: t.qty, unitPriceBani: leiToBaniExact(t.price) }));
        const v = validateTiers(basePriceBani, raw);
        tiers = v.ok && v.tiers.length > 0 ? v.tiers.map((t) => ({ qty: t.minQuantity, priceBani: t.unitPriceBani })) : undefined;
      } catch { /* malformed tiers are simply absent */ }
    }
    return {
      id: o.id, productId: o.productId, merchantId: o.merchantId,
      priceBani: basePriceBani,
      packQuantity: packQuantity > 0 ? packQuantity : 1,
      unit: q?.unit ?? (o.product.unit === "buc" ? "BUC" : o.product.unit === "kg" ? "G" : "ML"),
      availability: o.availability, isStale: o.isStale, isExpired: o.isExpired,
      hasUnresolvedAnomaly: o._count.anomalies > 0,
      requiresLoyaltyCard: o.requiresLoyaltyCard,
      bulkTiers: tiers, promoValidTo: o.promoValidTo,
      product: {
        id: o.product.id, name: o.product.name, brand: o.product.brand,
        equivalenceClassId: o.product.equivalenceClassId,
        isPrivateLabel: false,
      },
    };
  });

  const [merchants, ctx, channelRows] = await Promise.all([
    loadMerchants(),
    loadUserContext((await getCurrentUser())?.id ?? null, {}),
    prisma.merchant.findMany({ where: { active: true }, select: { slug: true, priceChannel: true } }),
  ]);
  const channelBySlug = new Map(channelRows.map((r) => [r.slug, r.priceChannel]));

  const lines: ListLine[] = items
    .map((it): ListLine | null => {
      const p = bySlug.get(it.slug);
      return p
        ? { productId: p.id, qty: it.qty, substitutionMode: mode, structuralCandidateProductIds: candidatesByProduct.get(p.id) }
        : null;
    })
    .filter((l): l is ListLine => l != null);
  const lineByProductId = new Map(lines.map((l) => [l.productId, l]));

  const result = optimizeBasket(merchants, lines, offers, ctx, { maxStores: 3 });

  // ── PER-ITEM "CHEAPEST ANYWHERE", IGNORING THE maxStores CAP.
  //
  // This is the SPLIT strategy's per-line number, and it answers a different question than the
  // capped `result.split` does: "if I'm willing to go wherever is cheapest for THIS ONE item,
  // what would I pay" — not "what does the 3-store plan assign it". Re-resolving per merchant
  // here (rather than reusing `result.split.assignments`) is calling the SAME `resolveLine`,
  // just without the store cap.
  const now = new Date();
  type RawPerItem = {
    productId: number; slug: string; name: string; qty: number; offerId: number | null;
    cheapest: {
      merchantId: number; merchantName: string; merchantSlug: string; unitPrice: number; linePrice: number;
      loyalty: boolean; priceSource: string; substituted: boolean; substituteName?: string;
      bulk: { fromQty: number; unitPrice: number; savedOnLine: number } | null;
      nextRung: { addUnits: number; atQty: number; newUnitPrice: number; savesTotal: number } | null;
    } | null;
  };
  const rawPerItem: RawPerItem[] = items.map((it) => {
    const p = bySlug.get(it.slug);
    if (!p) return { productId: -1, slug: it.slug, name: it.slug, qty: it.qty, offerId: null, cheapest: null };
    const line = lineByProductId.get(p.id);
    if (!line) return { productId: p.id, slug: p.slug, name: p.name, qty: it.qty, offerId: null, cheapest: null };

    let best: { merchant: (typeof merchants)[number]; totalBani: number; offer: OfferLike; substituted: boolean } | null = null;
    for (const m of merchants) {
      const r = resolveLine(line, m.id, ctx, offers, now);
      if (r.status === "UNAVAILABLE" || !r.offer) continue;
      if (!best || r.totalBani < best.totalBani) {
        best = { merchant: m, totalBani: r.totalBani, offer: r.offer, substituted: r.status === "SUBSTITUTED" };
      }
    }
    if (!best) return { productId: p.id, slug: p.slug, name: p.name, qty: it.qty, offerId: null, cheapest: null };

    const { offer, merchant, totalBani, substituted } = best;
    const usesTier = totalBani < offer.priceBani * it.qty;
    const ladder: Ladder | null = offer.bulkTiers?.length
      ? {
          baseBani: offer.priceBani,
          rungs: offer.bulkTiers.map((t) => ({ minQuantity: t.qty, unitPriceBani: t.priceBani, discountBp: null })),
          bestUnitBani: 0, bestFromQty: 0, bestDiscountBp: 0,
        }
      : null;
    const hint = nextRungHint(ladder, offer.priceBani, it.qty);
    // sanity-check `usesTier` against the ladder's own answer rather than trusting the cheaper
    // total alone — a cheaper total can also come from the STRUCTURAL/semantic fallback choosing
    // a different, cheaper PRODUCT, which is not a quantity discount.
    const tierApplies = ladder != null && !substituted && unitPriceAtQty(ladder, offer.priceBani, it.qty) < offer.priceBani;

    return {
      productId: p.id, slug: p.slug, name: p.name, qty: it.qty, offerId: offer.id,
      cheapest: {
        merchantId: merchant.id, merchantName: merchant.name, merchantSlug: merchant.slug,
        unitPrice: totalBani / it.qty / 100,
        linePrice: totalBani / 100,
        loyalty: offer.requiresLoyaltyCard,
        priceSource: channelBySlug.get(merchant.slug) ?? "shelf",
        substituted,
        substituteName: substituted ? offer.product.name : undefined,
        bulk: tierApplies && usesTier
          ? {
              fromQty: ladder!.rungs.filter((r) => it.qty >= r.minQuantity).slice(-1)[0]?.minQuantity ?? it.qty,
              unitPrice: totalBani / it.qty / 100,
              savedOnLine: (offer.priceBani / 100) * it.qty - totalBani / 100,
            }
          : null,
        nextRung: !substituted && hint
          ? { addUnits: hint.addUnits, atQty: hint.atQty, newUnitPrice: hint.newUnitBani / 100, savesTotal: hint.savesBani / 100 }
          : null,
      },
    };
  });

  // SGR deposits, fetched only for the offers actually chosen — same pattern as
  // /api/basket/shop's `loadOfferExtras(chosenOfferIds)`, because the engine itself does not
  // carry deposit data.
  const chosenOfferIds = rawPerItem.map((pi) => pi.offerId).filter((x): x is number => x != null);
  const extras = await loadOfferExtras(chosenOfferIds);
  let totalDeposit = 0;
  const perItem = rawPerItem.map(({ offerId, ...pi }) => {
    if (!pi.cheapest || offerId == null) return pi;
    const e = extras.get(offerId);
    const depositLine = e?.depositBani != null ? (e.depositBani * (e.containerCount ?? 1) * pi.qty) / 100 : 0;
    totalDeposit += depositLine;
    return { ...pi, cheapest: { ...pi.cheapest, depositLine } };
  });

  const storeTotals = result.perMerchant
    // A merchant that sells NONE of this basket is not a real option — legacy behaviour, and
    // the only way to avoid a wall of "0/20" rows for merchants outside grocery entirely.
    .filter((mb) => mb.resolved.length + mb.substituted.length > 0)
    .map((mb) => toStoreTotal(mb, channelBySlug.get(mb.merchant.slug) ?? "shelf"))
    .sort((a, b) => a.missing - b.missing || a.total - b.total);

  const bestComplete = result.bestSingle ? toStoreTotal(result.bestSingle, channelBySlug.get(result.bestSingle.merchant.slug) ?? "shelf") : null;
  const bestBlockedByMinOrder = result.bestSingleBlockedByMinimum
    ? toStoreTotal(result.bestSingleBlockedByMinimum, channelBySlug.get(result.bestSingleBlockedByMinimum.merchant.slug) ?? "shelf")
    : null;

  const unknown = slugs.filter((s) => !bySlug.has(s));

  return NextResponse.json({
    perItem,
    splitTotal: result.split.totalBani / 100,
    totalDeposit,
    splitGoods: result.split.goodsBani / 100,
    splitDelivery: result.split.deliveryBani / 100,
    storeTotals,
    bestComplete,
    bestBlockedByMinOrder,
    storesInSplit: result.split.storesUsed,
    savings: result.savingsVsSingleBani != null ? result.savingsVsSingleBani / 100 : null,
    itemCount: items.length,
    useLoyalty: false,
    unknown,
  });
}
