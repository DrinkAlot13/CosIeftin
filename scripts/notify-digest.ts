// Weekly savings-and-price-drop digest, by e-mail, to any shopper who added an address.
//
// WHY WEEKLY, AND WHY GATED HERE RATHER THAN IN A SEPARATE CRON. `nightly.ts` runs every night;
// a digest sent every night is a newsletter nobody asked for and the fastest way to make
// someone remove their e-mail. The gate is a day-of-week check, same shape as
// `backfill-expired-offers.ts` being safe to run nightly even though it only ever has work on
// SOME nights — the step costs nothing on the nights it has nothing to do.
//
// Safe by default: with no SMTP_HOST, `sendEmail` logs and returns false — nothing is ever sent
// by accident, same posture as notify-alerts.ts and TELEGRAM_BOT_TOKEN.
//
// Run: npm run notify:digest   (FORCE_DIGEST=1 to bypass the day-of-week gate, for testing)

import { prisma } from "../src/lib/db";
import { emailShell, sendEmail } from "../src/lib/email";
import { listFavourites } from "../src/lib/favourites";
import { monthlySavingsBani } from "../src/lib/savings";
import { absoluteUrl } from "../src/lib/config/siteUrl";

const DIGEST_DAY = 1; // Monday — see getDay(): 0=Sunday..6=Saturday

async function main() {
  const today = new Date();
  if (today.getDay() !== DIGEST_DAY && !process.env.FORCE_DIGEST) {
    console.log(`[digest] not digest day (today=${today.getDay()}, digest day=${DIGEST_DAY}) — skipping. Set FORCE_DIGEST=1 to override.`);
    return;
  }

  const users = await prisma.user.findMany({
    where: { email: { not: null } },
    select: { id: true, username: true, email: true, pushSubscriptions: { select: { id: true }, take: 1 } },
  });
  console.log(`[digest] ${users.length} account(s) with an e-mail on file.`);

  let sent = 0;
  let skipped = 0;
  for (const u of users) {
    if (!u.email) continue; // narrows the type; the where-clause already guarantees this

    const [favourites, monthBani] = await Promise.all([listFavourites(u.id), monthlySavingsBani(u.id)]);
    const dropped = favourites.filter((f) => (f.dropPct ?? 0) > 0).slice(0, 5);
    // Cross-promote push ONLY to someone who does not already have it — a shopper who already
    // enabled push does not need to be told to go enable the thing they already enabled, every
    // single week.
    const hasPush = u.pushSubscriptions.length > 0;

    // NOTHING TO SAY IS A REASON TO STAY QUIET, NOT TO SEND AN EMPTY EMAIL. A digest with zero
    // drops and zero savings this month would train the recipient to stop opening it.
    if (dropped.length === 0 && monthBani === 0) { skipped++; continue; }

    const rows = dropped
      .map((f) => `<li><a href="${absoluteUrl(`/p/${f.slug}`)}">${f.name}</a> — s-a ieftinit ${f.dropPct!.toFixed(0)}%</li>`)
      .join("");
    const html = emailShell(`
      <p>Salut, ${u.username}!</p>
      ${monthBani > 0 ? `<p>Ai economisit <b>${(monthBani / 100).toFixed(2)} lei</b> luna asta comparând prețurile.</p>` : ""}
      ${dropped.length > 0 ? `<p>Produse favorite care s-au ieftinit:</p><ul>${rows}</ul>` : ""}
      <p><a href="${absoluteUrl("/lista")}">Vezi lista mea</a></p>
      ${!hasPush ? `<p style="color:#666;font-size:13px;">Vrei să afli mai rapid, chiar în ziua în care se ieftinește? <a href="${absoluteUrl("/cont")}">Activează notificările</a> din pagina de cont.</p>` : ""}
    `);
    const text = [
      `Salut, ${u.username}!`,
      monthBani > 0 ? `Ai economisit ${(monthBani / 100).toFixed(2)} lei luna asta comparând prețurile.` : "",
      dropped.length > 0 ? `Produse favorite care s-au ieftinit:\n${dropped.map((f) => `- ${f.name} (-${f.dropPct!.toFixed(0)}%)`).join("\n")}` : "",
      absoluteUrl("/lista"),
      !hasPush ? `Vrei să afli mai rapid? Activează notificările din pagina de cont: ${absoluteUrl("/cont")}` : "",
    ].filter(Boolean).join("\n\n");

    const ok = await sendEmail({ to: u.email, subject: "Rezumatul tău săptămânal — CosIeftin", html, text });
    if (ok) sent++;
  }

  console.log(`[digest] ${sent} sent, ${skipped} skipped (nothing to report).`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
