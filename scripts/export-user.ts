// ── EVERYTHING WE HOLD ABOUT ONE PERSON, AS A FILE THEY CAN TAKE AWAY. GDPR Articles 15 & 20.
//
// The sibling of `erase:user`, and it exists for the same reason: the privacy policy promises
// access and portability, and a promise whose mechanism does not exist is the thing that policy
// was written to avoid. `erase:user` shipped with its promise; this one ships with the other two.
//
// ── WHAT IT INCLUDES, and the one judgement in it.
//
// Everything keyed to the account, plus the product NAME beside every id — a file listing
// `productId: 4471` is technically a copy of the data and useless to the person receiving it.
// Article 20 asks for a commonly used, machine-readable format; JSON with human-readable labels
// is both.
//
// It does NOT include `ProductAddCount`: one row per product, no user, no session, nothing that
// refers to a person. Including it would hand someone else's aggregate to whoever asked.
//
// ── IT REFUSES TO WRITE AN EMPTY FILE FOR AN UNKNOWN ADDRESS. Exporting `{}` for an account
// that does not exist looks like "we hold nothing about you", which is a claim; "no such
// account" is a different one, and the requester deserves the right one.
//
//   npm run export:user -- --username someone
//   npm run export:user -- --username someone --out C:/tmp/export.json

import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const at = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const username = at("--username")?.trim().toLowerCase();
  const out = at("--out");

  if (!username) {
    console.error("Usage: npm run export:user -- --username <name> [--out <file.json>]");
    process.exit(2);
  }

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, isAdmin: true, createdAt: true },
  });
  if (!user) {
    console.error(`No account for ${JSON.stringify(username)}. Nothing exported.`);
    console.error(`That is NOT the same as "we hold no data about you" — say the right one.`);
    process.exit(1);
  }

  const withName = { product: { select: { name: true, brand: true, slug: true } } };

  const [favorites, blocklist, productAdds, lists] = await Promise.all([
    prisma.userFavorite.findMany({ where: { userId: user.id }, select: { productId: true, source: true, addedAt: true, ...withName } }),
    prisma.userBlocklist.findMany({ where: { userId: user.id }, select: { brand: true, productId: true, attributeTag: true, createdAt: true } }),
    prisma.userProductAdd.findMany({ where: { userId: user.id }, select: { productId: true, count: true, distinctDays: true, lastAddedAt: true, ...withName } }),
    prisma.groceryList.findMany({
      where: { userId: user.id },
      select: { name: true, createdAt: true, items: { select: { qty: true, substitutionMode: true, ...withName } } },
    }),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    about: "Toate datele pe care CoșMic le păstrează despre acest cont.",
    account: {
      username: user.username,
      createdAt: user.createdAt,
      // The hash is deliberately absent: it is OUR credential material, not information about
      // the person, and handing it out would only help whoever obtained the file.
      note: "Parola nu este inclusă — o păstrăm doar sub formă criptată și nu o putem citi.",
    },
    favorites,
    blocklist,
    productAdds,
    lists,
    notIncluded: {
      priceAlerts:
        "Alertele Telegram sunt legate de identificatorul de chat, nu de cont. Cere-le separat.",
      productAddCount:
        "Numărătoarea per produs este un total agregat, fără utilizator — nu conține date despre tine.",
      browserData:
        "Lista de cumpărături, cardurile de fidelitate și preferințele sunt doar în browserul tău; nu avem o copie.",
    },
  };

  const json = JSON.stringify(payload, null, 2);
  if (out) {
    writeFileSync(out, json, "utf8");
    console.log(`Written to ${out} (${json.length} bytes)`);
  } else {
    console.log(json);
  }
  console.error(
    `\nSummary: ${favorites.length} favourites, ${blocklist.length} blocklist rows, ` +
    `${productAdds.length} add-counters, ${lists.length} lists.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
