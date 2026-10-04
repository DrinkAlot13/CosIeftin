// "Completează coșul la <shop>" — the whole basket as it would be at ONE shop.
//
// POST { items: [{ slug, qty, mode? }], merchantSlug, preferPrivateLabel?, hasLoyaltyCards? }
//
// This is NOT the optimizer filtered to one column. The optimizer answers "where should I go";
// this answers a different question — "if I go HERE, what do I actually come home with, and what
// does it really cost?" — and the answers differ line by line:
//
//   · every line is resolved in EQUIVALENT mode AT THIS SHOP, so a line the optimizer left
//     unfilled because another shop had it cheaper gets its closest local substitute here;
//   · the total carries the delivery fee and the SGR deposits, which are real money at the till
//     and which a per-item comparison never shows;
//   · lines with nothing equivalent in stock are listed as genuinely unavailable, separately
//     from lines that were merely substituted.
//
// A shopper deciding "can I just do this in one trip?" needs all three, and the coverage figure
// on the optimizer table (7/18) answers none of them.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { explainResolution } from "@/lib/substitution/explain";
import { loadMerchants, loadOfferExtras, loadOffers, loadUserContext } from "@/lib/substitution/load";
import { resolveLine, type ListLine, type SubstitutionMode } from "@/lib/substitution/resolve";
import { structuralCandidateIds, semanticCandidateIds, BASKET_STRUCTURAL_TOLERANCE } from "@/lib/queries";
import { guard } from "@/lib/rate-limit";
import { limitedCatalogNote } from "@/lib/source-capabilities";

export const dynamic = "force-dynamic";

const MODES: SubstitutionMode[] = ["EXACT", "SAME_BRAND", "EQUIVALENT", "CHEAPEST"];

type InItem = { slug: string; qty: number; mode: SubstitutionMode };

function parseItems(raw: unknown): InItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const o = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
      const slug = String(o.slug ?? "");
      const qty = Math.max(1, Math.min(99, Number(o.qty) || 1));
      const mode = (MODES.includes(o.mode as SubstitutionMode) ? o.mode : "EQUIVALENT") as SubstitutionMode;
      return { slug, qty, mode };
    })
    .filter((r) => r.slug);
}

