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

/**
 * Record one add. Never throws: the cart is what the shopper asked for and the counter is a
 * convenience, so a failed count must not surface as a failed add.
 */
export async function recordListAdd(productId: number): Promise<void> {
  if (!Number.isInteger(productId) || productId <= 0) return;
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
