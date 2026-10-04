// ── ERASE ONE PERSON'S ACCOUNT AND EVERYTHING ATTACHED TO IT. GDPR Article 17.
//
// ── WHY THIS EXISTS AT ALL: `prisma.user.delete()` DOES NOT WORK.
//
// Measured, not assumed. A throwaway user with a favourite, a list, an add-counter row and a
// blocklist entry was created and deleted:
//
//     prisma.user.delete({ where: { id } })
//       → Foreign key constraint violated: `foreign key`
//
// None of the child relations declare `onDelete: Cascade`, so the delete is refused and the
// account survives. Deleting the dependents first, in order, works — that is what this does.
//
// The privacy policy says we erase an account on request. Before this file, that promise was
// backed by nothing: there was no delete endpoint, no admin action, and the obvious one-liner
// fails. A policy promising erasure a codebase cannot perform is worse than no policy, so the
// promise and the mechanism ship together.
//
// ── WHAT IS DELETED, and what deliberately is not.
//
//   User               the account: username and password hash
//   GroceryList(Item)  saved lists tied to that user
//   UserFavorite       hearted and inferred favourites
//   UserBlocklist      things they never want suggested
//   UserProductAdd     the per-person add counter that drives inferred favourites
//   EquivalenceSuggestion  "this product is the same as that one" claims they submitted
//   ProductReport      "this price/product is wrong" reports they submitted while signed in
//   EquivalenceSuggestionVote  corroborations of OTHER shoppers' equivalence suggestions
//
// NOT deleted: `ProductAddCount`. It is one row per PRODUCT holding a total, with no user, no
// session and no timestamps per event — nothing in it refers to a person, and subtracting a
// share of a counter would require knowing whose adds they were, which is exactly the data the
// aggregate was designed not to keep.
//
// NOT deleted: `PriceAlert`. It is keyed by Telegram `chatId`, not by user id — the two are
// never linked, so this script cannot find a person's alerts and must not guess. Erasing those
// is `--telegram <chatId>`, run separately, because the identifier comes from a different
// system and the operator has to supply it.
//
//   npm run erase:user -- --username someone          report only
//   npm run erase:user -- --username someone --write
//   npm run erase:user -- --telegram 123456789 --write

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function eraseAccount(username: string, write: boolean): Promise<void> {
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true, createdAt: true, isAdmin: true } });
  if (!user) {
    console.log(`  No account for ${JSON.stringify(username)}. Nothing to erase.`);
    return;
  }

  const lists = await prisma.groceryList.findMany({ where: { userId: user.id }, select: { id: true } });
  const listIds = lists.map((l) => l.id);
  const counts = {
    lists: lists.length,
    listItems: listIds.length ? await prisma.groceryListItem.count({ where: { listId: { in: listIds } } }) : 0,
    favorites: await prisma.userFavorite.count({ where: { userId: user.id } }),
    blocklist: await prisma.userBlocklist.count({ where: { userId: user.id } }),
    productAdds: await prisma.userProductAdd.count({ where: { userId: user.id } }),
    equivalenceSuggestions: await prisma.equivalenceSuggestion.count({ where: { userId: user.id } }),
    productReports: await prisma.productReport.count({ where: { userId: user.id } }),
    equivalenceSuggestionVotes: await prisma.equivalenceSuggestionVote.count({ where: { userId: user.id } }),
  };

  console.log(`  account   #${user.id}  ${user.username}  created ${user.createdAt.toISOString().slice(0, 10)}${user.isAdmin ? "  [ADMIN]" : ""}`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(12)} ${v}`);

  if (!write) {
    console.log(`\n  DRY RUN — nothing deleted. Re-run with --write.`);
    return;
  }

  // ── ORDER IS THE WHOLE POINT. Children before parents, or the FK refuses the delete.
  // Wrapped in a transaction so a half-erased account cannot exist: a person who asked to be
  // forgotten and had four of five tables cleared is in a worse state than before they asked.
  await prisma.$transaction(async (tx) => {
    if (listIds.length) await tx.groceryListItem.deleteMany({ where: { listId: { in: listIds } } });
    await tx.groceryList.deleteMany({ where: { userId: user.id } });
    await tx.userFavorite.deleteMany({ where: { userId: user.id } });
    await tx.userBlocklist.deleteMany({ where: { userId: user.id } });
    await tx.userProductAdd.deleteMany({ where: { userId: user.id } });
    await tx.equivalenceSuggestion.deleteMany({ where: { userId: user.id } });
    await tx.productReport.deleteMany({ where: { userId: user.id } });
    await tx.equivalenceSuggestionVote.deleteMany({ where: { userId: user.id } });
    await tx.user.delete({ where: { id: user.id } });
  });

  // Verify from OUTSIDE the transaction: the account is gone only if a fresh read says so.
  const left = await prisma.user.count({ where: { username } });
  const orphans =
    (await prisma.userFavorite.count({ where: { userId: user.id } })) +
    (await prisma.userBlocklist.count({ where: { userId: user.id } })) +
    (await prisma.userProductAdd.count({ where: { userId: user.id } })) +
    (await prisma.equivalenceSuggestion.count({ where: { userId: user.id } })) +
    (await prisma.productReport.count({ where: { userId: user.id } })) +
    (await prisma.equivalenceSuggestionVote.count({ where: { userId: user.id } })) +
    (await prisma.groceryList.count({ where: { userId: user.id } }));

  console.log(`\n  ERASED. account rows remaining: ${left}, dependent rows remaining: ${orphans}`);
  if (left > 0 || orphans > 0) {
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
