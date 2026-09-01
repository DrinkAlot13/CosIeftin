import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { abs } from "@/lib/seo";

// Dynamic sitemap.
//
// Only products a shopper can actually act on are listed: a live offer, from an active
// merchant. Listing a product whose every offer has gone stale sends a crawler to a page with
// no prices on it — a soft 404, which costs crawl budget and trains Google to trust the
// sitemap less. A sitemap that lists everything is not more thorough, it is less accurate.
//
// `lastModified` is the real last-seen date of the product's freshest offer, not `new Date()`.
// Stamping every URL with "now" on every build tells a crawler the whole catalog changed every
// deploy, and it stops believing the field.

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories] = await Promise.all([
    prisma.product.findMany({
      where: { offers: { some: { isStale: false, merchant: { active: true } } } },
      select: {
        slug: true,
        offers: {
          where: { isStale: false, merchant: { active: true } },
          select: { lastObservedAt: true },
          orderBy: { lastObservedAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.category.findMany({
      where: { products: { some: { offers: { some: { isStale: false, merchant: { active: true } } } } } },
      select: { slug: true },
    }),
  ]);

  const staticPages: MetadataRoute.Sitemap = [
    { url: abs("/"), changeFrequency: "daily", priority: 1 },
    { url: abs("/lista"), changeFrequency: "weekly", priority: 0.8 },
  ];

  const categoryPages: MetadataRoute.Sitemap = categories.map((c) => ({
    url: abs(`/c/${c.slug}`),
    changeFrequency: "daily" as const,
    priority: 0.7,
  }));

  const productPages: MetadataRoute.Sitemap = products.map((p) => ({
    url: abs(`/p/${p.slug}`),
    lastModified: p.offers[0]?.lastObservedAt ?? undefined,
    changeFrequency: "daily" as const,
    priority: 0.6,
  }));

  return [...staticPages, ...categoryPages, ...productPages];
}
