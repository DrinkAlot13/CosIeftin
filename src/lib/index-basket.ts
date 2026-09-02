// THE BASKET. Forty specific products, pinned by slug, written down here and nowhere else.
//
// WHY IT IS PINNED, with the evidence. The previous version resolved each line at RUNTIME with
// a substring search — `nameNorm contains "cafea"`, size within ±25%, cheapest wins. What that
// actually priced:
//
//     Cafea 250g      →  RIOBA Lapte pentru Cafea 10% 25 x 7,5 g     2,40 lei   (coffee creamer)
//     Unt 200g        →  MUNTE LACT Creminos cu Unt 60% 200 g        4,23 lei   ("unt" inside "MUNTE")
//     Brânză telemea  →  aro Branza Proaspata 0,5% grasime 500 g     7,06 lei   (not telemea)
//     Cartofi 1kg     →  Cartofi cu coaja neprajiti (fara ulei) 1 kg 7,19 lei   (a prepared food)
//
// and because "cheapest match wins" is evaluated fresh every time, the membership changed
// whenever the catalog did. The two stored snapshots read 79,71 lei on 30 August and 101,06 lei
// on 2 September — **+26,8% in three days**, which is not inflation. It is the basket measuring
// its own composition. An index whose contents move cannot measure a price change, because you
// cannot tell the two apart afterwards.
//
// So: one slug per line, chosen once, by hand. If a slug stops resolving the line is reported
// MISSING and the month is marked incomplete. It is NEVER re-matched to something similar and
// never interpolated — a substitution is exactly the silent composition change this file exists
// to prevent.
//
// EACH LINE IS ONE PACK, AS SOLD. There is deliberately no normalisation to "per kg": dividing
// by `unitSize` and multiplying by a reference size is what let a 0,91 kg chicken breast be
// priced as "Piept de pui 1kg" at 31,44 lei. The basket is what these forty packs cost at the
// till, and every label states the real pack.
//
// CHANGING THIS FILE BREAKS THE SERIES, and that is intentional. Any edit — adding a line,
// repinning one — makes months before and after non-comparable. Bump BASKET_VERSION when you do
// it; the page shows the version and refuses to compare across two of them.

export const BASKET_VERSION = 1;

export type BasketItem = {
  /** Stable key. Never reused for a different product. */
  key: string;
  /** Shown to the shopper. States the real pack size, because that is what is priced. */
  label: string;
  /** Grouping on the page, in Romanian. */
  group: string;
  /** THE PIN. `Product.slug`. */
  slug: string;
  /** The product name at the time of pinning, so a repointed slug is visible rather than silent. */
  expectedName: string;
};

