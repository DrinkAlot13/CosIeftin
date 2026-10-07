// Real-time push: "one of your favourites just dropped", the moment the nightly price compute
// finds it — not Monday's digest, not the next time the shopper happens to open the site.
//
// WHY A SEPARATE THRESHOLD AND DE-DUP FROM THE DIGEST. notify-digest.ts reports ANY drop once a
// week; a push fires immediately, so it needs its own bar or a 2% wobble would buzz someone's
// phone every night. DROP_THRESHOLD_PCT is deliberately higher than "any drop at all", and
// `UserFavorite.lastPushedPriceBani` suppresses re-firing on the SAME drop every night it stays
// dropped — only a price that falls FURTHER below what was already pushed fires again. Without
// this, a product sitting 15% down for three weeks would push every single night.
//
// Safe by default: with no VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY, sendPush logs and returns false —
// nothing is ever sent by accident, same posture as notify-alerts.ts and TELEGRAM_BOT_TOKEN.
//
// Run: npm run notify:push

import { prisma } from "../src/lib/db";
import { sendPush } from "../src/lib/push";
import { listFavourites } from "../src/lib/favourites";
import { currentOfferWhere } from "../src/lib/queries";
import { absoluteUrl } from "../src/lib/config/siteUrl";

const DROP_THRESHOLD_PCT = 10;

const baniOf = (o: { price: number; priceBani: number | null }): number => o.priceBani ?? Math.round(o.price * 100);

async function lowestLiveBani(productId: number): Promise<number | null> {
  const offers = await prisma.offer.findMany({ where: { productId, ...currentOfferWhere() }, select: { price: true, priceBani: true } });
  if (offers.length === 0) return null;
  return Math.min(...offers.map(baniOf));
}

async function main() {
  const userIds = (await prisma.pushSubscription.findMany({ select: { userId: true }, distinct: ["userId"] })).map((r) => r.userId);
  console.log(`[push] ${userIds.length} account(s) with at least one push subscription.`);

  let fired = 0;
  let sent = 0;
  for (const userId of userIds) {
    const favourites = await listFavourites(userId);
    const candidates = favourites.filter((f) => (f.dropPct ?? 0) >= DROP_THRESHOLD_PCT);
    if (candidates.length === 0) continue;

    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    for (const f of candidates) {
      const nowBani = await lowestLiveBani(f.productId);
      if (nowBani == null) continue;
      const existing = await prisma.userFavorite.findUnique({ where: { userId_productId: { userId, productId: f.productId } }, select: { lastPushedPriceBani: true } });
      if (existing?.lastPushedPriceBani != null && nowBani >= existing.lastPushedPriceBani) continue; // already pushed this drop, not further
      fired++;

      const payload = { title: "S-a ieftinit!", body: `${f.name} — acum ${(nowBani / 100).toFixed(2)} lei (-${f.dropPct!.toFixed(0)}%)`, url: absoluteUrl(`/p/${f.slug}`) };
      let anySent = false;
      for (const sub of subs) {
        if (await sendPush(sub, payload)) anySent = true;
      }
      if (anySent) {
        sent++;
        await prisma.userFavorite.update({ where: { userId_productId: { userId, productId: f.productId } }, data: { lastPushedPriceBani: nowBani } });
      }
    }
  }

  console.log(`[push] ${fired} drop(s) qualified, ${sent} notification(s) actually sent.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
