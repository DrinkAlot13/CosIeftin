import { NextResponse, type NextRequest } from "next/server";
import { optimizeBasket, type ProductForBasket } from "@/lib/basket";
import { getBasketProducts } from "@/lib/queries";

export const dynamic = "force-dynamic";

// POST { items: [{ slug, qty }] } -> full basket optimization.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({ items: [] }));
  const raw = Array.isArray(body.items) ? body.items : [];
  const items = raw
    .map((r: { slug?: unknown; qty?: unknown }) => ({
      slug: String(r.slug ?? ""),
      qty: Math.max(1, Math.min(99, Number(r.qty) || 1)),
    }))
    .filter((r: { slug: string }) => r.slug);

  const slugs = [...new Set(items.map((i: { slug: string }) => i.slug))] as string[];
  const products = await getBasketProducts(slugs);
  const bySlug = new Map(products.map((p) => [p.slug, p]));

  const pfb: ProductForBasket[] = products.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    unit: p.unit,
    // THIS IS THE pool.map() PATTERN CLAUDE.md WARNS ABOUT. A narrower object literal is a
    // valid OfferForBasket, so the compiler cannot object when a field is left out — which is
    // how Metro and Mega Image lost productUrl and rawPriceText on every offer they wrote.
    // Anything added to OfferForBasket must be added here too, or it silently arrives as
    // undefined and the optimizer quietly prices the basket without it.
    offers: p.offers.map((o) => ({
      price: o.price,
      availability: o.availability,
      loyaltyPrice: o.loyaltyPrice,
      priceSource: o.priceSource,
      priceBani: o.priceBani,
      flagged: o.flagged,
      isStale: o.isStale,
      tiers: o.tiers,
      merchant: {
        id: o.merchant.id,
        slug: o.merchant.slug,
        name: o.merchant.name,
        color: o.merchant.color,
        storeType: o.merchant.storeType,
        deliveryFee: o.merchant.deliveryFee,
        freeDeliveryOver: o.merchant.freeDeliveryOver,
        minOrder: o.merchant.minOrder,
      },
    })),
  }));

  const input = items
    .map((i: { slug: string; qty: number }) => {
      const p = bySlug.get(i.slug);
      return p ? { productId: p.id, qty: i.qty } : null;
    })
    .filter(Boolean) as { productId: number; qty: number }[];

  // the shopper tells us whether they carry the loyalty cards; without it we must NOT
  // quote card prices, or every card store looks cheaper than it is for this shopper
  const result = optimizeBasket(pfb, input, { useLoyalty: Boolean(body.useLoyalty) });
  const found = new Set(products.map((p) => p.slug));
  const unknown = slugs.filter((s) => !found.has(s));
  return NextResponse.json({ ...result, unknown });
}
