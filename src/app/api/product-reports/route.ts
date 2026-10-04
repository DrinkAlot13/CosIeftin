// "Prețul nu e corect sau pagina amestecă două produse?" — a shopper's report, as one of two
// DISTINCT kinds rather than one free-text box. The two point a reviewer at completely different
// places: a wrong PRICE is a scraper/parser problem, a wrong PRODUCT is a matcher problem
// (MatchOverride, equivalence classes). Collapsing them into one "something's wrong" bucket would
// cost the reviewer the first five minutes of every report just figuring out which kind it is.
//
//   POST { productSlug, kind: "wrong_price" | "wrong_product" | "other", note? }
//
// Anonymous reporting is allowed on purpose — requiring an account would suppress most of what
// this exists to collect.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { guard } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const KINDS = ["wrong_price", "wrong_product", "other"] as const;
type Kind = (typeof KINDS)[number];

function parseBody(raw: unknown): { productSlug: string; kind: Kind; note: string | null } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const productSlug = String(r.productSlug ?? "").trim();
  const kind = KINDS.includes(r.kind as Kind) ? (r.kind as Kind) : null;
  if (!productSlug || !kind) return null;
  const note = typeof r.note === "string" && r.note.trim() ? r.note.trim().slice(0, 500) : null;
  return { productSlug, kind, note };
}

export async function POST(req: NextRequest) {
  const limited = guard("write", req);
  if (limited) return limited;

  const body = parseBody(await req.json().catch(() => null));
  if (!body) return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });

  const product = await prisma.product.findUnique({ where: { slug: body.productSlug }, select: { id: true } });
  if (!product) return NextResponse.json({ error: "Produs necunoscut." }, { status: 404 });

  const user = await getCurrentUser();
  await prisma.productReport.create({
    data: { productId: product.id, userId: user?.id ?? null, kind: body.kind, note: body.note },
  });
  return NextResponse.json({ ok: true });
}
