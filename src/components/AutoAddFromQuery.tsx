"use client";
// A price-drop Telegram alert links straight to the product with ?add=1 — one tap from "it's
// cheaper now" to "it's in my list", instead of a link that only confirms the price and leaves
// the shopper to find the add button themselves. Cart state is localStorage-only and the link
// has no account to attach to, so this is client-side: land, add, clean the URL so a refresh or
// a re-share of the link does not add it again.
//
// Kept SEPARATE from AddToList (not folded into it) because useSearchParams() forces whatever
// renders it to opt out of static generation unless wrapped in Suspense. AddToList is also used
// inside ProductCard, which renders in listing grids — many per page, many pages. Only the single
// product page actually needs this; isolating it here means only that one page pays for it.
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { addItem, getActive } from "@/lib/carts";
import { recordAdd } from "@/components/AddToList";

export function AutoAddFromQuery({ slug, name, productId }: { slug: string; name: string; productId?: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("add") !== "1") return;
    if (!getActive().items.some((i) => i.slug === slug)) {
      addItem({ slug, name, qty: 1 });
      recordAdd(productId);
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("add");
    router.replace(url.pathname + url.search, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
