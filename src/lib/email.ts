// Transactional email — password reset and the weekly savings digest.
//
// WHY THIS EXISTS NOW, AND WHY IT DID NOT BEFORE. Until 2026-10-07 this app deliberately
// collected no email address at all (see `User.email`'s own schema comment): "no email is ever
// collected" was a published privacy claim, not an oversight. It was reversed on explicit
// request, specifically to make password reset and a digest possible — so this file exists
// because that decision was made, not because email is somehow now free of the tradeoffs that
// led to avoiding it. `src/app/confidentialitate/page.tsx` was updated in the same commit.
//
// SETUP (not active until these exist, same "unconfigured = safe no-op" posture as
// `lib/telegram.ts`): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in .env. Any SMTP
// provider works — Gmail app password, Mailgun, SES, Postmark, Resend's SMTP endpoint, a
// self-hosted relay. Nothing here is locked to one vendor's SDK, the same reasoning
// `lib/telegram.ts` gives for a chat bot over a vendor push-notification SDK: whatever the
// deployer already has is more likely to actually get configured than whatever we'd pick.
//
// Without SMTP_HOST, every send is a no-op that returns false and logs to the console instead —
// nothing is ever sent by accident, and the nightly digest job stays safe to run with no setup.
import nodemailer from "nodemailer";

let cachedTransport: ReturnType<typeof nodemailer.createTransport> | null = null;

export function emailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST);
}

function transport() {
  if (cachedTransport) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    // Port 465 is implicit TLS; everything else (587, 25) starts plain and upgrades via STARTTLS.
    // Hardcoding `secure: true` for every port is how a 587 relay fails with a confusing TLS
    // handshake error — nodemailer's own `secure` option name is specifically this distinction.
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return cachedTransport;
}

/**
 * Send one email. Returns false (without throwing) when unconfigured or on a send error — a
 * failed or skipped email must never break the request/job that triggered it (password reset
 * still redirects to "check your email" either way; the digest job still finishes its loop).
 */
export async function sendEmail(opts: { to: string; subject: string; html: string; text: string }): Promise<boolean> {
  if (!emailConfigured()) {
    console.log(`[email] SMTP_HOST not set — would have sent "${opts.subject}" to ${opts.to}`);
    return false;
  }
  try {
    await transport().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    return true;
  } catch (e) {
    console.error(`[email] send failed: ${(e as Error).message}`);
    return false;
  }
}

/** Shared page shell so every email looks like it came from the same site, not a bare paragraph. */
export function emailShell(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f2;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;padding:24px 20px;">
    <div style="font-size:20px;font-weight:700;margin-bottom:20px;">CosIeftin</div>
    ${bodyHtml}
    <p style="margin-top:32px;font-size:12px;color:#888;">
      Primești acest e-mail pentru că ai un cont pe CosIeftin și ai adăugat o adresă de e-mail.
      Îl poți elimina oricând din <a href="https://cosieftin.ro/cont" style="color:#888;">cont</a>.
    </p>
  </div>
</body></html>`;
}
