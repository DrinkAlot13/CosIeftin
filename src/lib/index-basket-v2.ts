// THE BASKET, VERSION 2: forty NEEDS, not forty products.
//
// ── WHY IT CHANGED, and what that costs.
//
// v1 pinned forty specific products by slug. That was the right fix for the bug it was written
// against — a runtime substring search whose membership changed whenever the catalog did, and
// which read +26.8% in three days by measuring its own composition. Pinning made the series
// mean something.
//
// It also made the per-shop table useless. No merchant carries all forty pinned products:
// Auchan best at 33/40, Kaufland at 3/40. "Cât costă coșul la fiecare magazin" rendered as a
// column of dashes, which answers nothing — and answering that is the reason a shopper opens
// the page.
//
// v2 defines each line as an EQUIVALENCE CLASS, so each shop prices the line with ITS OWN
// equivalent of "lapte integral 1 l". That is what a shopper actually compares.
//
// ── WHAT THAT RISKS, AND HOW IT IS HELD OFF.
//
// A class-based basket can get cheaper because a class resolved to a smaller or worse product,
// not because prices fell — the exact failure v1 was built to prevent, re-entering through the
// door marked "flexibility". Three things stand against it:
//
//   1. Every class carries a SIZE WINDOW. `require`/`exclude` on the name, plus `unitSize` with
//      `maxUnitSize`/`minUnitSize` where the good is sold by weight. "Lapte 1 L" cannot resolve
//      to a 200 ml bottle because the class's size is enforced by the resolver.
//   2. `npm run audit:basket-classes` reports, per class, the SIZE SPREAD of what it resolves to
//      across shops. A class resolving to 200 ml at one shop and 1 l at another is a bad class,
//      and it says so before anything is published.
//   3. The per-shop column NEVER substitutes across shops. A shop missing a class has an
//      incomplete basket and is shown as incomplete. Borrowing another shop's product to fill
//      the gap would turn "this shop is cheaper" into "this shop plus a bit of that one".
//
// ── VERSION DISCIPLINE.
//
// This is basket version 2 and it is NOT comparable with version 1. Different lines, different
// membership rule, different number. The stored v1 history is kept and never recomputed; the
// chart breaks at the boundary and labels both segments. An index that quietly splices two
// definitions together is worse than one that stops.

export const BASKET_V2_VERSION = 2;

/** The day v2 became the live definition. Everything before this is v1 and is not comparable. */
export const V2_FROM_DAY = "2026-09-07";

export type BasketV2Item = {
  /** Stable key. THE SAME KEYS AS v1 where the need is the same, so the two can be lined up
   *  side by side for a reader — which is not the same as being comparable as numbers. */
  key: string;
  /** Grouping on the page, in Romanian. */
  group: string;
  /** What the shopper reads. States the pack the class is defined around. */
  label: string;
  /** THE DEFINITION: an `EquivalenceClass.slug`. */
  classSlug: string;
};

