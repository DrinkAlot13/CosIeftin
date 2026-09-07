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

  const cats = await prisma.category.findMany({
    where: { section },
    select: { id: true, slug: true, name: true, icon: true, parentId: true },
  });

  // ONE PASS, NOT ONE QUERY PER CATEGORY.
  //
  // This was a `product.count()` per category inside a Promise.all — 85 counts, each with a
  // correlated `offers: { some: … }` subquery, on every category page load. It took 8.5
  // SECONDS while the page's own product query took 93 ms, so 99% of the wait was the
  // sidebar. Promise.all made it concurrent, not cheap: SQLite still runs 85 scans.
  //
  // The definition is unchanged — the same `currentOfferWhere()`, so the count still equals
  // the list it heads. Only the arithmetic moved: fetch the live offers once and group them
  // here, exactly as `getComparability` does in 262 ms while answering a bigger question.
  const offerRows = await prisma.offer.findMany({
    where: { ...live, product: { section } },
    select: { productId: true, product: { select: { categoryId: true } } },
  });

  // Distinct PRODUCTS per category — an offer per merchant must not count the product twice.
  const productsPerCategory = new Map<number, Set<number>>();
  const uncategorisedProducts = new Set<number>();
  const allProducts = new Set<number>();
  for (const r of offerRows) {
    allProducts.add(r.productId);
    const cid = r.product.categoryId;
    if (cid == null) { uncategorisedProducts.add(r.productId); continue; }
    const set = productsPerCategory.get(cid) ?? new Set<number>();
    set.add(r.productId);
    productsPerCategory.set(cid, set);
  }
  const counts = new Map<number, number>();
  for (const c of cats) counts.set(c.id, productsPerCategory.get(c.id)?.size ?? 0);

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

  // From the same single pass, so these cannot drift from the per-category numbers above.
  return { departments, uncategorised: uncategorisedProducts.size, total: allProducts.size };
}
