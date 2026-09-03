// POST { productId } -> increment that product's add counter. Always 204.
//
// SEPARATE FROM /api/favorites ON PURPOSE. A favourite is per-user and rightly 401s an
// anonymous caller: a heart that appears to work and stores nothing is worse than one that asks
// you to sign in. An add COUNT is an anonymous aggregate and must accept everyone, or it
// measures only the people who happened to have accounts — which, on this site, is nobody.
//
// Deliberately returns 204 whatever happens. The client has already put the item in its cart;
// this endpoint's failure is not the shopper's problem and must not become a visible error.

import { NextResponse, type NextRequest } from "next/server";
import { recordListAdd } from "@/lib/list-adds";

export const dynamic = "force-dynamic";

/**
 * Hand-validated, matching every other route here: Zod is not installed and CLAUDE.md forbids
 * adding a dependency without asking. One field, checked.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const raw = await req.json().catch(() => null);
  if (typeof raw === "object" && raw !== null) {
    const productId = Number((raw as Record<string, unknown>).productId);
    if (Number.isInteger(productId) && productId > 0) await recordListAdd(productId);
  }
  return new NextResponse(null, { status: 204 });
}
