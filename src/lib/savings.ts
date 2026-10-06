// "How much has comparing saved you" — answered as a SNAPSHOT recorded at the moment a shopper
// adds a product to their list, never recomputed later from today's prices. See
// `SavingsEvent`'s own schema comment: today's spread is not the spread that existed when the
// add happened, and presenting one as the other is exactly the "default presented as an
// observation" shape this project has hit before.
import { prisma } from "@/lib/db";
import { currentOfferWhere } from "@/lib/queries";

// Same one-line fallback every other price reader in this codebase uses (queries.ts,
// outlier.ts, basket.ts, bulk-tiers.ts, …) — not reused from any of them because each exports
// it typed against its own wider offer shape, and the only thing needed here is these two
// fields.
const baniOf = (o: { price: number; priceBani: number | null }): number => o.priceBani ?? Math.round(o.price * 100);

/**
 * Record what comparing was worth for this add, if anything. A product with only one live
 * offer has nothing to compare — no event is written, the same way a single-offer product
 * carries no spread elsewhere in this codebase (see outlier.ts's MIN_OFFERS_FOR_MEDIAN comment
 * for the same "two is not enough to say anything" reasoning, though here even two is enough:
 * a spread needs only a high and a low, not a median).
 *
 * Never throws — called fire-and-forget from the add path, same posture as `recordAdd` itself.
 */
export async function recordSavingsEvent(userId: number, productId: number, at = new Date()): Promise<void> {
  try {
    const offers = await prisma.offer.findMany({
      where: { productId, ...currentOfferWhere(at) },
      select: { price: true, priceBani: true },
    });
    if (offers.length < 2) return;
    const prices = offers.map(baniOf).filter((b) => b > 0);
    if (prices.length < 2) return;
    const amountBani = Math.max(...prices) - Math.min(...prices);
    if (amountBani <= 0) return;
    await prisma.savingsEvent.create({ data: { userId, productId, amountBani, occurredAt: at } });
  } catch (e) {
    console.error(`[savings] record failed: ${(e as Error).message}`);
  }
}

/** Sum of recorded savings events for this user within [from, to). */
export async function monthlySavingsBani(userId: number, now = new Date()): Promise<number> {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const rows = await prisma.savingsEvent.aggregate({
    where: { userId, occurredAt: { gte: from, lt: to } },
    _sum: { amountBani: true },
  });
  return rows._sum.amountBani ?? 0;
}
