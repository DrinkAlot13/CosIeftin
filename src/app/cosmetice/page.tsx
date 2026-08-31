import { SectionListing } from "@/components/SectionListing";
import type { SortKey } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cosmetice — comparație prețuri" };

export default function CosmeticePage({ searchParams }: { searchParams: { sort?: string; q?: string } }) {
  return (
    <SectionListing
      section="cosmetice"
      base="/cosmetice"
      title="💄 Cosmetice"
      blurb="Cosmetice și îngrijire personală. Prețuri de la magazine specializate."
      sort={(searchParams.sort as SortKey) || "price-asc"}
      q={searchParams.q?.trim() || undefined}
      emptyHint="Niciun produs cosmetic încă. Rulează scraperul (npm run scrape:farmaciatei)."
    />
  );
}
