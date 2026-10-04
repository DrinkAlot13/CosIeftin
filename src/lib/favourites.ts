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

/**
 * ── DISTINCT DAYS, NOT RAW VOLUME.
 *
 * Promotion used to read `count`, which is incremented on every add. So three clicks in three
 * seconds — a double-submit, an impatient shopper, a stuck button — created an INFERRED
 * favourite, and `resolveLine` ranks those above everything except the heart. That is a
 * preference invented out of one decision.
 *
 * Three adds on three DIFFERENT days is a habit. Same threshold, better evidence.
 *
 * `count` is still kept and still shown to the shopper ("l-ai adăugat de 4 ori"), because it is
 * the true answer to a different question.
 */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

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
export async function recordAdd(userId: number, productId: number, at = new Date()): Promise<{ count: number; days: number | null; promoted: boolean }> {
  const today = utcDay(at);
  const before = await prisma.userProductAdd.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { distinctDays: true, lastAddDay: true },
  });

  // A new day for this row advances the day counter; a second add on the same day does not.
  // A row that predates these columns carries NULL, which means "not recorded" — it starts
  // counting from this add rather than pretending to know its history.
  const isNewDay = before?.lastAddDay !== today;
  const nextDays = isNewDay ? (before?.distinctDays ?? 0) + 1 : before?.distinctDays ?? null;

  const row = await prisma.userProductAdd.upsert({
    where: { userId_productId: { userId, productId } },
    update: {
      count: { increment: 1 },
      lastAddedAt: at,
      ...(isNewDay ? { distinctDays: nextDays, lastAddDay: today } : {}),
    },
    create: { userId, productId, count: 1, lastAddedAt: at, firstAddedAt: at, distinctDays: 1, lastAddDay: today },
    select: { count: true, distinctDays: true },
  });

  // THE FALLBACK, and why it is `count` rather than a refusal. A row written before these
  // columns existed has no day history and never will. Refusing to promote it would silently
  // freeze every pre-existing favourite; reading `count` reproduces exactly the old behaviour
  // for exactly those rows, and every row from here on is judged on days.
  const evidence = row.distinctDays ?? row.count;
  if (evidence < INFERRED_AFTER_ADDS) return { count: row.count, days: row.distinctDays, promoted: false };

  const existing = await prisma.userFavorite.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true },
  });
  if (existing) return { count: row.count, days: row.distinctDays, promoted: false };

  await prisma.userFavorite.create({ data: { userId, productId, source: "INFERRED" } });
  return { count: row.count, days: row.distinctDays, promoted: true };
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
  /** How far below its recent peak this product's price currently sits, precomputed nightly.
   *  null means not computed (no live offer, or not enough history) — distinct from 0. */
  dropPct: number | null;
  /** Days since this was last added — null when never recorded via recordAdd (e.g. an
   *  EXPLICIT-only favourite with no add history). */
  daysSinceLastAdd: number | null;
  /** The shopper's own average repurchase gap in days, from firstAddedAt/lastAddedAt/
   *  distinctDays — null unless at least 2 distinct days are on record, because a single data
   *  point has no interval to report. Never guessed from fewer. */
  usualGapDays: number | null;
};

/** Everything this shopper has favourited, with the evidence behind an inferred one. */
export async function listFavourites(userId: number): Promise<FavouriteRow[]> {
  const rows = await prisma.userFavorite.findMany({
    where: { userId },
    orderBy: { addedAt: "desc" },
    select: {
      productId: true, source: true, addedAt: true,
      product: {
        select: { slug: true, name: true, brand: true, image: true, dropPct: true, category: { select: { name: true, slug: true } } },
      },
    },
  });
  const adds = new Map(
    (await prisma.userProductAdd.findMany({
      where: { userId },
      select: { productId: true, count: true, lastAddedAt: true, firstAddedAt: true, distinctDays: true },
    })).map((r) => [r.productId, r]),
  );
  const now = Date.now();
  return rows.map((r) => {
    const add = adds.get(r.productId);
    const daysSinceLastAdd = add ? Math.floor((now - add.lastAddedAt.getTime()) / 86_400_000) : null;
    const usualGapDays =
      add?.firstAddedAt && add.distinctDays && add.distinctDays >= 2
        ? Math.round((add.lastAddedAt.getTime() - add.firstAddedAt.getTime()) / 86_400_000 / (add.distinctDays - 1))
        : null;
    return {
    productId: r.productId,
    slug: r.product.slug,
    name: r.product.name,
    brand: r.product.brand,
    image: r.product.image,
    source: r.source === "INFERRED" ? "INFERRED" : "EXPLICIT",
    addedAt: r.addedAt,
    addCount: add?.count ?? 0,
    dropPct: r.product.dropPct,
    categoryName: r.product.category?.name ?? "Fără categorie",
    categorySlug: r.product.category?.slug ?? null,
    daysSinceLastAdd,
    usualGapDays,
    };
  });
}
