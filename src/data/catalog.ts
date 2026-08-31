// ---------------------------------------------------------------------------
// SAMPLE GROCERY CATALOG (DEMO DATA)
// ---------------------------------------------------------------------------
// Curated pre-set items + Romanian grocery chains. `scripts/generate-sample.ts`
// turns this into per-chain NDJSON that mimics scraper output; `scripts/ingest.ts`
// then matches + ingests it exactly like real scraped data. ALL PRICES ARE FICTIONAL.
// Replace with a real scraping pipeline for production (see docs/data-sourcing).
// ---------------------------------------------------------------------------

export type Unit = "kg" | "l" | "buc";

export type CategoryDef = { slug: string; name: string; icon?: string; parentSlug?: string; section?: "grocery" | "alcohol" };

export type ChainDef = {
  slug: string;
  name: string;
  websiteUrl: string;
  color: string;
  /// average price positioning (1.00 = neutral)
  priceBias: number;
  /// fraction of catalog carried (staples ~all)
  coverage: number;
};

export type ItemDef = {
  slug: string;
  name: string;
  brand?: string;
  categorySlug: string;
  unit: Unit;
  unitSize: number; // base amount per pack (L / kg / buc)
  packLabel: string;
};

export const CATEGORIES: CategoryDef[] = [
  { slug: "lactate", name: "Lactate & Ouă", icon: "🥛" },
  { slug: "panificatie", name: "Panificație", icon: "🍞" },
  { slug: "bauturi", name: "Băuturi", icon: "🥤" },
  { slug: "mezeluri", name: "Mezeluri & Carne", icon: "🥩" },
  { slug: "legume-fructe", name: "Legume & Fructe", icon: "🥦" },
  { slug: "bacanie", name: "Băcănie", icon: "🧂" },
  { slug: "menaj", name: "Menaj & Igienă", icon: "🧴" },
];

// Separate "alcool" storefront (compared across specialist stores, never mixed
// into the grocery views). Scrapers tag products with one of these category slugs.
export const ALCOHOL_CATEGORIES: CategoryDef[] = [
  { slug: "vin", name: "Vin", icon: "🍷", section: "alcohol" },
  { slug: "whisky", name: "Whisky", icon: "🥃", section: "alcohol" },
  { slug: "spirtoase", name: "Spirtoase", icon: "🍸", section: "alcohol" },
  { slug: "lichior", name: "Lichior", icon: "🍶", section: "alcohol" },
  { slug: "bere", name: "Bere", icon: "🍺", section: "alcohol" },
  { slug: "sampanie", name: "Șampanie & Spumant", icon: "🍾", section: "alcohol" },
  { slug: "alte-bauturi", name: "Alte băuturi", icon: "🍹", section: "alcohol" },
];

export const CHAINS: ChainDef[] = [
  { slug: "kaufland", name: "Kaufland", websiteUrl: "https://www.kaufland.ro", color: "#2a78d6", priceBias: 0.98, coverage: 1.0 },
  { slug: "lidl", name: "Lidl", websiteUrl: "https://www.lidl.ro", color: "#eb6834", priceBias: 0.96, coverage: 0.92 },
  { slug: "carrefour", name: "Carrefour", websiteUrl: "https://carrefour.ro", color: "#1baf7a", priceBias: 1.03, coverage: 0.95 },
  { slug: "auchan", name: "Auchan", websiteUrl: "https://www.auchan.ro", color: "#eda100", priceBias: 1.01, coverage: 0.9 },
  { slug: "mega-image", name: "Mega Image", websiteUrl: "https://www.mega-image.ro", color: "#e87ba4", priceBias: 1.08, coverage: 0.88 },
  { slug: "profi", name: "Profi", websiteUrl: "https://www.profi.ro", color: "#008300", priceBias: 1.05, coverage: 0.85 },
];

