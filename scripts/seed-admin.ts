// Create or ensure an admin account.
//
// This script is why user #1 authenticated with "admin1234": it used to read
//
//     const PASSWORD = process.env.ADMIN_PASSWORD ?? "admin1234";
//
// and `npm run setup` runs it. So every deployment that ran setup without setting
// ADMIN_PASSWORD got an admin account whose password is committed to this repository — and the
// script then printed `${EMAIL} / ${PASSWORD}` to stdout, so it also landed in any CI or deploy
// log that captured output.
//
// Same shape as the AUTH_SECRET fallback, and worse in one respect: that one let an attacker
// forge a session, this handed them a working login.
//
// There is no fallback now. Outside development the password must be supplied, must clear a
// minimum length, and must not be one of the values already published in this repo's history —
// length cannot rescue a string that is public knowledge.
//
// Run: ADMIN_PASSWORD='…' npm run seed-admin

import crypto from "node:crypto";
import { prisma } from "../src/lib/db";

/** Published in this repository, therefore unusable at any length. */
export const PUBLISHED_PASSWORDS = new Set([
  "admin1234", "admin123", "admin", "password", "changeme", "change-me", "dev-insecure-secret-change-me",
]);
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Decide what password to seed with, or explain why we refuse.
 *
 * Pure and exported so the refusal can be tested without running a seed against a database —
 * the case that matters most is the one that must never execute.
 */
export function resolveSeedPassword(
  env: { ADMIN_PASSWORD?: string; NODE_ENV?: string },
): { ok: true; password: string } | { ok: false; reason: string } {
  const supplied = env.ADMIN_PASSWORD?.trim();
  const isDev = (env.NODE_ENV ?? "development") === "development";

  if (!supplied) {
    if (!isDev) {
      return {
        ok: false,
        reason:
          "ADMIN_PASSWORD is not set and NODE_ENV is not development. Refusing to create an " +
          "admin account with a default password — the previous default is in this repository.",
      };
    }
    return {
      ok: false,
      reason:
        "ADMIN_PASSWORD is not set. There is no development fallback either: a seeded account " +
        "outlives the machine it was seeded on. Run: ADMIN_PASSWORD='…' npm run seed-admin",
    };
  }
  if (PUBLISHED_PASSWORDS.has(supplied.toLowerCase())) {
    return { ok: false, reason: "That password appears in this repository's git history. Choose another." };
  }
  if (supplied.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  return { ok: true, password: supplied };
}

function hash(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
}

async function main(): Promise<void> {
  const username = process.env.ADMIN_USERNAME?.trim() || "admin";
  const resolved = resolveSeedPassword(process.env);
  if (!resolved.ok) {
    console.error(resolved.reason);
    await prisma.$disconnect();
    process.exit(2);
  }

  const user = await prisma.user.upsert({
    where: { username },
    // An existing account keeps its password. Re-running setup must not silently reset a
    // rotated credential back to whatever is in the environment today.
    update: { isAdmin: true },
    create: { username, passwordHash: hash(resolved.password), isAdmin: true },
  });

  // The password is never printed. That is the whole point.
  console.log(`seeded admin ${username} (user#${user.id})`);
  await prisma.$disconnect();
}

const invokedDirectly = process.argv[1]
  ? process.argv[1].split("\\").join("/").endsWith("seed-admin.ts")
  : false;
if (invokedDirectly) {
  main().catch(async (e) => {
    console.error("seed-admin failed:", (e as Error).message);
    await prisma.$disconnect();
    process.exit(1);
  });
}
