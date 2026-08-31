import { SectionListing } from "@/components/SectionListing";
import type { SortKey } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Farmacie (OTC & vitamine) — comparație prețuri" };

export default function FarmaciePage({ searchParams }: { searchParams: { sort?: string; q?: string } }) {
  return (
    <SectionListing
      section="farmacie"
      base="/farmacie"
      title="💊 Farmacie — OTC & vitamine"
      blurb="Medicamente fără rețetă (OTC), vitamine și suplimente. Fără medicamente cu prescripție."
      sort={(searchParams.sort as SortKey) || "price-asc"}
      q={searchParams.q?.trim() || undefined}
      emptyHint="Niciun produs de farmacie încă. Rulează scraperul (npm run scrape:farmaciatei)."
    />
  );
}
