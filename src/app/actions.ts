"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clearSession, hashPassword, setSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// No email is ever collected or sent — see docs/DEPLOYMENT.md and confidentialitate/page.tsx.
// A username is free-form enough for a real name or handle, but excludes whitespace and "@" so
// it never LOOKS like an email address someone might mistake for a real contact channel.
const USERNAME_RE = /^[^\s@]{3,32}$/;

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
  const next = String(formData.get("next") ?? "/cont");
  if (!USERNAME_RE.test(username) || pw.length < 6) redirect("/login?e=invalid");
  if (await prisma.user.findUnique({ where: { username } })) redirect("/login?e=exists");
  const user = await prisma.user.create({ data: { username, passwordHash: hashPassword(pw) } });
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
