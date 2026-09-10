// /lista/in-magazin — the in-shop screen.
//
// NOT /lista/magazin: that segment is already taken by `/lista/magazin/[slug]`, "coșul complet
// la <shop>", which answers a different question — "if I go here, what do I come home with".
// A parent route there would make one path segment mean two unrelated things, and the person it
// would confuse is the one holding the phone in an aisle. Its own route rather than a query flag on /lista so it
// can be a PWA shortcut, be bookmarked, and be opened straight from the home screen without
// loading the builder first.
import Link from "next/link";
import { ShopMode } from "@/components/ShopMode";

export const dynamic = "force-dynamic";
export const metadata = { title: "În magazin", robots: { index: false } };

export default function MagazinPage() {
  return (
    <div className="container shopmode-page">
      <div className="shopmode-head">
        <h1>În magazin</h1>
        <Link href="/lista" className="muted" style={{ fontSize: 14 }}>listă</Link>
      </div>
      <ShopMode />
    </div>
  );
}
