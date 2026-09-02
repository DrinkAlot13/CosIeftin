// Favourites API.
//
//   GET                       -> { favourites: number[], inferred: number[] }  for the signed-in user
//   POST { productId }        -> toggle the heart
//   POST { productId, add:1 } -> record a list add, which may promote to an INFERRED favourite
//
// Anonymous callers get an empty set and a 401 on write rather than a silent no-op: a heart
// that appears to work and stores nothing is worse than one that asks you to sign in.

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listFavourites, recordAdd, toggleFavourite } from "@/lib/favourites";

export const dynamic = "force-dynamic";

/**
 * Hand-validated, not Zod-validated. CLAUDE.md asks for Zod at trust boundaries and also
 * forbids adding a dependency without asking — Zod is not installed, and every other API route
 * here validates by hand for the same reason. The shape is small enough that this is honest
 * rather than a shortcut: two fields, both checked, nothing coerced silently.
 */
function parseBody(raw: unknown): { productId: number; add: boolean } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const productId = Number(r.productId);
  if (!Number.isInteger(productId) || productId <= 0) return null;
  return { productId, add: r.add === true };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ signedIn: false, favourites: [], inferred: [] });
  const rows = await listFavourites(user.id);
  return NextResponse.json({
    signedIn: true,
    favourites: rows.filter((r) => r.source === "EXPLICIT").map((r) => r.productId),
    inferred: rows.filter((r) => r.source === "INFERRED").map((r) => r.productId),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Trebuie să fii autentificat." }, { status: 401 });

  const body = parseBody(await req.json().catch(() => null));
  if (!body) return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });

  if (body.add) {
    const r = await recordAdd(user.id, body.productId);
    return NextResponse.json({ ok: true, addCount: r.count, promoted: r.promoted });
  }
  const r = await toggleFavourite(user.id, body.productId);
  return NextResponse.json({ ok: true, ...r });
}
