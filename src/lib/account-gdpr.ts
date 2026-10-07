// ONE implementation of "everything we hold about one account" and "erase one account",
// shared by the CLI scripts (export-user.ts / erase-user.ts, run by an operator on request)
// and the self-serve API routes (/api/account/export, /api/account/delete, run by the shopper
// themselves). Two copies of either is exactly the "named concept, two implementations" shape
// CLAUDE.md names as a recurring source of silent drift — a self-serve delete button that
// forgot a table the CLI script remembers would be worse than no button, because nobody would
// notice until someone who was "erased" found their old favourites still influencing results.
//
// ── EVERY MODEL `eraseUserAccount` CLEARS, BY NAME — checked against this exact list by
// tests/erasure-cascade.test.ts, so a model gaining `userId` without being added here (and to
// the delete transaction below) fails the build rather than erasing silently incompletely:
// User, GroceryList, GroceryListItem, UserFavorite, UserBlocklist, UserProductAdd,
// EquivalenceSuggestion, EquivalenceSuggestionVote, ProductReport, UserRecipe,
// PasswordResetToken, SavingsEvent, Budget, PushSubscription.

import { prisma } from "@/lib/db";

const withName = { product: { select: { name: true, brand: true, slug: true } } };

export type ExportPayload = Awaited<ReturnType<typeof exportUserData>>;

/** Everything keyed to this account, with product NAMES beside every id — see export-user.ts's
 *  own header for why a bare `productId: 4471` is not a usable export under GDPR Article 20. */
