// THE CHUNKED SITEMAP CHILDREN — /sitemap/0.xml … /sitemap/N.xml
//
// ── WHY THIS IS A ROUTE HANDLER AND NOT `app/sitemap.ts`.
//
// It was the metadata convention, with `generateSitemaps()`. That produces a route Next names
// `/sitemap.xml[[...__metadata_id__]]`, which collides with the hand-written index at
// `app/sitemap.xml/route.ts`, and **`next dev` refuses to start at all**:
//
//     Error: You cannot define a route with the same specificity as a optional catch-all
//     route ("/sitemap.xml" and "/sitemap.xml[[...__metadata_id__]]")
//
// `next build` is unaffected and emits both, so the site shipped fine and only the dev server
// was dead — a shape that hides well, and one that cost real time: it is why a stale production
// server kept answering on :3000 while every "start the dev server" looked like it had worked.
//
// The index cannot move: `robots.txt` advertises `/sitemap.xml`, and Next serving a 404 there is
// the exact regression `probe:sitemap` was written after. So the CHILDREN move out of the
// metadata convention instead, to explicit routes at the same public URLs.
//
// ── THE URLS ARE UNCHANGED, WHICH IS THE POINT. Google holds `/sitemap/0.xml`. A dynamic
// segment receives the whole filename, so `id` arrives as `"0.xml"` and the extension is
// stripped here rather than being part of the identifier.
import { prisma } from "@/lib/db";
import { abs } from "@/lib/seo";
import { CHUNK, liveOfferWhere, sitemapCategoryWhere, sitemapChunkCount } from "@/lib/sitemap-shape";

export const revalidate = 3600;

/** Pre-render every chunk at build time, as `generateSitemaps` used to. */
export async function generateStaticParams(): Promise<{ id: string }[]> {
  const n = await sitemapChunkCount();
  return Array.from({ length: n }, (_, i) => ({ id: `${i}.xml` }));
}

type Entry = { url: string; lastModified?: Date; changeFrequency: string; priority: number };

/** Chunk 0: the static pages plus the grocery categories `/c/[slug]` actually serves. */
async function chunkZero(): Promise<Entry[]> {
  const categories = await prisma.category.findMany({
    where: sitemapCategoryWhere,
    select: { slug: true },
  });

  const staticPages: Entry[] = [
    { url: abs("/"), changeFrequency: "daily", priority: 1 },
    { url: abs("/categorii"), changeFrequency: "weekly", priority: 0.8 },
    { url: abs("/oferte"), changeFrequency: "daily", priority: 0.8 },
    { url: abs("/lista"), changeFrequency: "weekly", priority: 0.8 },
    // The non-grocery sections. These are the URLs that actually resolve for them — their
    // categories are NOT category-routed and publishing them cost 246 dead URLs once already.
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
    ...categories.map((c) => ({ url: abs(`/c/${c.slug}`), changeFrequency: "daily", priority: 0.7 })),
  ];
}

/** Chunks 1..N: products with a live offer, in id order so paging is stable. */
async function productChunk(id: number): Promise<Entry[]> {
  const products = await prisma.product.findMany({
    where: { offers: { some: liveOfferWhere } },
    select: {
      slug: true,
      offers: {
        where: liveOfferWhere,
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
    // The real last-seen date, never `new Date()`. Stamping "now" on every URL every deploy
    // tells a crawler the whole catalog changed and it stops believing the field.
    lastModified: p.offers[0]?.lastObservedAt ?? undefined,
    changeFrequency: "daily",
    priority: 0.6,
  }));
}

/** A slug can legally contain none of these, but the escape is free and its absence is not. */
const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const id = Number(params.id.replace(/\.xml$/i, ""));
  if (!Number.isInteger(id) || id < 0) return new Response("Not found", { status: 404 });

  // A chunk beyond the end is a 404, not an empty sitemap. An empty `<urlset>` tells a crawler
  // the section exists and holds nothing, which is a claim; a 404 says we do not publish it.
  if (id >= (await sitemapChunkCount())) return new Response("Not found", { status: 404 });

  const entries = id === 0 ? await chunkZero() : await productChunk(id);

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries
      .map((e) => {
        const mod = e.lastModified ? `<lastmod>${e.lastModified.toISOString()}</lastmod>` : "";
        return `  <url><loc>${xml(e.url)}</loc>${mod}<changefreq>${e.changeFrequency}</changefreq><priority>${e.priority}</priority></url>`;
      })
      .join("\n") +
    `\n</urlset>\n`;

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