export async function POST(req: NextRequest) {
  const limited = guard("write", req);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const items = parseItems(body?.items);
  const merchantSlug = String(body?.merchantSlug ?? "");
  if (items.length === 0) return NextResponse.json({ error: "Coș gol." }, { status: 400 });
  if (!merchantSlug) return NextResponse.json({ error: "Lipsește magazinul." }, { status: 400 });

  const merchants = await loadMerchants();
  const merchant = merchants.find((m) => m.slug === merchantSlug);
  if (!merchant) return NextResponse.json({ error: "Magazin necunoscut." }, { status: 404 });

  const slugs = [...new Set(items.map((i) => i.slug))];
  const products = await prisma.product.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true, name: true, brand: true, unit: true, unitSize: true, section: true, equivalenceClassId: true, embedding: true },
  });
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  const classIds = [...new Set(products.map((p) => p.equivalenceClassId).filter((x): x is number => x != null))];

  // Products with no curated equivalence class still deserve a substitution attempt. Two
  // tiers, both in queries.ts: `structuralCandidateIds` (same head noun — misses true synonyms
  // by construction) and `semanticCandidateIds` (embedding similarity, for exactly that recall
  // gap, gated by the same mutual-distinction check so a wider net doesn't mean a looser one).
  // Computed per product (not per line) since several lines can share a product, and merged
  // into one wider offer pool below.
  const noClass = products.filter((p) => p.equivalenceClassId == null);
  const candidatesByProduct = new Map<number, number[]>(
    await Promise.all(noClass.map(async (p) => {
      const [structural, semantic] = await Promise.all([
        structuralCandidateIds(p, BASKET_STRUCTURAL_TOLERANCE, { requireMutualDistinction: true }),
        semanticCandidateIds(p, BASKET_STRUCTURAL_TOLERANCE),
      ]);
      return [p.id, [...new Set([...structural, ...semantic])]] as [number, number[]];
    })),
  );
  const allStructuralIds = [...new Set([...candidatesByProduct.values()].flat())];

  const [ctx, offers] = await Promise.all([
    loadUserContext((await getCurrentUser())?.id ?? null, {
      preferPrivateLabel: body?.preferPrivateLabel === true,
      hasLoyaltyCards: body?.hasLoyaltyCards === true,
    }),
    loadOffers({ productIds: products.map((p) => p.id), classIds, structuralProductIds: allStructuralIds }),
  ]);

  const lines = items.map((item) => {
    const p = bySlug.get(item.slug);
    if (!p) {
      return {
        slug: item.slug, qty: item.qty, requestedName: item.slug,
        status: "UNAVAILABLE" as const, chosen: null, totalBani: 0,
        depositBani: 0, explanation: { headline: "Produs necunoscut.", tone: "warn" as const },
        canPinOriginal: false,
      };
    }
    // EQUIVALENT is the mode this view is for: "the closest available product at this shop".
    // A line the shopper pinned to EXACT stays pinned — that is a decision, not a default.
    const line: ListLine = {
      productId: p.id,
      qty: item.qty,
      substitutionMode: item.mode === "EXACT" ? "EXACT" : "EQUIVALENT",
      structuralCandidateProductIds: candidatesByProduct.get(p.id),
    };
    const r = resolveLine(line, merchant.id, ctx, offers);
    const explanation = explainResolution(r, merchant.name, p.unit);
    return {
      slug: item.slug,
      qty: item.qty,
      requestedName: p.name,
      status: r.status,
      chosen: r.offer
        ? {
            offerId: r.offer.id,
            productId: r.offer.product.id,
            name: r.offer.product.name,
            brand: r.offer.product.brand,
            priceBani: r.offer.priceBani,
            packs: r.quantityPlan[0]?.units ?? 1,
          }
        : null,
      totalBani: r.totalBani,
      // SGR is not part of the price and is refunded, but it is money handed over at the till.
      depositBani: 0,
      explanation,
      canPinOriginal: r.status === "SUBSTITUTED",
    };
  });

  // Deposits come from the chosen OFFER rows, which the engine does not carry.
  const chosenOfferIds = lines.map((l) => l.chosen?.offerId).filter((x): x is number => x != null);
  const extras = await loadOfferExtras(chosenOfferIds);
  for (const l of lines) {
    if (!l.chosen) continue;
    const e = extras.get(l.chosen.offerId);
    if (e?.depositBani) l.depositBani = e.depositBani * (e.containerCount ?? 1) * l.chosen.packs;
  }

  const goodsBani = lines.reduce((s, l) => s + l.totalBani, 0);
  const depositsBani = lines.reduce((s, l) => s + l.depositBani, 0);
  const freeOver = merchant.freeDeliveryOverBani;
  const deliveryBani =
    merchant.storeType === "physical" ? 0
      : freeOver != null && goodsBani >= freeOver ? 0
        : merchant.deliveryFeeBani;

  const found = lines.filter((l) => l.status !== "UNAVAILABLE").length;
  const substituted = lines.filter((l) => l.status === "SUBSTITUTED").length;

  const merchantRow = await prisma.merchant.findUnique({
    where: { slug: merchantSlug },
    select: { websiteUrl: true, priceChannel: true },
  });

  return NextResponse.json({
    merchant: {
      slug: merchant.slug, name: merchant.name, storeType: merchant.storeType,
      websiteUrl: merchantRow?.websiteUrl ?? null,
      priceChannel: merchantRow?.priceChannel ?? null,
      minOrderBani: merchant.minOrderBani,
      limitedCatalogNote: limitedCatalogNote(merchant.slug),
    },
    lines,
    summary: {
      itemCount: lines.length,
      found,
      substituted,
      unavailable: lines.length - found,
      goodsBani,
      depositsBani,
      deliveryBani,
      totalBani: goodsBani + depositsBani + deliveryBani,
      belowMinOrder: merchant.minOrderBani != null && goodsBani < merchant.minOrderBani,
    },
  });
}
