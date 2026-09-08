// "How often is this product added to a list?" — recorded for EVERYONE, including anonymous
// visitors, because otherwise it is recorded for nobody.
//
// The gap this closes: carts live in localStorage and `POST /api/favorites` returns 401 to
// anonymous callers, so with no accounts in use every add by every visitor went nowhere.
// GroceryList and GroceryListItem are both empty, which is why "most added" could not be
// answered at all and why ranking fell back to offer count — a circular measure that selects
// for products which are already comparable and duly reports 100%.
//
// WHAT IS STORED, AND WHAT DELIBERATELY IS NOT.
//
//   stored:     productId, a running total, and the date of the most recent add.
//   NOT stored: who, when individually, from where, in what session, with what else.
//
// One row per product, updated in place. There is no event log, so nothing here can be joined
// back to a person even in principle — which is strictly less than the shopping list the
// visitor already keeps in their own browser.

import { prisma } from "./db";
import { createHash } from "node:crypto";

/**
 * ── ONE VISITOR MAY NOT RANK A PRODUCT ON THEIR OWN.
 *
 * `adds` drives "most added" on the homepage, and the endpoint that increments it is an
 * unbounded anonymous write. A shell loop could put any product at the top of the site.
 *
 * The cap is per (caller, product): after this many, further adds from the same caller are
 * accepted by the API and simply not counted. The shopper's cart is unaffected — that lives in
 * their browser — so there is nothing to tell them and nothing that can go wrong for them.
 *
 * WHAT IS REMEMBERED, and why it is not a privacy regression. This module's contract is that
 * nothing stored can be joined back to a person "even in principle", and that still holds: the
 * key below is a SHA-256 of the address with a per-process random salt, held in memory only,
 * never written to the database, and unrecoverable after a restart because the salt is gone.
 * It is a de-duplication token, not an identity.
 *
 * It is also, deliberately, only as good as the rate limiter it sits beside: a caller whose
 * address we cannot see shares one bucket, and a caller who rotates addresses gets a fresh cap
 * each time. See `lib/rate-limit.ts`, which says the same thing at more length.
 */
export const MAX_ADDS_PER_CALLER_PER_PRODUCT = 3;

/** Random per process, never persisted: the hashes below cannot outlive it or be reversed. */
const SALT = createHash("sha256").update(`${process.pid}:${Math.random()}:${Date.now()}`).digest("hex");
/** Bounded so a caller rotating addresses cannot turn this into a memory leak. */
const MAX_TOKENS = 200_000;
const seen = new Map<string, number>();

function callerToken(ip: string | null, productId: number): string {
  return createHash("sha256").update(`${SALT}:${ip ?? "shared"}:${productId}`).digest("hex").slice(0, 32);
}

/** True when this caller has room left to move this product's counter. */
export function callerMayCount(ip: string | null, productId: number): boolean {
  const t = callerToken(ip, productId);
  const n = seen.get(t) ?? 0;
  if (n >= MAX_ADDS_PER_CALLER_PER_PRODUCT) return false;
  if (seen.size >= MAX_TOKENS && !seen.has(t)) {
    // Full. Refusing to count is the safe direction: an uncounted add understates a ranking,
    // an uncapped one lets a single caller invent it.
    return false;
  }
  seen.set(t, n + 1);
  return true;
}

/** Tests only. */
export function __resetCallerCountsForTest(): void {
  seen.clear();
}

/**
 * Record one add. Never throws: the cart is what the shopper asked for and the counter is a
 * convenience, so a failed count must not surface as a failed add.
 */
export async function recordListAdd(productId: number, ip: string | null = null): Promise<void> {
  if (!Number.isInteger(productId) || productId <= 0) return;
  // Per-caller cap. The add still succeeded for the shopper; it just does not move the ranking.
  if (!callerMayCount(ip, productId)) return;
  try {
    await prisma.productAddCount.upsert({
      where: { productId },
      update: { adds: { increment: 1 }, lastAddedAt: new Date() },
      create: { productId, adds: 1, lastAddedAt: new Date() },
    });
  } catch {
    // A product id that does not exist fails the foreign key. That is the correct outcome and
    // not worth an error page.
  }
}

export type TopAdded = { productId: number; name: string; slug: string; adds: number };

/** The ranking this table exists to make possible. Empty until people actually use the site. */
export async function topAdded(limit = 50): Promise<TopAdded[]> {
  const rows = await prisma.productAddCount.findMany({
    orderBy: { adds: "desc" },
    take: limit,
    select: { productId: true, adds: true, product: { select: { name: true, slug: true } } },
  });
  return rows.map((r) => ({ productId: r.productId, adds: r.adds, name: r.product.name, slug: r.product.slug }));
}
