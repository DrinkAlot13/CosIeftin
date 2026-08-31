// Rotate an admin account's password.
//
// Written because user #1 (admin@cosmic.ro) authenticated with "admin1234" — a password
// committed to this repository in scripts/seed-admin.ts as a `?? ` fallback. That is the same
// failure as the AUTH_SECRET default and worse in one respect: AUTH_SECRET let someone forge a
// session, this handed them a working admin login.
//
// HOW TO RUN IT WITHOUT REPEATING THE MISTAKE. The password comes from an environment variable
// and nowhere else — never argv, because argv is visible to every other process on the machine
// via the process list, and it lands in shell history verbatim.
//
//   PowerShell:
//     $env:NEW_ADMIN_PASSWORD = '…'
//     npm run rotate:admin
//     Remove-Item Env:\NEW_ADMIN_PASSWORD
//     Clear-History; Remove-Item (Get-PSReadlineOption).HistorySavePath
//
//   bash/zsh — note the LEADING SPACE, which keeps the line out of history when
//   HISTCONTROL=ignorespace (bash) or setopt HIST_IGNORE_SPACE (zsh):
//      NEW_ADMIN_PASSWORD='…' npm run rotate:admin
//
// This script never prints the password, never logs it, never writes it anywhere but the
// scrypt hash, and refuses to echo it back even on success.
//
// Run: npm run rotate:admin              (rotates ADMIN_EMAIL, default admin@cosmic.ro)
//      npm run rotate:admin -- --list    (read-only: report admin accounts, rotate nothing)

import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Passwords that are public knowledge because they were committed. Length cannot save these. */
const DENYLIST = new Set(["admin1234", "admin", "password", "changeme", "change-me", "admin123"]);
const MIN_LENGTH = 12;

function hash(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
}

function matches(pw: string, stored: string): boolean {
  const [salt, digest] = (stored ?? "").split(":");
  if (!salt || !digest) return false;
  const test = crypto.scryptSync(pw, salt, 64).toString("hex");
  const a = Buffer.from(digest, "hex");
  const b = Buffer.from(test, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

/** Every admin account, with enough context to tell a seed from a person. */
async function listAdmins(): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { id: true, email: true, createdAt: true, passwordHash: true, _count: { select: { lists: true, favorites: true } } },
    orderBy: { id: "asc" },
  });
  const all = await prisma.user.count();

  console.log(`\n  ${all} user(s) total, ${admins.length} with isAdmin=true\n`);
  console.log(`  ${pad("id", 5)}${pad("email", 28)}${pad("created", 20)}${pad("lists", 7)}${pad("favs", 6)}committed default?`);
  console.log("  " + "─".repeat(88));
  for (const a of admins) {
    // Checked against the denylist, so a rotation can be confirmed rather than assumed.
    const weak = [...DENYLIST].find((p) => matches(p, a.passwordHash));
    console.log(
      `  ${pad(String(a.id), 5)}${pad(a.email, 28)}${pad(a.createdAt.toISOString().slice(0, 16).replace("T", " "), 20)}` +
      `${pad(String(a._count.lists), 7)}${pad(String(a._count.favorites), 6)}` +
      (weak ? `YES — "${weak}"  <-- ROTATE THIS` : "no"),
    );
  }
  console.log(
    "\n  A seed account looks like: created at the same moment as the database, zero lists,\n" +
    "  zero favourites, and an address from the seed script. A real one has activity.\n",
  );
}

async function main(): Promise<void> {
  if (process.argv.includes("--list")) {
    await listAdmins();
    await prisma.$disconnect();
    return;
  }

  const email = process.env.ADMIN_EMAIL?.trim() || "admin@cosmic.ro";
  const next = process.env.NEW_ADMIN_PASSWORD;

  // Argv is visible in the process list and in shell history. Refuse it outright rather than
  // silently accepting a second, unsafe channel.
  if (process.argv.some((a) => a.startsWith("--password"))) {
    console.error("Refusing --password: argv is visible to every process on this machine and is\nkept in shell history. Set NEW_ADMIN_PASSWORD instead.");
    process.exit(2);
  }

  if (!next) {
    console.error(
      "NEW_ADMIN_PASSWORD is not set.\n\n" +
      "  PowerShell:  $env:NEW_ADMIN_PASSWORD = '…'; npm run rotate:admin; Remove-Item Env:\\NEW_ADMIN_PASSWORD\n" +
      "  bash/zsh:     NEW_ADMIN_PASSWORD='…' npm run rotate:admin   (leading space keeps it out of history)\n",
    );
    process.exit(2);
  }
  if (next.length < MIN_LENGTH) {
    console.error(`Refusing: the new password is shorter than ${MIN_LENGTH} characters.`);
    process.exit(2);
  }
  if (DENYLIST.has(next.toLowerCase())) {
    console.error("Refusing: that password is in this repository's git history. Choose another.");
    process.exit(2);
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, isAdmin: true, passwordHash: true } });
  if (!user) {
    console.error(`No user with email ${email}. Set ADMIN_EMAIL to the account you mean.`);
    process.exit(1);
  }

  const wasWeak = [...DENYLIST].find((p) => matches(p, user.passwordHash));

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash(next) } });

  // VERIFY BY RE-READING. A rotation that is not checked is a rotation you hope happened.
  const after = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  const newWorks = !!after && matches(next, after.passwordHash);
  const oldStillWorks = !!after && !!wasWeak && matches(wasWeak, after.passwordHash);

  console.log(`\n  rotated: ${email} (user #${user.id}, isAdmin=${user.isAdmin})`);
  console.log(`  new password authenticates:      ${newWorks ? "yes" : "NO"}`);
  console.log(`  previous committed default works: ${oldStillWorks ? "YES — ROTATION FAILED" : "no"}`);
  if (wasWeak) console.log(`  (this account previously used a password published in this repository)`);
  console.log("\n  The password itself is not printed, by design.\n");

  await prisma.$disconnect();
  if (!newWorks || oldStillWorks) process.exit(1);
}

main().catch(async (e) => {
  // Never let a stack trace carry the value into a log.
  console.error("rotate-admin failed:", (e as Error).message);
  await prisma.$disconnect();
  process.exit(1);
});
