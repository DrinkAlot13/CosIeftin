/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },

  async rewrites() {
    return [
      // /cautapret is Price Finder — a completely separate Next.js app
      // (own package.json, own Prisma/SQLite DB, own Playwright+SearXNG
      // deps) proxied server-side so it feels like one site at one domain
      // instead of a separate app on a separate port. `destination` points
      // at the `price-finder` service's Docker-internal DNS name (see
      // docker-compose.yml) — this ONLY resolves inside the compose
      // network; price-finder's container publishes no host port, so it
      // isn't reachable any other way.
      //
      // price-finder's own next.config.mjs is built with
      // `NEXT_BASE_PATH=/cautapret` for this deployment (see its comment),
      // so every route/asset/API path it renders already carries the
      // /cautapret prefix — this is a plain 1:1 passthrough, no path
      // rewriting on either side. Both rules are needed: the bare
      // "/cautapret" source (no trailing segment) and the wildcard for
      // everything under it (pages, /_next/*, /api/*).
      {
        source: "/cautapret",
        destination: "http://price-finder:3300/cautapret",
      },
      {
        source: "/cautapret/:path*",
        destination: "http://price-finder:3300/cautapret/:path*",
      },
    ];
  },

  async redirects() {
    return [
      {
        // /necategorisate became a real category ("Neîncadrate"), so the products are in the
        // sidebar and the homepage grid instead of behind one link outside the tree.
        //
        // DONE HERE, NOT WITH `permanentRedirect` IN A PAGE. That returns 308 with no Location
        // header — Next handles it client-side through the RSC payload — so a direct request, a
        // crawler or anything following the sitemap gets a 308 pointing nowhere. Verified: the
        // page version answered `308` with an empty Location. A config redirect emits a real
        // one.
        source: "/necategorisate",
        destination: "/c/neincadrate-produse",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
