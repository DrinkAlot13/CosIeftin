// Check every active price watch and notify the shopper on Telegram when their product
// drops. Runs after the nightly scrape, when prices have just changed.
//
// Safe by default: with no TELEGRAM_BOT_TOKEN nothing is sent — the job reports what it
// WOULD send and exits. Use DRY_RUN=1 to force that behaviour even when configured.
//
// Run: npm run notify:alerts

import { prisma } from "../src/lib/db";
import { sendTelegram, telegramConfigured, priceDropMessage } from "../src/lib/telegram";
import { siteUrl } from "../src/lib/config/siteUrl";

// One accessor, shared with the web app. This file used to default to
// "https://cosmic.ro" while seo.ts defaulted to localhost.
const SITE = siteUrl();
// don't re-notify the same watch more often than this
const COOLDOWN_H = 20;

async function main() {
  const dry = Boolean(process.env.DRY_RUN) || !telegramConfigured();
  if (dry) console.log("[notify] DRY RUN — no messages will be sent (no TELEGRAM_BOT_TOKEN or DRY_RUN=1)\n");

  const alerts = await prisma.priceAlert.findMany({
    where: { active: true },
    include: {
      product: {
        select: {
          name: true,
          slug: true,
          offers: {
            where: { availability: "in stock", flagged: false },
            select: { price: true, merchant: { select: { name: true } } },
            orderBy: { price: "asc" },
            take: 1,
          },
        },
      },
    },
  });

  let fired = 0;
  let sent = 0;
  const now = Date.now();
  for (const a of alerts) {
    const best = a.product.offers[0];
    if (!best || !(best.price > 0)) continue;

    // A target price means "tell me when it's at or below X"; without one, any real drop.
    const hitTarget = a.targetPrice != null && best.price <= a.targetPrice;
    const dropped = a.targetPrice == null && best.price < a.basePrice * 0.97; // >3% drop
    if (!hitTarget && !dropped) continue;

    if (a.lastNotifiedAt && now - a.lastNotifiedAt.getTime() < COOLDOWN_H * 3600e3) continue;
    fired++;

    const msg = priceDropMessage({
      productName: a.product.name,
      // ?add=1: AddToList.tsx adds the product to the shopper's list on landing, one tap from
      // "it's cheaper now" to "it's in my list" instead of a link that only confirms the price.
      productUrl: `${SITE}/p/${a.product.slug}?add=1`,
      oldPrice: a.basePrice,
      newPrice: best.price,
      storeName: best.merchant.name,
    });

    if (dry) {
      console.log(`  → chat ${a.chatId}: ${a.product.name} ${a.basePrice} → ${best.price} lei (${best.merchant.name})`);
      continue;
    }
    if (await sendTelegram(a.chatId, msg)) {
      sent++;
      // reset the reference so the next notification needs a fresh drop
      await prisma.priceAlert.update({ where: { id: a.id }, data: { lastNotifiedAt: new Date(), basePrice: best.price } });
    }
  }

  console.log(`\n[notify] ${alerts.length} watches, ${fired} triggered, ${dry ? 0 : sent} sent${dry ? " (dry run)" : ""}.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
