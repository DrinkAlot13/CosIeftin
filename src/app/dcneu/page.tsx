import { SectionListing } from "@/components/SectionListing";
import type { SortKey } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "DCNeu — prețuri discount" };

export default function DcneuPage({ searchParams }: { searchParams: { sort?: string; q?: string; cat?: string } }) {
  return (
    <SectionListing
      section="dcneu"
      base="/dcneu"
      title="🏷️ DCNeu — discount"
      blurb="Magazin discount (menaj, cosmetice, curățenie). Reduceri pe cantitate pe pagina produsului."
      sort={(searchParams.sort as SortKey) || "price-asc"}
      q={searchParams.q?.trim() || undefined}
      cat={searchParams.cat || undefined}
      emptyHint="Niciun produs DCNeu încă. Rulează scraperul (npm run scrape:dcneu)."
    />
  );
}
