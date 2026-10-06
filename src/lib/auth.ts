import crypto from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

// Minimal MVP auth: scrypt password hashing + a stateless HMAC-signed session
// cookie. Good enough for a prototype; for production consider a session store or a
// battle-tested library (Auth.js, Lucia).

/**
 * The session-signing key. In production it MUST come from the environment.
 *
 * This used to be `process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me"`, which meant a
 * deployment that forgot to set AUTH_SECRET signed real session cookies with a constant that
 * has been readable in this repository since the initial commit. Anyone with the source could
 * mint a cookie for any user, and nothing anywhere would have said a word — the app would have
 * looked completely healthy.
 *
 * A missing secret is now a startup failure in production rather than a silent downgrade. The
 * development fallback stays, because forcing a secret on `npm run dev` buys nothing, but it is
 * derived per-process so it cannot accidentally become a shared known value either.
 */
function sessionSecret(): string {
  const fromEnv = process.env.AUTH_SECRET?.trim();
  if (fromEnv && fromEnv !== "change-me" && fromEnv.length >= 16) return fromEnv;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET is not set (or is too short / still the placeholder). Refusing to sign " +
      "session cookies with a known constant in production. Generate one with:\n" +
      "  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"",
    );
  }
  // Dev only: random per process. Restarting dev logs you out, which is the correct trade
  // against every developer machine sharing one publicly-known signing key.
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Resolved on FIRST USE, not at import.
 *
 * Evaluating it at module scope threw during `next build`: Next collects page data with
 * NODE_ENV=production, so importing anything that touches auth demanded a production secret on
 * a machine that has no business holding one. A build server should not need the key that signs
 * sessions — the failure belongs at the moment a session is actually signed or verified.
 */
let cachedSecret: string | null = null;
function SECRET_(): string {
  if (cachedSecret === null) cachedSecret = sessionSecret();
  return cachedSecret;
}
const COOKIE = "pm_session";

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(pw, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(test, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(userId: number): string {
  const mac = crypto.createHmac("sha256", SECRET_()).update(String(userId)).digest("hex");
  return `${userId}.${mac}`;
}

function verify(token: string): number | null {
  const [id, mac] = token.split(".");
  if (!id || !mac) return null;
  const expected = crypto.createHmac("sha256", SECRET_()).update(id).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

export function setSession(userId: number) {
  cookies().set(COOKIE, sign(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSession() {
  cookies().delete(COOKIE);
}

// ── PASSWORD RESET TOKENS ───────────────────────────────────────────────────────────────────
//
// A sha256 hash is fine here — unlike a password, a reset token is already high-entropy random
// bytes (32 bytes = 256 bits), not something a human chose, so there is nothing for scrypt's
// deliberate slowness to protect against. What matters is never storing the raw token (the
// email link and the one redeem request are the only places it exists in full) and comparing
// in constant time, same as every other secret-equality check in this file.

const RESET_TOKEN_BYTES = 32;
export const RESET_TOKEN_TTL_MS = 60 * 60_000; // 1 hour

/** A fresh raw token (goes in the email link) plus the hash to store. */
export function createResetToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(RESET_TOKEN_BYTES).toString("base64url");
  return { raw, hash: hashResetToken(raw) };
}

export function hashResetToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function getCurrentUser() {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  const id = verify(token);
  if (id == null) return null;
  return prisma.user.findUnique({ where: { id }, select: { id: true, username: true, email: true, isAdmin: true } });
}
