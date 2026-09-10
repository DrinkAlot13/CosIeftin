import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./grocery.css";
import { ServiceWorker } from "@/components/ServiceWorker";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { ListTray } from "@/components/ListTray";
import { getMenuCategories } from "@/lib/queries";
import { jsonLdScript, siteUrl, websiteJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: {
    default: "CoșMic — compară prețuri la alimente în România",
    template: "%s · CoșMic",
  },
  description:
    "Compară prețurile la alimente din marile lanțuri (Kaufland, Lidl, Carrefour, Auchan…) și fă-ți lista de cumpărături la cel mai mic preț.",
  manifest: "/manifest.webmanifest",
  // Without metadataBase, Next emits RELATIVE OpenGraph URLs, which most crawlers and every
  // social preview reject outright.
  metadataBase: new URL(siteUrl()),
  alternates: { canonical: "/" },
  // ── iOS IGNORES THE MANIFEST ENTIRELY. Measured with `npm run probe:pwa`: all three of these
  // were absent, so adding to the home screen produced an icon that was a SCREENSHOT OF THE PAGE
  // and a launch that opened inside Safari's chrome rather than standalone. Chrome reads the
  // manifest and needs none of this; Safari reads none of the manifest and needs all of it.
  // The two platforms overlap almost nowhere, which is why the probe checks them separately.
  appleWebApp: {
    capable: true,
    title: "CoșMic",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    // A PNG, and 180px, because that is what iOS reads and it does not scale an SVG.
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    siteName: "CoșMic",
    locale: "ro_RO",
    type: "website",
  },
};

const THEME_SCRIPT = `try{var t=localStorage.getItem('pm_theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

// The root layout reads the category menu, which changes about never. It used to declare
// `dynamic = "force-dynamic"`, and route-segment config inherits DOWNWARD — so that one line
// silently overrode the `revalidate = 3600` on the homepage and on every product page. `npm run
// build` printed every route as ƒ (Dynamic), including the two that asked to be cached, while a
// comment on the product page described caching that had never once happened.
//
// It is safe to remove because every route that genuinely needs per-request rendering — /admin,
// /cont, /login, /alerte, /carduri, /lista, /oferte, /retete, /c/[slug] — declares force-dynamic
// on ITSELF. Nothing depended on inheriting it. tests/route-config.test.ts fails if a page ever
// again claims a revalidate window an ancestor has already disabled.
export const revalidate = 3600;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const categories = await getMenuCategories();
  return (
    <html lang="ro">
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(websiteJsonLd()) }} />
        <Header categories={categories} />
        <main>{children}</main>
        <Footer categories={categories} />
        <ListTray />
        <ServiceWorker />
      </body>
    </html>
  );
}
