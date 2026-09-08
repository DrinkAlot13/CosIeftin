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
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Hand-validated, matching every other route here: Zod is not installed and CLAUDE.md forbids
 * adding a dependency without asking. One field, checked.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // STILL 204 WHEN RATE-LIMITED, and deliberately so. Everywhere else a 429 tells the caller to
  // back off; here the caller is a shopper whose item is already in their cart, and the contract
  // at the top of this file is that this endpoint's failure is never their problem. Returning an
  // error would surface a red toast for something they did not do wrong. The counter simply does
  // not move — which is exactly what the limit is for.
  const ip = clientIp(req.headers);
  if (!rateLimit("listAdd", ip).ok) return new NextResponse(null, { status: 204 });

  const raw = await req.json().catch(() => null);
  if (typeof raw === "object" && raw !== null) {
    const productId = Number((raw as Record<string, unknown>).productId);
    // The IP is passed through, never stored: `recordListAdd` hashes it with a per-process salt
    // to cap one caller's contribution to one product. See `lib/list-adds.ts`.
    if (Number.isInteger(productId) && productId > 0) await recordListAdd(productId, ip);
  }
  return new NextResponse(null, { status: 204 });
}