export const INDEX_BASKET_V2: BasketV2Item[] = [
  // ── Lactate și ouă
  { key: "lapte", group: "Lactate și ouă", label: "Lapte integral, 1 l", classSlug: "lapte-integral-1l" },
  { key: "oua", group: "Lactate și ouă", label: "Ouă mărimea M, 10 buc", classSlug: "oua-m-10" },
  { key: "unt", group: "Lactate și ouă", label: "Unt 82%, 200 g", classSlug: "unt-200g" },
  { key: "margarina", group: "Lactate și ouă", label: "Margarină, 500 g", classSlug: "margarina-500g" },
  { key: "telemea", group: "Lactate și ouă", label: "Telemea de vacă, 400 g", classSlug: "branza-telemea-400g" },
  { key: "cascaval", group: "Lactate și ouă", label: "Cașcaval, 400 g", classSlug: "cascaval-400g" },
  { key: "iaurt", group: "Lactate și ouă", label: "Iaurt natural, 400 g", classSlug: "iaurt-natural-400g" },
  { key: "smantana", group: "Lactate și ouă", label: "Smântână 20%, 200 g", classSlug: "smantana-200g" },

  // ── Băcănie
  { key: "paine", group: "Băcănie", label: "Pâine albă, 500 g", classSlug: "paine-alba-500g" },
  { key: "faina", group: "Băcănie", label: "Făină albă, 1 kg", classSlug: "faina-alba-1kg" },
  { key: "malai", group: "Băcănie", label: "Mălai, 1 kg", classSlug: "malai-1kg" },
  { key: "zahar", group: "Băcănie", label: "Zahăr tos, 1 kg", classSlug: "zahar-tos-1kg" },
  { key: "sare", group: "Băcănie", label: "Sare, 1 kg", classSlug: "sare-1kg" },
  { key: "ulei", group: "Băcănie", label: "Ulei de floarea-soarelui, 1 l", classSlug: "ulei-floarea-soarelui-1l" },
  { key: "orez", group: "Băcănie", label: "Orez bob lung, 1 kg", classSlug: "orez-bob-lung-1kg" },
  { key: "paste", group: "Băcănie", label: "Paste făinoase, 500 g", classSlug: "paste-500g" },
  { key: "fasole", group: "Băcănie", label: "Fasole albă, 400 g", classSlug: "fasole-alba-400g" },
  { key: "bulion", group: "Băcănie", label: "Bulion, 300 g", classSlug: "bulion-300g" },

  // ── Carne și mezeluri
  { key: "pui", group: "Carne și mezeluri", label: "Piept de pui, la kg", classSlug: "piept-pui-1kg" },
  { key: "porc", group: "Carne și mezeluri", label: "Carne de porc, la kg", classSlug: "carne-porc-1kg" },
  { key: "salam", group: "Carne și mezeluri", label: "Salam uscat, 200 g", classSlug: "salam-uscat-200g" },
  { key: "crenvursti", group: "Carne și mezeluri", label: "Crenvurști, 450 g", classSlug: "crenvursti-450g" },

  // ── Fructe și legume
  { key: "cartofi", group: "Fructe și legume", label: "Cartofi albi, la kg", classSlug: "cartofi-1kg" },
  { key: "ceapa", group: "Fructe și legume", label: "Ceapă galbenă, la kg", classSlug: "ceapa-galbena-kg" },
  { key: "morcovi", group: "Fructe și legume", label: "Morcovi, la kg", classSlug: "morcovi-kg" },
  { key: "rosii", group: "Fructe și legume", label: "Roșii, la kg", classSlug: "rosii-kg" },
  { key: "castraveti", group: "Fructe și legume", label: "Castraveți, la kg", classSlug: "castraveti-kg" },
  // GOLDEN, not "apples". v1's line was "Mere Golden, cca 1 kg", so this is the faithful
  // translation of it — and the generic `mere-kg` class holds one product with no live offer,
  // because the apple classes are deliberately split by variety and the unqualified one is left
  // holding whatever fits nowhere. Pointing at `mere-kg` was my mapping error, not a catalog gap.
  { key: "mere", group: "Fructe și legume", label: "Mere Golden, la kg", classSlug: "mere-golden-kg" },
  { key: "banane", group: "Fructe și legume", label: "Banane, la kg", classSlug: "banane-kg" },
  { key: "portocale", group: "Fructe și legume", label: "Portocale, la kg", classSlug: "portocale-kg" },

  // ── Băuturi
  { key: "apa", group: "Băuturi", label: "Apă plată, 2 l", classSlug: "apa-plata-2l" },
  { key: "cafea", group: "Băuturi", label: "Cafea măcinată, 250 g", classSlug: "cafea-macinata-250g" },
  { key: "ceai", group: "Băuturi", label: "Ceai de fructe, 20 plicuri", classSlug: "ceai-fructe-20" },
  { key: "suc", group: "Băuturi", label: "Suc de portocale, 1 l", classSlug: "suc-portocale-1l" },
  { key: "bere", group: "Băuturi", label: "Bere blondă, 0,5 l", classSlug: "bere-blonda-500ml" },

  // ── Curățenie și igienă
  { key: "hartie", group: "Curățenie și igienă", label: "Hârtie igienică, 8 role", classSlug: "hartie-igienica-8" },
  { key: "detergent", group: "Curățenie și igienă", label: "Detergent lichid de rufe, 3 l", classSlug: "detergent-rufe-3l" },
  { key: "sapun", group: "Curățenie și igienă", label: "Săpun solid, 90 g", classSlug: "sapun-solid-90g" },
  { key: "pasta_dinti", group: "Curățenie și igienă", label: "Pastă de dinți, 75 ml", classSlug: "pasta-dinti-75ml" },
  { key: "sampon", group: "Curățenie și igienă", label: "Șampon, 400 ml", classSlug: "sampon-400ml" },
];

export const BASKET_V2_GROUPS: string[] = [...new Set(INDEX_BASKET_V2.map((i) => i.group))];
