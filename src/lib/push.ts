// Web Push — real-time "this favourite just dropped" notifications, a third channel alongside
// Telegram (lib/telegram.ts) and e-mail (lib/email.ts), same "unconfigured = safe no-op" shape
// as both: without VAPID keys, nothing is ever sent and nothing throws.
//
// SETUP: generate a keypair once with
//   node -e "console.log(require('web-push').generateVAPIDKeys())"
// and set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT in .env. The public key is also
// served to the browser (GET /api/push/public-key) — it is not a secret, it is how the browser
// proves to its own push service which site it is subscribing on behalf of.
import webpush from "web-push";
import { prisma } from "@/lib/db";

/**
 * Re-checked on every call rather than cached — unlike auth.ts's session secret, there is no
 * cost to re-reading two env vars, and caching here would mean a test (or a `.env` reload)
 * that changes these mid-process keeps reporting the FIRST answer forever.
 */
export function pushConfigured(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@cosieftin.ro", pub, priv);
  return true;
}

export function vapidPublicKey(): string | null {
  return pushConfigured() ? (process.env.VAPID_PUBLIC_KEY ?? null) : null;
}

/**
 * Send one push notification. Returns false (never throws) when unconfigured, and SILENTLY
 * DELETES the subscription on a 404/410 — the browser's own push service is telling us the
 * endpoint is dead (permission revoked, browser data cleared, uninstalled), and a subscription
 * table that only ever grows would eventually be mostly corpses, same shape as
 * `scripts/withhold-flyer-fanout.ts`'s "a script that assigns must be able to unassign".
 */
export async function sendPush(
  sub: { id: number; endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; url: string },
): Promise<boolean> {
  if (!pushConfigured()) {
    console.log(`[push] VAPID not set — would have sent "${payload.title}" to subscription #${sub.id}`);
    return false;
  }
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    );
    return true;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
    } else {
      console.error(`[push] send failed (status ${status ?? "?"}): ${(e as Error).message}`);
    }
    return false;
  }
}
