import { prisma } from "@/lib/db";
import { abs } from "@/lib/seo";
import { CHUNK, liveOfferWhere } from "@/lib/sitemap-shape";

/**
 * THE SITEMAP INDEX, written by hand because Next does not write it.
 *
 * ── THE TRAP, caught by fetching rather than by reasoning.
 *
 * `generateSitemaps()` in `app/sitemap.ts` splits the sitemap into `/sitemap/0.xml`,
 * `/sitemap/1.xml`, … and moves the metadata route off `/sitemap.xml`. On Next 14.2 nothing
 * then serves `/sitemap.xml` at all — it falls through to the app's 404 page:
 *
 *     /sitemap.xml     404   24484B   <!DOCTYPE html><html lang="ro">…
 *     /sitemap/0.xml   200   10767B   <?xml version="1.0"…
 *     /sitemap/1.xml   200  2002827B  <?xml version="1.0"…
 *
 * `robots.txt` advertises `/sitemap.xml`. Shipping the split without this file would have made
 * the ENTIRE sitemap invisible to search engines — a far worse regression than the 246 dead
 * category URLs the split was fixing, and completely silent.
 *
 * That is the whole argument for `npm run probe:sitemap`: this was not deducible from the source,
 * only from asking the running server. See CLAUDE.md, "SOME FACTS CAN ONLY BE CHECKED AGAINST
 * THE WORLD".
 *
 * The chunk count is DERIVED from the same query and constant the children use, in
 * `lib/sitemap-shape.ts`, so the index cannot drift out of step with what it indexes. Two
 * places computing one number is how this project lost 19,000 offers to a backfill that
 * counted differently from the thing it was counting.
 */

export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const products = await prisma.product.count({ where: { offers: { some: liveOfferWhere } } });
  const productChunks = Math.max(1, Math.ceil(products / CHUNK));
  // +1 for chunk 0, which carries the static pages and the grocery categories.
  const ids = Array.from({ length: productChunks + 1 }, (_, i) => i);

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    ids.map((i) => `  <sitemap><loc>${abs(`/sitemap/${i}.xml`)}</loc></sitemap>`).join("\n") +
    `\n</sitemapindex>\n`;

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
