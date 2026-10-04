// "Propune un echivalent" — a signed-in shopper's claim that two products are the same purchase.
//
//   POST { productSlug, suggestedSlug, note? } -> queue a PENDING suggestion
//
// This is the scaling answer to equivalence curation: every class shipped this session was found
// by one person reading the catalog category by category, which does not scale past what one
// person can read in a sitting (`propose:class-opportunities` found 2,022 candidate groups; a
// careful read turned up 21 real classes from 60 "plausible" ones — most of the work was READING,
// which a shopper who actually buys both products has already done).
//
// NOT auto-applied. `scripts/review-equivalence-suggestions.ts` lists PENDING rows for a human
// to confirm or reject — same posture as `MatchOverride` and the dry-run default on
// `propose:equivalence`. See the model's own doc comment in schema.prisma for why.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { guard } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function parseBody(raw: unknown): { productSlug: string; suggestedSlug: string; note: string | null } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const productSlug = String(r.productSlug ?? "").trim();
  const suggestedSlug = String(r.suggestedSlug ?? "").trim();
  if (!productSlug || !suggestedSlug) return null;
  const note = typeof r.note === "string" && r.note.trim() ? r.note.trim().slice(0, 500) : null;
  return { productSlug, suggestedSlug, note };
}

export async function POST(req: NextRequest) {
  const limited = guard("write", req);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Trebuie să fii autentificat." }, { status: 401 });

  const body = parseBody(await req.json().catch(() => null));
  if (!body) return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });
  if (body.productSlug === body.suggestedSlug) {
    return NextResponse.json({ error: "Un produs nu poate fi echivalentul lui însuși." }, { status: 400 });
  }

  const [a, b] = await Promise.all([
    prisma.product.findUnique({ where: { slug: body.productSlug }, select: { id: true } }),
    prisma.product.findUnique({ where: { slug: body.suggestedSlug }, select: { id: true } }),
  ]);
  if (!a || !b) return NextResponse.json({ error: "Produs necunoscut." }, { status: 404 });

  // Unordered pair, normalized here (the @@unique index can't do this itself) so (A,B) and
  // (B,A) are recognised as the same claim regardless of which product page it was made from.
  const [productAId, productBId] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];

  const existing = await prisma.equivalenceSuggestion.findUnique({
    where: { productAId_productBId: { productAId, productBId } },
  });
  if (existing) {
    return NextResponse.json({
      ok: true,
      alreadyExists: true,
      status: existing.status,
    });
  }

  await prisma.equivalenceSuggestion.create({
    data: { productAId, productBId, userId: user.id, note: body.note },
  });
  return NextResponse.json({ ok: true, alreadyExists: false, status: "PENDING" });
}
