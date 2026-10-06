"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clearSession, createResetToken, getCurrentUser, hashPassword, hashResetToken, RESET_TOKEN_TTL_MS, setSession, verifyPassword } from "@/lib/auth";
import { emailShell, sendEmail } from "@/lib/email";
import { absoluteUrl } from "@/lib/config/siteUrl";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// A username is free-form enough for a real name or handle, but excludes whitespace and "@" so
// it never LOOKS like an email address someone might mistake for a real contact channel. Email
// is now a SEPARATE, optional field (see User.email's schema comment) — this regex and its
// reasoning are unchanged, username still never doubles as an email.
const USERNAME_RE = /^[^\s@]{3,32}$/;
// Deliberately loose — RFC 5322 is not worth re-implementing here, and the only consequence of
// accepting something slightly malformed is a bounce when we try to send to it, same risk as
// any contact form. The one thing this MUST reject is empty/whitespace, so a blank field cannot
// collide with another blank field under the unique constraint.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * `login` and `register` are SERVER ACTIONS, not API routes, so nothing routes through
 * `lib/rate-limit`'s `guard()` — they read the request headers themselves.
 *
 * These are the two endpoints that most need it. An unbounded anonymous login is a
 * credential-stuffing target the day this is hosted, and an unbounded register lets one caller
 * fill the user table.
 *
 * The failure is a REDIRECT rather than a 429, because a server action's caller here is a form
 * post from a browser: a 429 would render as a raw error page, while `?e=slow` is a message the
 * login page already knows how to show.
 *
 * Read `lib/rate-limit.ts` before trusting any of this — in-memory, per-process, and blind to
 * the client's address unless TRUST_PROXY is set. `npm run audit:rate-limit` reports which.
 */
function limitAuth(name: "login" | "register"): void {
  if (rateLimit(name, clientIp(headers())).ok) return;
  redirect("/login?e=slow");
}

export async function register(formData: FormData) {
  limitAuth("register");
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const pw = String(formData.get("password") ?? "");
  const emailRaw = String(formData.get("email") ?? "").trim().toLowerCase();
  const next = String(formData.get("next") ?? "/cont");
  if (!USERNAME_RE.test(username) || pw.length < 6) redirect("/login?e=invalid");
  // EMAIL IS OPTIONAL. An empty string must never reach the unique `email` column — two
  // accounts with "" would collide on the constraint, so an absent email is NULL, not "".
  if (emailRaw && !EMAIL_RE.test(emailRaw)) redirect("/login?e=bademail");
  const email = emailRaw || null;
  if (await prisma.user.findUnique({ where: { username } })) redirect("/login?e=exists");
  if (email && (await prisma.user.findUnique({ where: { email } }))) redirect("/login?e=emailexists");
  const user = await prisma.user.create({ data: { username, email, passwordHash: hashPassword(pw) } });
  setSession(user.id);
  redirect(next);
}

export async function login(formData: FormData) {
  limitAuth("login");
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const pw = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/cont");
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !verifyPassword(pw, user.passwordHash)) redirect("/login?e=bad");
  setSession(user.id);
  redirect(next);
}

export async function logout() {
  clearSession();
  redirect("/");
}

/**
 * Add or change the email on the SIGNED-IN account. Separate from `register` because most
 * accounts predate this field and need a path to add one later — same reasoning `User.email`'s
 * schema comment gives for why it is nullable rather than backfilled or required.
 */
export async function setAccountEmail(formData: FormData) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const emailRaw = String(formData.get("email") ?? "").trim().toLowerCase();
  if (emailRaw && !EMAIL_RE.test(emailRaw)) redirect("/cont?e=bademail");
  const email = emailRaw || null;
  if (email && (await prisma.user.findFirst({ where: { email, id: { not: me.id } } }))) redirect("/cont?e=emailexists");
  await prisma.user.update({ where: { id: me.id }, data: { email } });
  redirect("/cont?ok=email");
}

/**
 * Request a reset link. ALWAYS redirects to the same "check your email" page whether or not the
 * address exists — an endpoint that answers differently for "no account" vs "sent" is an
 * email-enumeration oracle, the same reasoning `login`'s generic "bad" error already follows
 * for username+password. Nothing here reveals which case happened.
 */
export async function requestPasswordReset(formData: FormData) {
  if (!rateLimit("passwordReset", clientIp(headers())).ok) redirect("/reset-password?e=slow");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (email && EMAIL_RE.test(email)) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const { raw, hash } = createResetToken();
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
      });
      const link = absoluteUrl(`/reset-password?token=${raw}`);
      await sendEmail({
        to: email,
        subject: "Resetează parola CosIeftin",
        text: `Ai cerut resetarea parolei. Deschide acest link (valabil 1 oră): ${link}\n\nDacă nu ai cerut tu asta, ignoră acest e-mail.`,
        html: emailShell(`
          <p>Ai cerut resetarea parolei contului tău CosIeftin.</p>
          <p><a href="${link}" style="display:inline-block;background:#1a7a3c;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Setează o parolă nouă</a></p>
          <p style="color:#888;font-size:13px;">Linkul e valabil o oră. Dacă nu ai cerut tu asta, ignoră acest e-mail — parola ta nu se schimbă.</p>
        `),
      });
    }
  }
  redirect("/reset-password?sent=1");
}

/** Redeem a reset token: set a new password, consume the token, and sign the user in. */
export async function confirmPasswordReset(formData: FormData) {
  if (!rateLimit("passwordReset", clientIp(headers())).ok) redirect("/reset-password?e=slow");
  const rawToken = String(formData.get("token") ?? "");
  const pw = String(formData.get("password") ?? "");
  if (!rawToken || pw.length < 6) redirect(`/reset-password?token=${encodeURIComponent(rawToken)}&e=invalid`);

  const tokenHash = hashResetToken(rawToken);
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  // Checked as three SEPARATE conditions rather than one combined where-clause, so a replay of
  // an already-used token and an expired token can each be told apart if this ever needs a
  // clearer error — today both just redirect to the same "link no longer valid" state.
  if (!row || row.usedAt || row.expiresAt < new Date()) redirect("/reset-password?e=expired");

  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash: hashPassword(pw) } }),
    prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
  ]);
  setSession(row.userId);
  redirect("/cont?ok=reset");
}
