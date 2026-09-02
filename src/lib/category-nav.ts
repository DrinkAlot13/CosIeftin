// The data behind the category sidebar.
//
// THE COUNT MUST MATCH THE LIST IT HEADS. A sidebar saying "Lapte (412)" that opens onto 380
// products is worse than no number at all: it is a promise the page breaks two clicks later,
// and it is the kind of thing nobody notices for months because both halves look reasonable
// on their own.
//
// So this counts with `currentOfferWhere()` — the same "a price we can stand behind" filter the
// category page's own listing reduces to. Not a similar filter written here; THE filter,
// imported. Two definitions of "shown" is how three audits once reported 8,822 phantom
// failures, and it is the same shape as the two outlier thresholds and the two size parsers.
//
// Delivery-platform rows are excluded by that filter, so a Glovo-only product is counted
// nowhere — which is correct, because it renders nowhere.

import { prisma } from "./db";
import { currentOfferWhere } from "./queries";
import { isCatchAll } from "./category/tree";

export type NavLeaf = {
  slug: string;
  name: string;
  count: number;
  /** True for the "Altele — X" leaves: the remainder of a department, not a shelf. */
  isRemainder: boolean;
};

export type NavDepartment = {
  slug: string;
  name: string;
  icon: string | null;
  count: number;
  leaves: NavLeaf[];
};

export type CategoryNav = {
  departments: NavDepartment[];
  /** Products in this section with a live offer and NO category at all. */
  uncategorised: number;
  /** Everything with a live offer, categorised or not — the denominator. */
  total: number;
};

/**
 * Build the nav for one section.
 *
 * Empty leaves are dropped. A leaf with no products is not a navigation choice, it is a dead
 * end that costs a click — and after the Bebeluși merge there should be none, but a leaf can
 * empty out again on any night when a merchant stops carrying something.
 */
export async function getCategoryNav(section = "grocery"): Promise<CategoryNav> {
  const live = currentOfferWhere();
  const hasLiveOffer = { offers: { some: live } } as const;

  const cats = await prisma.category.findMany({
    where: { section },
    select: { id: true, slug: true, name: true, icon: true, parentId: true },
  });

  const counts = new Map<number, number>();
  await Promise.all(
    cats.map(async (c) => {
      counts.set(c.id, await prisma.product.count({ where: { section, categoryId: c.id, ...hasLiveOffer } }));
    }),
  );

  const departments: NavDepartment[] = cats
    .filter((c) => c.parentId === null)
    .map((d) => {
      const leaves = cats
        .filter((c) => c.parentId === d.id)
        .map((l) => ({
          slug: l.slug,
          name: l.name,
          count: counts.get(l.id) ?? 0,
          isRemainder: isCatchAll(l.slug),
        }))
        .filter((l) => l.count > 0)
        // Shelves first, alphabetically; the remainder always last, because that is what it is.
        .sort((a, b) => Number(a.isRemainder) - Number(b.isRemainder) || b.count - a.count);
      return {
        slug: d.slug,
        name: d.name,
        icon: d.icon,
        // The department's own number is the SUM OF WHAT IT SHOWS, not a separate query.
        // Counting products directly on the department would let the header disagree with the
        // rows underneath it the moment anything sits in the wrong place.
        count: leaves.reduce((s, l) => s + l.count, 0),
        leaves,
      };
    })
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count);

  const [uncategorised, total] = await Promise.all([
    prisma.product.count({ where: { section, categoryId: null, ...hasLiveOffer } }),
    prisma.product.count({ where: { section, ...hasLiveOffer } }),
  ]);

  return { departments, uncategorised, total };
}
