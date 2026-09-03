// A REJECTED pairing must survive the next scrape. Against the real database, on purpose.
//
// THE BUG. `MatchOverride` keyed its rejects on `slugify(storeName)`, and that field is not
// stable between runs: Freshful's "Mici din carne de porc și vită 500g" came back as "Mici din
// carne de vită și oaie 500g". Three of five reject keys stopped matching, the reject was
// consulted and MISSED, and a pairing a human had refused went live again.
//
// A pure unit test could not have caught it — the key was computed correctly, from a value that
// had changed. So this test does the thing that actually failed: it writes a reject, runs a
// real match over a real pool, and asserts the pairing did not come back.

import { describe, it, expect } from "./run";
import { prisma } from "../src/lib/db";
import { matchPoolToCatalog, slugify, type StoreProduct } from "../src/lib/scrape-util";
import { reassertStandingDecisions, rejectedPairs } from "../src/lib/standing-decisions";

const SLUG = "test-standing-decisions";

async function scratchMerchant(): Promise<number> {
  const m = await prisma.merchant.upsert({
    where: { slug: SLUG },
    update: { active: true },
    create: { slug: SLUG, name: "Test Standing Decisions", websiteUrl: "https://example.invalid", active: true },
    select: { id: true },
  });
  return m.id;
}

async function cleanup(merchantId: number): Promise<void> {
  // Children first — an Offer carries PriceHistory and BulkTier rows, and the delete is
  // refused rather than cascading. The scratch merchant must leave nothing behind: this test
  // runs against the real database, and a stray merchant would show up in the liveness audit
  // as a source that has never written.
  const offers = await prisma.offer.findMany({ where: { merchantId }, select: { id: true } });
  const ids = offers.map((o) => o.id);
  if (ids.length) {
    await prisma.priceHistory.deleteMany({ where: { offerId: { in: ids } } });
    await prisma.bulkTier.deleteMany({ where: { offerId: { in: ids } } });
    await prisma.priceAnomaly.deleteMany({ where: { offerId: { in: ids } } });
  }
  await prisma.matchOverride.deleteMany({ where: { merchantId } });
  await prisma.pendingMatch.deleteMany({ where: { merchantId } });
  await prisma.priceAnomaly.deleteMany({ where: { merchantId } });
  await prisma.scraperRun.deleteMany({ where: { merchantId } });
  await prisma.offer.deleteMany({ where: { merchantId } });
  await prisma.merchant.deleteMany({ where: { id: merchantId } });
}

function pool(name: string): StoreProduct[] {
  return [{
    name, brand: "", price: 9.99, available: true,
    url: "https://example.invalid/x", image: null,
    rawPriceText: "9,99 lei", productUrl: "https://example.invalid/x",
  }];
}

describe("a REJECTED pairing survives the next scrape", () => {
  it("does not come back when the store name CHANGES between runs", async () => {
    const merchantId = await scratchMerchant();
    try {
      // Run one: create the offer and find out which product it attached to.
      await matchPoolToCatalog(merchantId, pool("Lapte de consum integral Olympus 3.7% 1 l"), { addNew: true, label: SLUG });
      const first = await prisma.offer.findFirst({ where: { merchantId }, select: { productId: true, storeName: true } });
      expect(first !== null).toBeTruthy();
      const productId = first!.productId;

      // A human rejects that pairing, keyed the way the app keys it — on the store NAME.
      await prisma.matchOverride.create({
        data: { merchantId, productId, storeKey: slugify(first!.storeName ?? "x"), decision: "reject", note: "test" },
      });

      // Run two: the SAME item, renamed by the merchant. This is exactly what Freshful did, and
      // it is what made the old key stop matching.
      await matchPoolToCatalog(merchantId, pool("Lapte integral Olympus, 3,7% grasime, 1 litru"), { addNew: true, label: SLUG });

      const live = await prisma.offer.findFirst({
        where: { merchantId, productId, flagged: false },
        select: { id: true },
      });
      expect(live).toBe(null); // withheld, not published — the whole point
    } finally {
      await cleanup(merchantId);
    }
  });

  it("reads a reject by PRODUCT, so a renamed store item is still covered", async () => {
    const merchantId = await scratchMerchant();
    try {
      await prisma.matchOverride.create({
        data: { merchantId, productId: 1, storeKey: "a-name-that-will-change", decision: "reject", note: "test" },
      });
      const set = await rejectedPairs(merchantId);
      expect(set.has(1)).toBeTruthy();
    } finally {
      await cleanup(merchantId);
    }
  });

  it("re-asserting is idempotent and reports what it withheld", async () => {
    const merchantId = await scratchMerchant();
    try {
      await matchPoolToCatalog(merchantId, pool("Lapte de consum integral Olympus 3.7% 1 l"), { addNew: true, label: SLUG });
      const o = await prisma.offer.findFirst({ where: { merchantId }, select: { productId: true } });
      await prisma.matchOverride.create({
        data: { merchantId, productId: o!.productId, storeKey: "whatever", decision: "reject", note: "test" },
      });
      const first = await reassertStandingDecisions(merchantId);
      expect(first.rejected).toBe(1);
      // Running it again must find nothing left to do rather than double-count.
      const second = await reassertStandingDecisions(merchantId);
      expect(second.rejected).toBe(0);
    } finally {
      await cleanup(merchantId);
    }
  });
});
