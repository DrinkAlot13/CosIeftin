import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./grocery.css";
import { CookieConsent } from "@/components/CookieConsent";
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
  openGraph: {
    siteName: "CoșMic",
    locale: "ro_RO",
    type: "website",
  },
};

const THEME_SCRIPT = `try{var t=localStorage.getItem('pm_theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}`;

export const dynamic = "force-dynamic";

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
        <CookieConsent />
        <ServiceWorker />
      </body>
    </html>
  );
}
