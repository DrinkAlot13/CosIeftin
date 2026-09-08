"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clearSession, hashPassword, setSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const pw = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/cont");
  if (!EMAIL_RE.test(email) || pw.length < 6) redirect("/login?e=invalid");
  if (await prisma.user.findUnique({ where: { email } })) redirect("/login?e=exists");
  const user = await prisma.user.create({ data: { email, passwordHash: hashPassword(pw) } });
  setSession(user.id);
  redirect(next);
}

export async function login(formData: FormData) {
  limitAuth("login");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const pw = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/cont");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(pw, user.passwordHash)) redirect("/login?e=bad");
  setSession(user.id);
  redirect(next);
}

export async function logout() {
  clearSession();
  redirect("/");
}