export async function exportUserData(userId: number) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { username: true, email: true, createdAt: true },
  });

  const [favorites, blocklist, productAdds, lists, equivalenceSuggestions, productReports, equivalenceVotes, userRecipes, savingsEvents, budget, pushSubscriptions] = await Promise.all([
    prisma.userFavorite.findMany({ where: { userId }, select: { productId: true, source: true, addedAt: true, ...withName } }),
    prisma.userBlocklist.findMany({ where: { userId }, select: { brand: true, productId: true, attributeTag: true, createdAt: true } }),
    prisma.userProductAdd.findMany({ where: { userId }, select: { productId: true, count: true, distinctDays: true, lastAddedAt: true, ...withName } }),
    prisma.groceryList.findMany({
      where: { userId },
      select: { name: true, createdAt: true, items: { select: { qty: true, substitutionMode: true, ...withName } } },
    }),
    prisma.equivalenceSuggestion.findMany({
      where: { userId },
      select: { createdAt: true, status: true, note: true, productA: { select: { name: true } }, productB: { select: { name: true } } },
    }),
    prisma.productReport.findMany({ where: { userId }, select: { kind: true, createdAt: true, ...withName } }),
    prisma.equivalenceSuggestionVote.findMany({ where: { userId }, select: { createdAt: true } }),
    prisma.userRecipe.findMany({ where: { userId }, select: { name: true, ingredients: true, createdAt: true } }),
    prisma.savingsEvent.findMany({ where: { userId }, select: { amountBani: true, occurredAt: true, ...withName } }),
    prisma.budget.findUnique({ where: { userId }, select: { monthlyLimitBani: true, updatedAt: true } }),
    // Metadata only — NEVER the p256dh/auth keys. Those are push-delivery credentials, the
    // same reasoning passwordHash is excluded below: they are OUR means of reaching the
    // browser, not information ABOUT the person, and handing them out would only help whoever
    // obtained the file impersonate that browser's subscription.
    prisma.pushSubscription.findMany({ where: { userId }, select: { createdAt: true } }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    about: "Toate datele pe care CosIeftin le păstrează despre acest cont.",
    account: {
      username: user.username,
      email: user.email,
      createdAt: user.createdAt,
      note: "Parola nu este inclusă — o păstrăm doar sub formă criptată și nu o putem citi.",
    },
    favorites,
    blocklist,
    productAdds,
    lists,
    equivalenceSuggestions,
    productReports,
    equivalenceSuggestionVotes: equivalenceVotes,
    userRecipes,
    savingsEvents,
    budget,
    pushSubscriptionCount: pushSubscriptions.length,
    notIncluded: {
      priceAlerts: "Alertele Telegram sunt legate de identificatorul de chat, nu de cont. Cere-le separat.",
      productAddCount: "Numărătoarea per produs este un total agregat, fără utilizator — nu conține date despre tine.",
      browserData: "Lista de cumpărături, cardurile de fidelitate și preferințele sunt doar în browserul tău; nu avem o copie.",
      pushKeys: "Cheile tehnice ale notificărilor push nu sunt incluse — sunt un mijloc de livrare, nu date despre tine.",
    },
  };
}

export type EraseResult = { counts: Record<string, number>; left: number; orphans: number };

/**
 * Erase one account and everything attached to it. `prisma.user.delete()` alone fails with a
 * foreign-key violation — measured directly, not assumed — so dependents are deleted first, in
 * one transaction so a half-erased account can never exist.
 *
 * NOT erased: `ProductAddCount` (an anonymous per-product aggregate, nothing to attribute) and
 * `PriceAlert` (keyed by Telegram chatId, never linked to a User row — erase those separately
 * with the chatId itself, which only the person asking can supply).
 */
/** Count every row that `eraseUserAccount` would delete, without deleting anything — the CLI's
 *  dry-run report and nothing else. Kept as one function so a dry run can never claim a
 *  different set of tables than the real erase touches. */
export async function eraseUserAccountDryRun(userId: number): Promise<Record<string, number>> {
  const listIds = (await prisma.groceryList.findMany({ where: { userId }, select: { id: true } })).map((l) => l.id);
  return {
    lists: listIds.length,
    listItems: listIds.length ? await prisma.groceryListItem.count({ where: { listId: { in: listIds } } }) : 0,
    favorites: await prisma.userFavorite.count({ where: { userId } }),
    blocklist: await prisma.userBlocklist.count({ where: { userId } }),
    productAdds: await prisma.userProductAdd.count({ where: { userId } }),
    equivalenceSuggestions: await prisma.equivalenceSuggestion.count({ where: { userId } }),
    productReports: await prisma.productReport.count({ where: { userId } }),
    equivalenceSuggestionVotes: await prisma.equivalenceSuggestionVote.count({ where: { userId } }),
    userRecipes: await prisma.userRecipe.count({ where: { userId } }),
    passwordResetTokens: await prisma.passwordResetToken.count({ where: { userId } }),
    savingsEvents: await prisma.savingsEvent.count({ where: { userId } }),
    budget: await prisma.budget.count({ where: { userId } }),
    pushSubscriptions: await prisma.pushSubscription.count({ where: { userId } }),
  };
}

export async function eraseUserAccount(userId: number): Promise<EraseResult> {
  const counts = await eraseUserAccountDryRun(userId);
  const listIds = (await prisma.groceryList.findMany({ where: { userId }, select: { id: true } })).map((l) => l.id);

  await prisma.$transaction(async (tx) => {
    if (listIds.length) await tx.groceryListItem.deleteMany({ where: { listId: { in: listIds } } });
    await tx.groceryList.deleteMany({ where: { userId } });
    await tx.userFavorite.deleteMany({ where: { userId } });
    await tx.userBlocklist.deleteMany({ where: { userId } });
    await tx.userProductAdd.deleteMany({ where: { userId } });
    await tx.equivalenceSuggestion.deleteMany({ where: { userId } });
    await tx.productReport.deleteMany({ where: { userId } });
    await tx.equivalenceSuggestionVote.deleteMany({ where: { userId } });
    await tx.userRecipe.deleteMany({ where: { userId } });
    await tx.passwordResetToken.deleteMany({ where: { userId } });
    await tx.savingsEvent.deleteMany({ where: { userId } });
    await tx.budget.deleteMany({ where: { userId } });
    await tx.pushSubscription.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  });

  // Verify from OUTSIDE the transaction: erased only if a fresh read says so.
  const left = await prisma.user.count({ where: { id: userId } });
  const orphans =
    (await prisma.userFavorite.count({ where: { userId } })) +
    (await prisma.userBlocklist.count({ where: { userId } })) +
    (await prisma.userProductAdd.count({ where: { userId } })) +
    (await prisma.equivalenceSuggestion.count({ where: { userId } })) +
    (await prisma.productReport.count({ where: { userId } })) +
    (await prisma.equivalenceSuggestionVote.count({ where: { userId } })) +
    (await prisma.userRecipe.count({ where: { userId } })) +
    (await prisma.groceryList.count({ where: { userId } })) +
    (await prisma.passwordResetToken.count({ where: { userId } })) +
    (await prisma.savingsEvent.count({ where: { userId } })) +
    (await prisma.budget.count({ where: { userId } })) +
    (await prisma.pushSubscription.count({ where: { userId } }));

  return { counts, left, orphans };
}
