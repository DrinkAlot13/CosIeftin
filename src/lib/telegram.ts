// Telegram notifications for price alerts.
//
// WHY Telegram: penetration in Romania is far higher than email open rates or web push,
// and it needs no app install from us — the shopper just messages the bot once.
//
// SETUP (not active until these exist):
//   1. Create a bot with @BotFather → get the token
//   2. TELEGRAM_BOT_TOKEN=... in .env
//   3. Point the webhook at your deployment:
//        curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<host>/api/telegram"
//   4. TELEGRAM_WEBHOOK_SECRET=... (any random string) and pass it as
//        &secret_token=... on setWebhook, so only Telegram can call the route.
//
// Without a token every send is a no-op that returns false — nothing is ever sent by
// accident, and the nightly job stays safe to run.

const API = "https://api.telegram.org";

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

/** Send one message. Returns false (without throwing) when unconfigured or on API error. */
export async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch(`${API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: false }),
    });
    if (!res.ok) {
      console.error(`[telegram] ${res.status} ${(await res.text()).slice(0, 160)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[telegram] ${(e as Error).message}`);
    return false;
  }
}

/** Escape user/product text for Telegram HTML parse mode. */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The message a shopper gets when a watched product drops. */
export function priceDropMessage(opts: {
  productName: string;
  productUrl: string;
  oldPrice: number;
  newPrice: number;
  storeName: string;
}): string {
  const pct = opts.oldPrice > 0 ? Math.round(((opts.oldPrice - opts.newPrice) / opts.oldPrice) * 100) : 0;
  return [
    `📉 <b>${esc(opts.productName)}</b> s-a ieftinit!`,
    ``,
    `${opts.newPrice.toFixed(2)} lei la <b>${esc(opts.storeName)}</b>`,
    `<s>${opts.oldPrice.toFixed(2)} lei</s> — economisești ${(opts.oldPrice - opts.newPrice).toFixed(2)} lei (${pct}%)`,
    ``,
    opts.productUrl,
  ].join("\n");
}
