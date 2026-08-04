import crypto from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

// Minimal MVP auth: scrypt password hashing + a stateless HMAC-signed session
// cookie. Good enough for a prototype; for production set AUTH_SECRET and consider
// a session store / a battle-tested library (Auth.js, Lucia).
const SECRET = process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me";
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
  const mac = crypto.createHmac("sha256", SECRET).update(String(userId)).digest("hex");
  return `${userId}.${mac}`;
}

function verify(token: string): number | null {
  const [id, mac] = token.split(".");
  if (!id || !mac) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(id).digest("hex");
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

export async function getCurrentUser() {
  const token = cookies().get(COOKIE)?.value;
  if (!token) return null;
  const id = verify(token);
  if (id == null) return null;
  return prisma.user.findUnique({ where: { id }, select: { id: true, email: true, isAdmin: true } });
}
