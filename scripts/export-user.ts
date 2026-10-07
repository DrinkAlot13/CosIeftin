// ── EVERYTHING WE HOLD ABOUT ONE PERSON, AS A FILE THEY CAN TAKE AWAY. GDPR Articles 15 & 20.
//
// The sibling of `erase:user`, and it exists for the same reason: the privacy policy promises
// access and portability, and a promise whose mechanism does not exist is the thing that policy
// was written to avoid.
//
// A THIN CLI WRAPPER over `src/lib/account-gdpr.ts`'s `exportUserData` — the self-serve
// `GET /api/account/export` route calls the exact same function, so an admin running this by
// hand and a shopper clicking "download my data" can never disagree about what counts as
// "everything we hold".
//
//   npm run export:user -- --username someone
//   npm run export:user -- --username someone --out C:/tmp/export.json

import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { exportUserData } from "../src/lib/account-gdpr";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const username = at("--username")?.trim().toLowerCase();
  const out = at("--out");

  if (!username) {
    console.error("Usage: npm run export:user -- --username <name> [--out <file.json>]");
    process.exit(2);
  }

  // IT REFUSES TO WRITE AN EMPTY FILE FOR AN UNKNOWN ACCOUNT. Exporting `{}` for a username
  // that does not exist looks like "we hold nothing about you", which is a claim; "no such
  // account" is a different one, and the requester deserves the right one.
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!user) {
    console.error(`No account for ${JSON.stringify(username)}. Nothing exported.`);
    console.error(`That is NOT the same as "we hold no data about you" — say the right one.`);
    process.exit(1);
  }

  const payload = await exportUserData(user.id);
  const json = JSON.stringify(payload, null, 2);
  if (out) {
    writeFileSync(out, json, "utf8");
    console.log(`Written to ${out} (${json.length} bytes)`);
  } else {
    console.log(json);
  }
  console.error(
    `\nSummary: ${payload.favorites.length} favourites, ${payload.blocklist.length} blocklist rows, ` +
    `${payload.productAdds.length} add-counters, ${payload.lists.length} lists.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
