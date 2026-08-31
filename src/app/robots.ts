import type { MetadataRoute } from "next";
import { abs, siteUrl } from "@/lib/seo";

// robots.txt.
//
// Crawling is welcome — a price comparator lives on organic search. What is disallowed is
// everything that is not a page: the admin area, the API, and the account pages, none of which
// should ever appear in a search result and all of which cost crawl budget that the 20,000
// product pages need.
//
// `/search` is disallowed too. Every query string is a distinct URL over the same catalog, so
// letting a crawler in produces unbounded near-duplicate pages — the classic faceted-search
// crawl trap. Products are reachable through categories and the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/admin/", "/api/", "/cont", "/login", "/search"],
      },
    ],
    sitemap: abs("/sitemap.xml"),
    host: siteUrl(),
  };
}