export const ITEMS: ItemDef[] = [
  // Lactate & Ouă
  { slug: "lapte-zuzu-35-1l", name: "Lapte Zuzu 3.5% 1L", brand: "Zuzu", categorySlug: "lactate", unit: "l", unitSize: 1, packLabel: "1 L" },
  { slug: "lapte-napolact-15-1l", name: "Lapte Napolact 1.5% 1L", brand: "Napolact", categorySlug: "lactate", unit: "l", unitSize: 1, packLabel: "1 L" },
  { slug: "iaurt-grecesc-danone-400g", name: "Iaurt grecesc Danone 400g", brand: "Danone", categorySlug: "lactate", unit: "kg", unitSize: 0.4, packLabel: "400 g" },
  { slug: "unt-president-82-200g", name: "Unt President 82% 200g", brand: "President", categorySlug: "lactate", unit: "kg", unitSize: 0.2, packLabel: "200 g" },
  { slug: "oua-marimea-m-10buc", name: "Ouă mărimea M, 10 buc", categorySlug: "lactate", unit: "buc", unitSize: 10, packLabel: "10 buc" },
  { slug: "telemea-vaca-400g", name: "Telemea de vacă 400g", categorySlug: "lactate", unit: "kg", unitSize: 0.4, packLabel: "400 g" },
  { slug: "smantana-12-400g", name: "Smântână 12% 400g", categorySlug: "lactate", unit: "kg", unitSize: 0.4, packLabel: "400 g" },
  { slug: "cascaval-delaco-300g", name: "Cașcaval Delaco 300g", brand: "Delaco", categorySlug: "lactate", unit: "kg", unitSize: 0.3, packLabel: "300 g" },

  // Panificație
  { slug: "paine-alba-feliata-500g", name: "Pâine albă feliată 500g", categorySlug: "panificatie", unit: "kg", unitSize: 0.5, packLabel: "500 g" },
  { slug: "paine-integrala-500g", name: "Pâine integrală 500g", categorySlug: "panificatie", unit: "kg", unitSize: 0.5, packLabel: "500 g" },
  { slug: "cornuri-ciocolata-6buc", name: "Cornuri cu ciocolată 6 buc", categorySlug: "panificatie", unit: "buc", unitSize: 6, packLabel: "6 buc" },
  { slug: "covrigei-200g", name: "Covrigei 200g", categorySlug: "panificatie", unit: "kg", unitSize: 0.2, packLabel: "200 g" },

  // Băuturi
  { slug: "apa-plata-2l", name: "Apă plată 2L", categorySlug: "bauturi", unit: "l", unitSize: 2, packLabel: "2 L" },
  { slug: "apa-minerala-borsec-15l", name: "Apă minerală Borsec 1.5L", brand: "Borsec", categorySlug: "bauturi", unit: "l", unitSize: 1.5, packLabel: "1,5 L" },
  { slug: "coca-cola-2l", name: "Coca-Cola 2L", brand: "Coca-Cola", categorySlug: "bauturi", unit: "l", unitSize: 2, packLabel: "2 L" },
  { slug: "suc-portocale-cappy-1l", name: "Suc portocale Cappy 1L", brand: "Cappy", categorySlug: "bauturi", unit: "l", unitSize: 1, packLabel: "1 L" },
  { slug: "bere-blonda-6x05l", name: "Bere blondă 6x0.5L", categorySlug: "bauturi", unit: "l", unitSize: 3, packLabel: "6x0,5 L" },
  { slug: "cafea-jacobs-250g", name: "Cafea Jacobs 250g", brand: "Jacobs", categorySlug: "bauturi", unit: "kg", unitSize: 0.25, packLabel: "250 g" },
  { slug: "ceai-negru-20pl", name: "Ceai negru 20 plicuri", categorySlug: "bauturi", unit: "buc", unitSize: 20, packLabel: "20 pl" },

  // Mezeluri & Carne
  { slug: "piept-pui-1kg", name: "Piept de pui 1kg", categorySlug: "mezeluri", unit: "kg", unitSize: 1, packLabel: "1 kg" },
  { slug: "ceafa-porc-1kg", name: "Ceafă de porc 1kg", categorySlug: "mezeluri", unit: "kg", unitSize: 1, packLabel: "1 kg" },
  { slug: "salam-victoria-200g", name: "Salam Victoria 200g", categorySlug: "mezeluri", unit: "kg", unitSize: 0.2, packLabel: "200 g" },
  { slug: "parizer-pui-300g", name: "Parizer de pui 300g", categorySlug: "mezeluri", unit: "kg", unitSize: 0.3, packLabel: "300 g" },
  { slug: "crenvursti-300g", name: "Crenvurști 300g", categorySlug: "mezeluri", unit: "kg", unitSize: 0.3, packLabel: "300 g" },
  { slug: "sunca-praga-150g", name: "Șuncă Praga 150g", categorySlug: "mezeluri", unit: "kg", unitSize: 0.15, packLabel: "150 g" },

  // Legume & Fructe
  { slug: "rosii-1kg", name: "Roșii 1kg", categorySlug: "legume-fructe", unit: "kg", unitSize: 1, packLabel: "1 kg" },
  { slug: "cartofi-2kg", name: "Cartofi 2kg", categorySlug: "legume-fructe", unit: "kg", unitSize: 2, packLabel: "2 kg" },
  { slug: "ceapa-1kg", name: "Ceapă 1kg", categorySlug: "legume-fructe", unit: "kg", unitSize: 1, packLabel: "1 kg" },
  { slug: "banane-1kg", name: "Banane 1kg", categorySlug: "legume-fructe", unit: "kg", unitSize: 1, packLabel: "1 kg" },
  { slug: "mere-1kg", name: "Mere 1kg", categorySlug: "legume-fructe", unit: "kg", unitSize: 1, packLabel: "1 kg" },
  { slug: "castraveti-1kg", name: "Castraveți 1kg", categorySlug: "legume-fructe", unit: "kg", unitSize: 1, packLabel: "1 kg" },
  { slug: "morcovi-1kg", name: "Morcovi 1kg", categorySlug: "legume-fructe", unit: "kg", unitSize: 1, packLabel: "1 kg" },
  { slug: "lamai-500g", name: "Lămâi 500g", categorySlug: "legume-fructe", unit: "kg", unitSize: 0.5, packLabel: "500 g" },

  // Băcănie
  { slug: "ulei-floarea-soarelui-1l", name: "Ulei floarea-soarelui 1L", categorySlug: "bacanie", unit: "l", unitSize: 1, packLabel: "1 L" },
  { slug: "faina-alba-1kg", name: "Făină albă 1kg", categorySlug: "bacanie", unit: "kg", unitSize: 1, packLabel: "1 kg" },
  { slug: "zahar-tos-1kg", name: "Zahăr tos 1kg", categorySlug: "bacanie", unit: "kg", unitSize: 1, packLabel: "1 kg" },
  { slug: "orez-bob-lung-1kg", name: "Orez cu bob lung 1kg", categorySlug: "bacanie", unit: "kg", unitSize: 1, packLabel: "1 kg" },
  { slug: "paste-barilla-500g", name: "Paste Barilla 500g", brand: "Barilla", categorySlug: "bacanie", unit: "kg", unitSize: 0.5, packLabel: "500 g" },
  { slug: "malai-1kg", name: "Mălai 1kg", categorySlug: "bacanie", unit: "kg", unitSize: 1, packLabel: "1 kg" },
  { slug: "fasole-boabe-conserva-400g", name: "Fasole boabe conservă 400g", categorySlug: "bacanie", unit: "kg", unitSize: 0.4, packLabel: "400 g" },
  { slug: "rosii-cuburi-conserva-400g", name: "Roșii cuburi conservă 400g", categorySlug: "bacanie", unit: "kg", unitSize: 0.4, packLabel: "400 g" },
  { slug: "sare-1kg", name: "Sare 1kg", categorySlug: "bacanie", unit: "kg", unitSize: 1, packLabel: "1 kg" },
  { slug: "miere-albine-500g", name: "Miere de albine 500g", categorySlug: "bacanie", unit: "kg", unitSize: 0.5, packLabel: "500 g" },

  // Menaj & Igienă
  { slug: "detergent-lichid-rufe-2l", name: "Detergent lichid rufe 2L", categorySlug: "menaj", unit: "l", unitSize: 2, packLabel: "2 L" },
  { slug: "hartie-igienica-8role", name: "Hârtie igienică 8 role", categorySlug: "menaj", unit: "buc", unitSize: 8, packLabel: "8 role" },
  { slug: "pasta-dinti-100ml", name: "Pastă de dinți 100ml", categorySlug: "menaj", unit: "l", unitSize: 0.1, packLabel: "100 ml" },
  { slug: "sapun-lichid-500ml", name: "Săpun lichid 500ml", categorySlug: "menaj", unit: "l", unitSize: 0.5, packLabel: "500 ml" },
  { slug: "servetele-umede-64buc", name: "Șervețele umede 64 buc", categorySlug: "menaj", unit: "buc", unitSize: 64, packLabel: "64 buc" },
];
