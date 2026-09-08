// Withhold a wrong PAIRING — flag the offer and record the human decision. WRITES.
//
// A GATE DEFERS; IT NEVER DISCARDS (CLAUDE.md). So this does not delete the offer: it sets
// `flagged` with a reason, which takes it out of `currentOfferWhere` everywhere — page, search,
// counts, optimizer — while keeping the row, its price and its provenance for later. And it
// writes a `MatchOverride` reject so the next scrape does not simply re-create the pairing.
//
// Rejects are read PER PRODUCT for a merchant ("this shop's item does not belong on this
// product"), so this forbids exactly one pairing and leaves the merchant's other matches alone.
//
//   npm run withhold -- --offer=523430 --reason="..." --apply

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const arg = (k: string): string | undefined => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
  const apply = process.argv.includes("--apply");
  const offerId = Number(arg("offer"));
  const reason = arg("reason") ?? "withheld: wrong pairing";
  if (!Number.isFinite(offerId)) { console.error("--offer=<id> required"); process.exit(2); }

  const o = await prisma.offer.findUnique({
    where: { id: offerId },
    select: {
      id: true, priceBani: true, storeName: true, productUrl: true, url: true, flagged: true,
      merchant: { select: { id: true, slug: true } },
      product: { select: { id: true, name: true } },
    },
  });
  if (!o) { console.error(`no offer ${offerId}`); process.exit(1); }

  console.log(`offer ${o.id}  ${o.merchant.slug}  ${((o.priceBani ?? 0) / 100).toFixed(2)} lei`);
  console.log(`  shop calls it : ${JSON.stringify(o.storeName ?? "(none)")}`);
  console.log(`  sits on       : #${o.product.id} "${o.product.name}"`);
  console.log(`  already flagged: ${o.flagged}`);
  console.log(`  reason        : ${reason}`);

  // The other places this merchant's SAME article appears — so the withhold can be judged
  // against what it costs. Withholding a price that exists nowhere else is a different act.
  const key = (o.productUrl ?? o.url ?? "").split("/").pop() ?? "";
  if (key) {
    const siblings = await prisma.offer.findMany({
      where: { merchantId: o.merchant.id, productUrl: { contains: key }, NOT: { id: o.id } },
      select: { id: true, priceBani: true, product: { select: { id: true, name: true } } },
    });
    console.log(`\n  the same article also sits on ${siblings.length} other product(s):`);
    for (const s of siblings) console.log(`    #${s.product.id} "${s.product.name}" — offer ${s.id} at ${((s.priceBani ?? 0) / 100).toFixed(2)}`);
    if (siblings.length === 0) console.log(`    NONE — withholding this removes the merchant's only copy of this price.`);
  }

  if (!apply) { console.log(`\nDRY RUN — nothing written. Re-run with --apply.`); return; }

  await prisma.offer.update({ where: { id: o.id }, data: { flagged: true, flagReason: reason } });
  // storeKey must be stable and unique per merchant; the article id from the URL is both.
  const storeKey = key || `product-${o.product.id}`;
  await prisma.matchOverride.upsert({
    where: { merchantId_storeKey: { merchantId: o.merchant.id, storeKey } },
    update: { productId: o.product.id, decision: "reject", note: reason },
    create: { merchantId: o.merchant.id, storeKey, productId: o.product.id, decision: "reject", note: reason },
  });
  console.log(`\n✓ offer ${o.id} withheld (flagged, not deleted) and the pairing rejected for future scrapes.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
