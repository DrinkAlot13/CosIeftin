import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { abs } from "@/lib/seo";
import { CHUNK, liveOfferWhere, sitemapCategoryWhere } from "@/lib/sitemap-shape";

// Dynamic sitemap, split into an INDEX plus chunked children.
//
// Only products a shopper can actually act on are listed: a live offer, from an active
// merchant. Listing a product whose every offer has gone stale sends a crawler to a page with
// no prices on it — a soft 404, which costs crawl budget and trains Google to trust the
// sitemap less. A sitemap that lists everything is not more thorough, it is less accurate.
//
// `lastModified` is the real last-seen date of the product's freshest offer, not `new Date()`.
// Stamping every URL with "now" on every build tells a crawler the whole catalog changed every
// deploy, and it stops believing the field.
//
// ── TWO DEFECTS FIXED HERE, both Google-facing and both found by the September audit.
//
// 1. IT ADVERTISED 246 PAGES THAT 404 (76% of its category URLs). The category query had no
//    section filter, while `/c/[slug]` resolves through `getCategoryPage`, which returns null
//    for anything that is not grocery and makes the route call `notFound()`. So every dcneu,
//    cosmetice, farmacie and alcohol category was published to search engines as a dead URL:
//
//      dcneu 171 · cosmetice 39 · farmacie 31 · alcohol 5     all 404
//      grocery 78                                             the only section /c/ serves
//
//    Those sections are not category-routed at all; they live on one page each with a `?cat=`
//    filter. Their LANDING pages are listed below instead, which is what actually resolves.
//
// 2. IT WAS ONE 9 MB FILE COSTING 5.9 SECONDS. 45,948 URLs from two unbounded queries, and the
//    slowest route on the site by a factor of four. `generateSitemaps` splits it into an index
//    plus chunks, so a crawler fetches ~2 MB at a time and each chunk caches independently.
//    Google's per-file limit is 50,000 URLs and the catalog was at 45,957 — the ceiling was
//    weeks away regardless.
//
// GUARDED BY AN ORACLE, because neither defect was visible from inside: `npm run probe:sitemap`
// fetches this sitemap over HTTP, samples 50 URLs per shape and fails on any that does not
// resolve. An internal check could not have caught #1 — the categories existed, the offers were
// live, and the database was not wrong. See CLAUDE.md, "SOME FACTS CAN ONLY BE CHECKED AGAINST
// THE WORLD".

export const revalidate = 3600;

// CHUNK and `liveOfferWhere` live in `lib/sitemap-shape.ts` because the INDEX at
// `app/sitemap.xml/route.ts` must compute the same chunk count from the same definition. Two
// files deriving one number independently is how an index comes to advertise a child that does
// not exist, and nothing inside the app can see it.
const liveOffer = liveOfferWhere;

/**
 * Chunk 0 carries the static pages and the grocery categories; chunks 1..N carry products.
 *
 * The count is queried rather than assumed, because a hard-coded chunk count silently truncates
 * the sitemap the moment the catalog outgrows it — and a missing URL is invisible from here.
 */
export async function generateSitemaps(): Promise<{ id: number }[]> {
  const products = await prisma.product.count({ where: { offers: { some: liveOffer } } });
  const productChunks = Math.max(1, Math.ceil(products / CHUNK));
  return Array.from({ length: productChunks + 1 }, (_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  if (id === 0) {
    // Only categories the `/c/[slug]` route actually serves. The other sections are reachable
    // through their own landing pages, which are listed here explicitly.
    const categories = await prisma.category.findMany({
      where: sitemapCategoryWhere,
      select: { slug: true },
    });

    const staticPages: MetadataRoute.Sitemap = [
      { url: abs("/"), changeFrequency: "daily", priority: 1 },
      { url: abs("/categorii"), changeFrequency: "weekly", priority: 0.8 },
      { url: abs("/oferte"), changeFrequency: "daily", priority: 0.8 },
      { url: abs("/lista"), changeFrequency: "weekly", priority: 0.8 },
      // The non-grocery sections. These are the URLs that actually resolve for them.
      { url: abs("/alcool"), changeFrequency: "daily", priority: 0.7 },
      { url: abs("/cosmetice"), changeFrequency: "daily", priority: 0.7 },
      { url: abs("/farmacie"), changeFrequency: "daily", priority: 0.7 },
      { url: abs("/dcneu"), changeFrequency: "daily", priority: 0.7 },
      { url: abs("/retete"), changeFrequency: "weekly", priority: 0.6 },
      { url: abs("/despre"), changeFrequency: "monthly", priority: 0.4 },
      { url: abs("/metodologie"), changeFrequency: "monthly", priority: 0.4 },
      { url: abs("/termeni"), changeFrequency: "yearly", priority: 0.2 },
      { url: abs("/confidentialitate"), changeFrequency: "yearly", priority: 0.2 },
    ];

    return [
      ...staticPages,
      ...categories.map((c) => ({
        url: abs(`/c/${c.slug}`),
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
    ];
  }

  const products = await prisma.product.findMany({
    where: { offers: { some: liveOffer } },
    select: {
      slug: true,
      offers: {
        where: liveOffer,
        select: { lastObservedAt: true },
        orderBy: { lastObservedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { id: "asc" },
    skip: (id - 1) * CHUNK,
    take: CHUNK,
  });

  return products.map((p) => ({
    url: abs(`/p/${p.slug}`),
    lastModified: p.offers[0]?.lastObservedAt ?? undefined,
    changeFrequency: "daily" as const,
    priority: 0.6,
  }));
}
