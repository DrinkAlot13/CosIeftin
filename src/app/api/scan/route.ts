// GET ?ean=XXXXXXXXXXXXX -> { found: true, slug, name } | { found: false }
//
// For the barcode-scan UI (/scanare), NOT the public v1 API — this is a simple unique-index
// lookup on Product.ean, not the fuzzy name+size matcher /api/v1/lookup runs, so it needs none
// of that route's scoring machinery.
//
// 23.7% of the catalog carries an EAN (measured, not assumed) — `found: false` is the EXPECTED,
// common case, not an error. The caller must never read it as "this product does not exist".
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { parseEan } from "@/lib/product/ean";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("ean") ?? "";
  const ean = parseEan(raw);
  if (!ean) return NextResponse.json({ found: false, reason: "invalid-ean" });

  const product = await prisma.product.findUnique({ where: { ean }, select: { slug: true, name: true } });
  if (!product) return NextResponse.json({ found: false, reason: "not-in-catalog" });
  return NextResponse.json({ found: true, slug: product.slug, name: product.name });
}
