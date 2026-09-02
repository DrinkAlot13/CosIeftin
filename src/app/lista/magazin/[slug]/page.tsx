// "Completează coșul la <shop>" — the per-shop basket view.
//
// A page of its own rather than a panel inside /lista, because it is a different decision. The
// comparison table answers "where should I go"; this answers "if I go here, what do I come home
// with, and what does it cost including delivery and deposits". Making it a route also means it
// can be linked, shared and returned to.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ShopBasket } from "@/components/ShopBasket";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const m = await prisma.merchant.findUnique({ where: { slug: params.slug }, select: { name: true } });
  return { title: m ? `Coșul complet la ${m.name}` : "Coș" };
}

export default async function ShopBasketPage({ params }: { params: { slug: string } }) {
  const merchant = await prisma.merchant.findUnique({
    where: { slug: params.slug },
    select: { name: true, slug: true, active: true, storeType: true },
  });
  if (!merchant || !merchant.active) notFound();

  return (
    <div className="container" style={{ paddingBottom: 44 }}>
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/">Acasă</Link>
        <span className="sep">/</span>
        <Link href="/lista">Lista mea</Link>
        <span className="sep">/</span>
        <span>{merchant.name}</span>
      </nav>
      <div className="section-head" style={{ marginTop: 8 }}>
        <h1 style={{ fontSize: 26 }}>Coșul complet la {merchant.name}</h1>
      </div>
      <p className="muted" style={{ marginTop: -4, maxWidth: 660, lineHeight: 1.6 }}>
        Tot coșul, aici. Pentru fiecare produs pe care {merchant.name} nu îl are, am ales cel mai
        apropiat produs echivalent — și îți spunem exact ce am schimbat și cu cât diferă. Totalul
        include livrarea și garanția SGR.
      </p>
      <ShopBasket shopSlug={merchant.slug} />
    </div>
  );
}
