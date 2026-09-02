// Favourites: what this shopper keeps buying, and what the resolver should prefer.
//
// Two sources, deliberately different in strength:
//
//   EXPLICIT — they pressed the heart. A statement of preference.
//   INFERRED — they added it to a list three times. Evidence, not a statement.
//
// `resolveLine` already ranks explicit above inferred above everything else; it just never had
// any rows to read, because nothing wrote them. This is the writer.
//
// WHY INFERRED IS DERIVED AND NOT STORED AS A FLAG: the count is kept in `UserProductAdd` and
// the favourite is created when it crosses the threshold. Keeping the evidence means the
// threshold can move — three is a product decision, not a fact — and a boolean would have
// thrown the evidence away. It also means an inferred favourite can be explained to the
// shopper: "l-ai adăugat de 4 ori".

import { prisma } from "./db";

/** Adds before a product becomes an inferred favourite. */
export const INFERRED_AFTER_ADDS = 3;

export type FavouriteSource = "EXPLICIT" | "INFERRED";

/** Both favourite sets for the resolver's UserContext. */
export async function favouriteIdsFor(userId: number | null): Promise<{
  explicit: Set<number>;
  inferred: Set<number>;
}> {
  if (userId == null) return { explicit: new Set(), inferred: new Set() };
  const rows = await prisma.userFavorite.findMany({
    where: { userId },
    select: { productId: true, source: true },
  });
  const explicit = new Set<number>();
  const inferred = new Set<number>();
  for (const r of rows) (r.source === "INFERRED" ? inferred : explicit).add(r.productId);
  return { explicit, inferred };
}

/**
 * Turn the heart on or off. Returns the state afterwards.
 *
 * Un-hearting an EXPLICIT favourite removes it outright rather than demoting it to INFERRED,
 * even when the shopper has added it five times. An explicit "no" outranks accumulated
 * evidence — the whole point of the heart is that the shopper gets the last word.
 */
export async function toggleFavourite(userId: number, productId: number): Promise<{ favourite: boolean; source: FavouriteSource | null }> {
  const existing = await prisma.userFavorite.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true, source: true },
  });
  if (existing) {
    await prisma.userFavorite.delete({ where: { id: existing.id } });
    // Reset the evidence too, or the next add re-creates it and the "no" looks ignored.
    await prisma.userProductAdd.deleteMany({ where: { userId, productId } });
    return { favourite: false, source: null };
  }
  await prisma.userFavorite.create({ data: { userId, productId, source: "EXPLICIT" } });
  return { favourite: true, source: "EXPLICIT" };
}

/**
 * Record that a product was added to a list, and promote it to an inferred favourite once it
 * crosses the threshold.
 *
 * Idempotent in the sense that matters: the favourite row is created at most once, and an
 * EXPLICIT favourite is never overwritten by an INFERRED one.
 */
export async function recordAdd(userId: number, productId: number): Promise<{ count: number; promoted: boolean }> {
  const row = await prisma.userProductAdd.upsert({
    where: { userId_productId: { userId, productId } },
    update: { count: { increment: 1 }, lastAddedAt: new Date() },
    create: { userId, productId, count: 1 },
    select: { count: true },
  });

  if (row.count < INFERRED_AFTER_ADDS) return { count: row.count, promoted: false };

  const existing = await prisma.userFavorite.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true },
  });
  if (existing) return { count: row.count, promoted: false };

  await prisma.userFavorite.create({ data: { userId, productId, source: "INFERRED" } });
  return { count: row.count, promoted: true };
}

export type FavouriteRow = {
  productId: number;
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  source: FavouriteSource;
  addedAt: Date;
  addCount: number;
  categoryName: string;
  categorySlug: string | null;
};

/** Everything this shopper has favourited, with the evidence behind an inferred one. */
export async function listFavourites(userId: number): Promise<FavouriteRow[]> {
  const rows = await prisma.userFavorite.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
    select: {
      productId: true, source: true, addedAt: true,
      product: {
        select: { slug: true, name: true, brand: true, image: true, category: { select: { name: true, slug: true } } },
      },
    },
  });
  const counts = new Map(
    (await prisma.userProductAdd.findMany({ where: { userId }, select: { productId: true, count: true } }))
      .map((r) => [r.productId, r.count]),
  );
  return rows.map((r) => ({
    productId: r.productId,
    slug: r.product.slug,
    name: r.product.name,
    brand: r.product.brand,
    image: r.product.image,
    source: r.source === "INFERRED" ? "INFERRED" : "EXPLICIT",
    addedAt: r.addedAt,
    addCount: counts.get(r.productId) ?? 0,
    categoryName: r.product.category?.name ?? "Fără categorie",
    categorySlug: r.product.category?.slug ?? null,
  }));
}
