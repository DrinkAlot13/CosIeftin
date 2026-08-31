import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getAlternatives, type Strictness } from "@/lib/queries";

export const dynamic = "force-dynamic";

// POST { slugs: string[], strictness?: "same-brand" | "equivalent" } -> { [slug]: { slug, name, brand, lowest, store } | null }
// The top similar item (same type + size) for each cart item, so single-shop items get
// a suggested substitute the shopper can buy elsewhere.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({ slugs: [] }));
  const slugs = (Array.isArray(body.slugs) ? body.slugs : []).map(String).slice(0, 60);
  // the shopper decides how far we may substitute (brand loyalty is real)
  const strictness: Strictness = body.strictness === "same-brand" ? "same-brand" : "equivalent";
  const products = await prisma.product.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });

  const out: Record<string, { slug: string; name: string; brand: string | null; lowest: number; store: string | null } | null> = {};
  for (const p of products) {
    const alts = await getAlternatives(p.id, 3, strictness);
    const top = alts[0];
    if (!top) {
      out[p.slug] = null;
      continue;
    }
    const cheapest = [...top.offers].filter((o) => o.availability === "in stock").sort((a, b) => a.price - b.price)[0] ?? [...top.offers].sort((a, b) => a.price - b.price)[0];
    out[p.slug] = { slug: top.slug, name: top.name, brand: top.brand, lowest: top.summary.lowest, store: cheapest?.merchant.name ?? null };
  }
  return NextResponse.json(out);
}
