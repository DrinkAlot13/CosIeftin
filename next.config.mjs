/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },

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
