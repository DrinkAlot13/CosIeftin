// ── ERASE ONE PERSON'S ACCOUNT AND EVERYTHING ATTACHED TO IT. GDPR Article 17.
//
// A THIN CLI WRAPPER over `src/lib/account-gdpr.ts`'s `eraseUserAccount` — the self-serve
// `POST /api/account/delete` route calls the exact same function, so an admin erasing an
// account by hand and a shopper deleting their own account can never disagree about what gets
// deleted. See that file for what is and is not included, and why.
//
//   npm run erase:user -- --username someone          report only
//   npm run erase:user -- --username someone --write
//   npm run erase:user -- --telegram 123456789 --write

import { prisma } from "../src/lib/db";
import { eraseUserAccount, eraseUserAccountDryRun } from "../src/lib/account-gdpr";

async function eraseAccount(username: string, write: boolean): Promise<void> {
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true, createdAt: true, isAdmin: true } });
  if (!user) {
    console.log(`  No account for ${JSON.stringify(username)}. Nothing to erase.`);
    return;
  }

  if (!write) {
    const counts = await eraseUserAccountDryRun(user.id);
    console.log(`  account   #${user.id}  ${user.username}  created ${user.createdAt.toISOString().slice(0, 10)}${user.isAdmin ? "  [ADMIN]" : ""}`);
    for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(12)} ${v}`);
    console.log(`\n  DRY RUN — nothing deleted. Re-run with --write.`);
    return;
  }

  const result = await eraseUserAccount(user.id);
  console.log(`  account   #${user.id}  ${user.username}  created ${user.createdAt.toISOString().slice(0, 10)}${user.isAdmin ? "  [ADMIN]" : ""}`);
  for (const [k, v] of Object.entries(result.counts)) console.log(`  ${k.padEnd(12)} ${v}`);
  console.log(`\n  ERASED. account rows remaining: ${result.left}, dependent rows remaining: ${result.orphans}`);
  if (result.left > 0 || result.orphans > 0) {
    console.error(`  ✗ SOMETHING SURVIVED. Do not report this account as erased.`);
    process.exitCode = 1;
  }
}

async function eraseAlerts(chatId: string, write: boolean): Promise<void> {
  const n = await prisma.priceAlert.count({ where: { chatId } });
  console.log(`  price alerts for Telegram chat ${chatId}: ${n}`);
  if (!write) { console.log(`\n  DRY RUN — nothing deleted. Re-run with --write.`); return; }
  const r = await prisma.priceAlert.deleteMany({ where: { chatId } });
  console.log(`\n  ERASED ${r.count} alert(s).`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const write = argv.includes("--write");
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const username = at("--username");
  const telegram = at("--telegram");

  if (!username && !telegram) {
    console.error("Usage: npm run erase:user -- --username <name> [--write]");
    console.error("       npm run erase:user -- --telegram <chatId> [--write]");
    process.exit(2);
  }

  console.log("═".repeat(88));
  console.log(`RIGHT TO ERASURE — ${write ? "WRITING" : "dry run"}`);
  console.log("═".repeat(88));
  if (username) await eraseAccount(username.trim().toLowerCase(), write);
  if (telegram) await eraseAlerts(telegram.trim(), write);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