export const INDEX_BASKET: BasketItem[] = [
  // ── Lactate și ouă
  { key: "lapte", group: "Lactate și ouă", label: "Lapte integral 3,7%, 1 l", slug: "lapte-de-consum-integral-olympus-3-7-grasime-1-l-5941875900376", expectedName: "Lapte de consum integral Olympus, 3.7% grasime, 1 l" },
  { key: "oua", group: "Lactate și ouă", label: "Ouă mărimea M, 10 buc", slug: "oua-de-gaina-regalina-marime-m-cod-2-10-bucati-6425639102309", expectedName: "Oua de gaina, Regalina, marime M, cod 2, 10 bucati" },
  { key: "unt", group: "Lactate și ouă", label: "Unt 82%, 200 g", slug: "unt-albalact-82-grasime-200-g-5941355011967", expectedName: "Unt Albalact, 82% grasime, 200 g" },
  { key: "margarina", group: "Lactate și ouă", label: "Margarină, 500 g", slug: "linco-neata-margarina-500-g-g500kg", expectedName: "Linco Neata Margarina 500 g" },
  { key: "telemea", group: "Lactate și ouă", label: "Telemea de vacă, 350 g", slug: "telemea-de-vaca-olympus-350-g-5202178000980", expectedName: "Telemea de vaca Olympus, 350 g" },
  { key: "cascaval", group: "Lactate și ouă", label: "Cașcaval, 350 g", slug: "cascaval-delaco-desenvis-350-g-5941360006514", expectedName: "Cascaval Delaco DeSenvis, 350 g" },
  { key: "iaurt", group: "Lactate și ouă", label: "Iaurt natural 5%, 300 g", slug: "iaurt-natural-laptaria-cu-caimac-5-grasime-300-g-5941905044049", expectedName: "Iaurt natural Laptaria cu caimac, 5% grasime, 300 g" },
  { key: "smantana", group: "Lactate și ouă", label: "Smântână 20%, 200 g", slug: "smantana-olympus-20-grasime-200-g-5941875903179", expectedName: "Smantana Olympus, 20% grasime, 200 g" },

  // ── Panificație și băcănie
  { key: "paine", group: "Panificație și băcănie", label: "Pâine albă feliată, 500 g", slug: "paine-alba-feliata-vel-pitar-500-g-5941143015443", expectedName: "Paine alba feliata Vel Pitar, 500 g" },
  { key: "faina", group: "Panificație și băcănie", label: "Făină albă 000, 1 kg", slug: "faina-alba-de-grau-superioara-000-baneasa-1-kg-5941142000020", expectedName: "Faina alba de grau superioara 000 Baneasa, 1 kg" },
  { key: "malai", group: "Panificație și băcănie", label: "Mălai, 1 kg", slug: "malai-titan-extra-gold-1-kg-5941442000522", expectedName: "Malai Titan Extra Gold, 1 kg" },
  { key: "zahar", group: "Panificație și băcănie", label: "Zahăr alb cristal, 1 kg", slug: "zahar-alb-cristal-margaritar-1-kg-5941223000079", expectedName: "Zahar alb cristal Margaritar, 1 kg" },
  { key: "sare", group: "Panificație și băcănie", label: "Sare iodată, 1 kg", slug: "sare-de-bucatarie-iodata-gema-marunta-salrom-1-kg-5946003201066", expectedName: "Sare de bucatarie iodata gema marunta Salrom, 1 kg" },
  { key: "ulei", group: "Panificație și băcănie", label: "Ulei de floarea-soarelui, 1 l", slug: "ulei-de-floarea-soarelui-bunica-1-l-5941705000016", expectedName: "Ulei de floarea soarelui Bunica, 1 l" },
  { key: "orez", group: "Panificație și băcănie", label: "Orez, 1 kg", slug: "orez-pentru-pilaf-deroni-1-kg-5948825001039", expectedName: "Orez pentru pilaf Deroni, 1 Kg" },
  { key: "paste", group: "Panificație și băcănie", label: "Paste făinoase, 500 g", slug: "paste-fainoase-baneasa-cornetti-rigate-500-g-5941142002482", expectedName: "Paste fainoase Baneasa Cornetti Rigate, 500 g" },
  { key: "fasole", group: "Panificație și băcănie", label: "Fasole albă, 400 g", slug: "fasole-alba-extra-maxim-s-400-g-8009755009018", expectedName: "Fasole alba extra Maxim's, 400 g" },
  { key: "bulion", group: "Panificație și băcănie", label: "Bulion 18%, 300 g", slug: "bulion-auchan-concentratie-18-300g-5949084019513", expectedName: "Bulion Auchan concentratie 18%, 300g" },

  // ── Carne și mezeluri
  { key: "pui", group: "Carne și mezeluri", label: "Piept de pui cu os, cca 0,91 kg", slug: "ferma-vranceana-piept-de-pui-cu-os-si-piele-cca-0-91-kg-g910kg", expectedName: "Ferma Vranceana Piept de pui cu os si piele cca 0,91 kg" },
  { key: "porc", group: "Carne și mezeluri", label: "Carne tocată de porc, 1 kg", slug: "metro-chef-carne-tocata-porc-ambalata-in-tavita-1-kg-g1000kg", expectedName: "METRO Chef Carne Tocata Porc Ambalata in Tavita 1 Kg" },
  { key: "salam", group: "Carne și mezeluri", label: "Salam uscat, 200 g", slug: "salam-uscat-agricola-200-g-5941460012118", expectedName: "Salam uscat Agricola, 200 g" },
  { key: "crenvursti", group: "Carne și mezeluri", label: "Crenvurști de pui, 450 g", slug: "crenvursti-cu-piept-de-pui-caroli-450-g-5941259016419", expectedName: "Crenvursti cu piept de pui Caroli, 450 g" },

  // ── Legume și fructe
  { key: "cartofi", group: "Legume și fructe", label: "Cartofi albi, 5 kg", slug: "cartofi-albi-5-kg-4056489799757", expectedName: "Cartofi albi, 5 kg" },
  { key: "ceapa", group: "Legume și fructe", label: "Ceapă galbenă, 1 kg", slug: "ceapa-galbena-plasuta-1-kg-g1000kg", expectedName: "Ceapa galbena plasuta 1 kg" },
  { key: "morcovi", group: "Legume și fructe", label: "Morcovi, 1 kg", slug: "morcovi-1-kg-g1000kg", expectedName: "Morcovi 1 Kg" },
  { key: "rosii", group: "Legume și fructe", label: "Roșii românești, cca 1 kg", slug: "rosii-romanesti-1-kg-2122142000002", expectedName: "Rosii romanesti, +/- 1 kg" },
  { key: "castraveti", group: "Legume și fructe", label: "Castraveți Cornichon, cca 1 kg", slug: "castraveti-cornichon-1-kg-2122020000001", expectedName: "Castraveti Cornichon, +/- 1 kg" },
  { key: "mere", group: "Legume și fructe", label: "Mere Golden, cca 1 kg", slug: "mere-golden-1-kg-2122050000002", expectedName: "Mere Golden, +/- 1 kg" },
  { key: "banane", group: "Legume și fructe", label: "Banane, cca 1 kg", slug: "banane-1-kg-2122164000000", expectedName: "Banane, +/- 1 kg" },
  { key: "portocale", group: "Legume și fructe", label: "Portocale la plasă, 1 kg", slug: "portocale-plasa-1-kg-1-kg-g1000kg", expectedName: "Portocale plasa 1 kg 1 kg" },

  // ── Băuturi
  { key: "apa", group: "Băuturi", label: "Apă minerală plată, 2 l", slug: "apa-minerala-naturala-plata-biborteni-2-l-5942330007432", expectedName: "Apa minerala naturala plata Biborteni, 2 l" },
  { key: "cafea", group: "Băuturi", label: "Cafea măcinată, 250 g", slug: "cafea-macinata-si-prajita-lavazza-qualita-oro-250-g-8000070019911", expectedName: "Cafea macinata si prajita Lavazza Qualita Oro, 250 g" },
  { key: "ceai", group: "Băuturi", label: "Ceai de fructe, 20 plicuri", slug: "ceai-de-fructe-de-padure-fares-padurea-racoroasa-20-plicuri-5941141015100", expectedName: "Ceai de fructe de padure Fares Padurea Racoroasa, 20 plicuri" },
  { key: "suc", group: "Băuturi", label: "Suc de portocale, 1 l", slug: "suc-de-portocale-santal-1-l-5942218001118", expectedName: "Suc de portocale Santal, 1 l" },
  { key: "bere", group: "Băuturi", label: "Bere blondă, 0,5 l", slug: "bere-blonda-neumarkt-0-5-l-5942105008978", expectedName: "Bere blonda Neumarkt, 0.5 l" },

  // ── Curățenie și igienă
  { key: "hartie", group: "Curățenie și igienă", label: "Hârtie igienică, 10 role", slug: "aro-hartie-igienica-piersica-2-straturi-10-role-g10000buc", expectedName: "aro Hartie Igienica Piersica 2 Straturi 10 role" },
  { key: "detergent", group: "Curățenie și igienă", label: "Detergent de rufe, 2 kg", slug: "savex-parfum-whites-color-detergent-rufe-2-kg-g2000kg", expectedName: "Savex Parfum Whites & Color Detergent Rufe 2 Kg" },
  { key: "sapun", group: "Curățenie și igienă", label: "Săpun solid, 90 g", slug: "sapun-solid-antibacterian-protex-plus-moisture-lock-sensitive-90-g-8718951616837", expectedName: "Sapun solid antibacterian Protex Plus Moisture Lock Sensitive, 90 g" },
  { key: "pasta_dinti", group: "Curățenie și igienă", label: "Pastă de dinți, 75 ml", slug: "pasta-de-dinti-sensodyne-deep-clean-75-ml-5054563190772", expectedName: "Pasta de dinti Sensodyne Deep Clean, 75 ml" },
  { key: "sampon", group: "Curățenie și igienă", label: "Șampon, 400 ml", slug: "sampon-de-par-schauma-cu-ulei-de-argan-si-macadamia-400-ml-9000101653045", expectedName: "Sampon de par Schauma cu ulei de argan si macadamia, 400 ml" },
];

/** The groups, in the order they are shown. */
export const BASKET_GROUPS: string[] = [...new Set(INDEX_BASKET.map((i) => i.group))];
