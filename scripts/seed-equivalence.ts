// Seed the EquivalenceClass table: 30 hand-written canonical NEEDS covering the common
// Romanian basket. A class is what a shopper wants, not a product — two products in the
// same class are interchangeable for that need.
//
// `attributes` holds only what genuinely DISTINGUISHES variants inside the need. Fat
// content separates milks; egg size separates eggs; roast does not separate coffee for
// most shoppers, so it is absent. Getting this list right is what makes substitution feel
// smart rather than careless.
//
// Products are NOT auto-assigned here — that is a later, evidence-driven step.
//
// Run: npm run seed:equivalence

import { prisma } from "../src/lib/db";
import { PRODUCE_CLASSES } from "../src/data/produce-classes";
import { PRIVATE_LABEL_CLASSES } from "../src/data/private-label-classes";
import { STAPLE_CLASSES } from "../src/data/staple-classes";
// Recovered, not written this session: real curated classes (cider, tofu, dried basil, sour
// borscht, flatbread) that existed on disk but were never imported here, so every seed run
// silently deleted their DB rows as "not defined in code" — the tool working exactly as
// designed, against a wiring bug rather than a bad class. See the file's own header for why
// each one survived a much larger rejected shortlist.
import { BATCH1_CLASSES } from "../src/data/batch1-classes";

type Klass = { slug: string; label: string; section?: string; unit: string; unitSize: number; attributes: Record<string, unknown> & { require?: string[]; exclude?: string[] } };

// The fresh-produce classes live in their own file — 60-odd of them, written against the names
// actually in the catalog rather than from memory, and carrying `anySize` because loose produce
// is sold by weight. See src/data/produce-classes.ts for what is deliberately kept apart.
const CLASSES: Klass[] = [
  // ══ ADDED FOR BASKET v2 ══════════════════════════════════════════════════════════════════
  //
  // The class-based Index needs a class for every one of its forty lines. These ten had none,
  // and each rule below is written against names actually in the catalog — sampled first,
  // never from memory. Where the catalog cannot support a class honestly that is reported by
  // `audit:basket-classes` rather than papered over with a loose rule.

  // 2 live products at ONE shop. Kept as a class so the line is defined; the audit will say it
  // can never be a comparison, which is the honest state of the catalog, not a bug to hide.
  { slug: "margarina-500g", label: "Margarină, 500 g", unit: "kg", unitSize: 0.5, attributes: { tip: "margarina", require: ["margarina"], exclude: ["unt|crema|aluat|foietaj"] } },

  // "fasole" alone returns zacusca, fasole bătută, tinned beans with pork, and green beans.
  // The class is DRY WHITE BEANS in a tin, so everything else is named out.
  { slug: "fasole-alba-400g", label: "Fasole albă, 400 g", unit: "kg", unitSize: 0.4, attributes: { tip: "alba", require: ["fasole"], exclude: ["verde|rosie|neagra|galbena|pastai|zacusca|batuta|ciolan|costita|carnati|afumat|mix|supa|iahnie"] } },
  { slug: "bulion-300g", label: "Bulion, 300 g", unit: "kg", unitSize: 0.3, attributes: { tip: "bulion", require: ["bulion"], exclude: ["sos|paste|ketchup"] } },

  // 158 "salam" products across 7 shops, most of them 100 g sliced packs — a different trade
  // from a dry sausage bought by the piece. `uscat` is the discriminator the catalog itself
  // uses ("Salam uscat mozaic", "Salam de vara uscat").
  { slug: "salam-uscat-200g", label: "Salam uscat, 200 g", unit: "kg", unitSize: 0.2, attributes: { tip: "uscat", require: ["salam", "uscat|sibiu|sasesc|banatean"], exclude: ["feliat|felii|baguette|piknic|snack|pate|conserva"] } },
  { slug: "crenvursti-450g", label: "Crenvurști, 450 g", unit: "kg", unitSize: 0.45, attributes: { tip: "crenvursti", require: ["crenvursti"], exclude: ["foietaj|vegetal|conserva|pizza"] } },

  // ── Băuturi
  // "Ceai" also returns iced tea in bottles, green tea and single herbs. The basket line is a
  // box of fruit teabags, so `fructe` is required and the rest named out.
  { slug: "ceai-fructe-20", label: "Ceai de fructe, 20 plicuri", unit: "buc", unitSize: 20, attributes: { tip: "fructe", require: ["ceai", "fructe|zmeura|capsuni|merisor|soc|padure"], exclude: ["rece|sticla|instant|verde|negru|musetel|rooibos|matcha|slabit|copii|bebe"] } },
  // Most 1 l "suc" in the catalog is apple or a mixed nectar. Orange is the line.
  { slug: "suc-portocale-1l", label: "Suc de portocale, 1 l", unit: "l", unitSize: 1, attributes: { fruct: "portocale", require: ["portocale", "suc"], exclude: ["nectar|bautura|carbogazoas|concentrat|sirop|clementine|mixt|morcovi"] } },

  // ── Curățenie și igienă
  { slug: "sapun-solid-90g", label: "Săpun solid, 90 g", unit: "kg", unitSize: 0.09, attributes: { forma: "solid", require: ["sapun", "solid"], exclude: ["lichid|gel|dozator|rufe|vase|spuma"] } },

  // BOTH ARE `grocery`, deliberately, and that is not where you would first look for them.
  //
  // Toothpaste and shampoo appear in TWO of our storefront sections: Auchan's sit in grocery
  // (Curățenie și igienă) and Farmacia Tei's in cosmetice. A class is a NEED, so the temptation
  // is to let it span both — but `propose:equivalence` then matches a product from one section
  // into a class belonging to another, which is a door nobody meant to open. Sections are
  // storefront groupings, not product taxonomy, and letting classes cross them quietly would
  // change what the substitution engine offers on every section page.
  //
  // So: same-section membership, enforced in the assigner, and these two are filed where the
  // products with readable sizes actually are.
    // UNIT IS LITRES, not millilitres. The catalog stores "Pasta de dinti … 75 ml" as 0.075 l, so
  // a class declared in `ml` matched nothing and the basket reported "no shop can fill it" —
  // a definition error of mine reading as a catalog gap. Caught by audit:basket-classes.
  { slug: "pasta-dinti-75ml", label: "Pastă de dinți, 75 ml", unit: "l", unitSize: 0.075, attributes: { tip: "pasta de dinti", require: ["pasta de dinti"], exclude: ["periuta|apa de gura|copii|junior|gel albire|pachet"] } },
    { slug: "sampon-400ml", label: "Șampon, 400 ml", unit: "l", unitSize: 0.4, attributes: { tip: "sampon", require: ["sampon"], exclude: ["uscat|balsam|masca|copii|bebe|caini|pisici|covoare|auto|dermatologic"] } },

  // ── dairy & eggs ──
  { slug: "oua-l-10", label: "Ouă mărimea L, 10 buc", unit: "buc", unitSize: 10, attributes: { size: "L", type: "oua de gaina", cod: ["0", "1", "2", "3"], require: ["l|marimea l|marime l"], exclude: ["m/l|prepelita|ciocolata"] } },
  { slug: "oua-m-10", label: "Ouă mărimea M, 10 buc", unit: "buc", unitSize: 10, attributes: { size: "M", type: "oua de gaina", require: ["m|marimea m|marime m"], exclude: ["m l|prepelita|ciocolata"] } },
  { slug: "lapte-integral-1l", label: "Lapte integral 3,5%, 1 L", unit: "l", unitSize: 1, attributes: { grasime: "3.5", tip: "vaca", uht: null, require: ["integral|3 5"], exclude: ["cafea|praf|condensat|cocos|migdale|ovaz|soia|corp|demachiant|bebe"] } },
  { slug: "lapte-semi-1l", label: "Lapte semidegresat 1,5%, 1 L", unit: "l", unitSize: 1, attributes: { grasime: "1.5", tip: "vaca", require: ["semidegresat|1 5"], exclude: ["cafea|praf|condensat|cocos|migdale|ovaz|soia|corp|demachiant|bebe"] } },
  { slug: "unt-200g", label: "Unt 82%, 200 g", unit: "kg", unitSize: 0.2, attributes: { grasime: "82", tip: "unt de masa", require: ["unt"], exclude: ["biscuiti|arahide|cacao|shea|corp|fursec|aluat|crema"] } },
  { slug: "iaurt-natural-400g", label: "Iaurt natural, 400 g", unit: "kg", unitSize: 0.4, attributes: { tip: "natural", require: ["natural"], exclude: ["bautura|inghetata|chec|grecesc|fructe"] } },
  { slug: "iaurt-grecesc-400g", label: "Iaurt grecesc, 400 g", unit: "kg", unitSize: 0.4, attributes: { tip: "grecesc", require: ["grecesc"], exclude: ["bautura|inghetata|chec"] } },
  { slug: "smantana-200g", label: "Smântână 20%, 200 g", unit: "kg", unitSize: 0.2, attributes: { grasime: "20", require: ["smantana"], exclude: ["branza|crema|almette|gatit"] } },
  { slug: "branza-telemea-400g", label: "Brânză telemea, 400 g", unit: "kg", unitSize: 0.4, attributes: { tip: "telemea", require: ["telemea"], exclude: ["burduf|topita|cheddar|mozzarella"] } },
  { slug: "cascaval-400g", label: "Cașcaval, 400 g", unit: "kg", unitSize: 0.4, attributes: { tip: "cascaval", require: ["cascaval"], exclude: ["felii pizza|snack|pane|chipsuri"] } },

  // ── bakery & staples ──
  { slug: "paine-alba-500g", label: "Pâine albă, 500 g", unit: "kg", unitSize: 0.5, attributes: { tip: "alba", feliata: null, require: ["alba"], exclude: ["pesmet|crutoane|faina|mix|toast|graham|secara|integrala"] } },
  // TIP 000 IS NOT TIP 650. This class required ["alba|000"], and "Faina alba 650 Auchan, 1 kg"
  // satisfies it on the word "alba" alone — so a bread flour and a cake flour shared one class
  // and one price line. Different flour, different bake, different price. 650 now has its own
  // class in src/data/private-label-classes.ts and is named out of this one.
  { slug: "faina-alba-1kg", label: "Făină albă tip 000, 1 kg", unit: "kg", unitSize: 1, attributes: { tip: "000", require: ["alba|000"], exclude: ["650|mix|porumb|migdale|cocos|ovaz|orez|integrala"] } },
  { slug: "zahar-tos-1kg", label: "Zahăr tos alb, 1 kg", unit: "kg", unitSize: 1, attributes: { tip: "tos alb", require: ["alb|tos"], exclude: ["pudra|vanilat|brun|invertit|indulcitor"] } },
  { slug: "orez-bob-lung-1kg", label: "Orez bob lung, 1 kg", unit: "kg", unitSize: 1, attributes: { tip: "bob lung", require: ["bob lung|lung"], exclude: ["basmati|risotto|arborio|pilaf|sarmale|lapte|vafe"] } },
  { slug: "paste-500g", label: "Paste făinoase, 500 g", unit: "kg", unitSize: 0.5, attributes: { tip: "grau dur", require: ["paste"], exclude: ["dinti|tomate|sos|pizza|instant|noodles"] } },
  { slug: "malai-1kg", label: "Mălai, 1 kg", unit: "kg", unitSize: 1, attributes: {  require: ["malai"], exclude: ["mamaliga instant|briose"] } },
  { slug: "ulei-floarea-soarelui-1l", label: "Ulei floarea-soarelui, 1 L", unit: "l", unitSize: 1, attributes: { tip: "floarea soarelui", require: ["floarea"], exclude: ["masline|motor|corp|par|masaj|esential|susan|cocos|spray"] } },
  { slug: "sare-1kg", label: "Sare de bucătărie, 1 kg", unit: "kg", unitSize: 1, attributes: { iodata: null, require: ["sare"], exclude: ["baie|himalaya"] } },

  // ── meat ──
  // ── MEAT IS SOLD BY WEIGHT, and these three did not say so.
  //
  // All three held ZERO products. Their rules were fine; what they lacked was `anySize`. The
  // assigner requires the pack to be within ±26% of the class size, and fresh meat comes as
  // 0,63 kg / 0,65 kg / 2,5 kg / 4,5 kg — so a 1 kg class matched none of it. That is exactly
  // the defect the produce work found and fixed for fruit and vegetables; these were left
  // behind because nothing priced them until the basket became class-based.
  //
  // `maxUnitSize` caps it at 2.5 kg for the same reason it does for onions: a 4,5 kg METRO
  // Chef gastro tray is a catering pack, and its price per kilo is not the trade a shopper is
  // making. Better to leave that unassigned than to let it set the basket line.
    // CHICKEN, not turkey: "PENES Piept Curcan Dezosat cca 2 Kg" was pricing the chicken line.
  // `curcan` is a different bird at a different price and the name says so plainly.
  { slug: "piept-pui-1kg", label: "Piept de pui, la kg", unit: "kg", unitSize: 1, attributes: { specie: "pui", transa: "piept", refrigerat: null, require: ["piept", "pui"], exclude: ["curcan|pane|crispy|afumat|snitel|nuggets|pizza|crenvursti|salam|parizer|sunca|conserva|pate|pateu|mazare|pieptene|tocat"], anySize: true, maxUnitSize: 2.5, minUnitSize: 0.3 } },
  { slug: "pulpe-pui-1kg", label: "Pulpe de pui, la kg", unit: "kg", unitSize: 1, attributes: { specie: "pui", transa: "pulpe", require: ["pulpe"], exclude: ["pane|crispy|afumat|snitel|nuggets|conserva|pateu"], anySize: true, maxUnitSize: 2.5 } },
    // `pateu` was excluded and the catalog writes `pate` — so "Pate de porc Auchan 15% carne,
  // 100 g" priced the "carne de porc" basket line at 1,29 lei. A near-miss in an exclusion list
  // is not a near-miss in effect: it is the whole rule failing on the most common spelling.
  { slug: "carne-porc-1kg", label: "Carne de porc, la kg", unit: "kg", unitSize: 1, attributes: { specie: "porc", require: ["porc"], exclude: ["slanina|sunca|salam|carnati|pate|pateu|afumat|parizer|mici|pizza|conserva|crenvursti|ciolan|jambon|kaiser|bacon|sos|supa|hrana"], anySize: true, maxUnitSize: 2.5, minUnitSize: 0.25 } },

  // ── produce ──
  // Potatoes are sold loose and in 2,5 kg and 5 kg nets; a 1 kg class with no `anySize` matched
  // none of the 183 live products. Capped at 5 kg because the household net IS five kilos here,
  // unlike onions — but a 10 kg catering sack still stays out.
    // "aro Cartofi Crinkle 2,5 Kg" is frozen chips. `congelat` did not catch it because the name
  // never says so — the freezer is marked with a snowflake glyph instead.
  { slug: "cartofi-1kg", label: "Cartofi albi, la kg", unit: "kg", unitSize: 1, attributes: { tip: "albi", require: ["cartofi"], exclude: ["pai|chips|congelat|dulci|bio|piure|snack|prajit|preprajit|fulgi|amidon|paine|wedges|sos|condimente|stickletti|pombar|salata de|crinkle|steakhouse|rosii|rosu"], anySize: true, maxUnitSize: 5, minUnitSize: 1 } },
  { slug: "rosii-1kg", label: "Roșii, 1 kg", unit: "kg", unitSize: 1, attributes: {  require: ["rosii"], exclude: ["bulion|pasta|suc|conserva|uscate|sos|cherry uscate"] } },
  { slug: "mere-1kg", label: "Mere, 1 kg", unit: "kg", unitSize: 1, attributes: {  require: ["mere"], exclude: ["suc|compot|otet|uscate|chips|piure"] } },
  { slug: "ceapa-1kg", label: "Ceapă galbenă, 1 kg", unit: "kg", unitSize: 1, attributes: { tip: "galbena", require: ["ceapa"], exclude: ["praf|deshidratat|murat|verde|inele|congelat|legume"] } },

  // ── drinks ──
  // Decaf is not a substitute for coffee for the person buying it, so it leaves this class and
  // gets its own. It was silently inside: the rule is require ["macinata"], which every
  // "Cafea macinata decafeinizata …" satisfies.
  { slug: "cafea-macinata-250g", label: "Cafea măcinată, 250 g", unit: "kg", unitSize: 0.25, attributes: { forma: "macinata", require: ["macinata"], exclude: ["decofeinizat|decafeinizat|capsule|boabe|instant|filtru|lapte pentru|frisca"] } },
  { slug: "apa-plata-2l", label: "Apă plată, 2 L", unit: "l", unitSize: 2, attributes: { tip: "plata", require: ["plata"], exclude: ["gura|colonie|parfum|toaleta|termala|micelara|carbogazoasa|minerala carbogazificata"] } },
  { slug: "bere-blonda-500ml", label: "Bere blondă, 500 ml", unit: "l", unitSize: 0.5, attributes: { tip: "blonda", require: ["blonda"], exclude: ["fara alcool|bruna|radler"] } },

  // ── household ──
  { slug: "hartie-igienica-8", label: "Hârtie igienică, 8 role", unit: "buc", unitSize: 8, attributes: { straturi: ["2", "3"], require: ["igienica"], exclude: ["umeda|servetele|prosoape|bucatarie"] } },
  { slug: "detergent-rufe-3l", label: "Detergent lichid rufe, 3 L", unit: "l", unitSize: 3, attributes: { forma: "lichid", require: ["rufe"], exclude: ["vase|geam|pardoseli|wc|baie|universal|masina de spalat vase"] } },
  ...PRODUCE_CLASSES,
  ...PRIVATE_LABEL_CLASSES,
  ...STAPLE_CLASSES,
  ...BATCH1_CLASSES,
];

async function main() {
  // ── A CLASS THAT DECLARES STRICT RULES MUST DECLARE ITS WINDOW.
  //
  // `strictRules` replaces the assigner's ±26% size tolerance with the class's own min/max. A
  // strict class that forgot them would silently admit any size — the tolerance is gone and
  // nothing took its place. So it is refused here, loudly, before anything is written.
  const bad = CLASSES.filter((c) => {
    const a = c.attributes as Record<string, unknown>;
    return a.strictRules === true && (typeof a.minUnitSize !== "number" || typeof a.maxUnitSize !== "number");
  });
  if (bad.length > 0) {
    console.error(`REFUSING TO SEED. ${bad.length} class(es) set strictRules without an explicit size window:`);
    for (const c of bad) console.error(`  ${c.slug}`);
    process.exit(1);
  }

  // ── A SEEDER THAT ADDS MUST ALSO BE ABLE TO REMOVE. (CLAUDE.md)
  //
  // `mazare-kg` and `porumb-kg` were deleted from produce-classes because every live member was
  // a tin or a bag of popcorn. Deleting the DEFINITION does nothing on its own: the row stays in
  // the table, its 41 products stay assigned to it, and the substitution engine keeps offering
  // tinned peas as fresh ones. The class list in code is the source of truth, so anything not
  // in it is removed here — with its assignments cleared FIRST, because the FK forbids deleting
  // a class that still has members and, more to the point, a dangling assignment is the bug.
  const known = new Set(CLASSES.map((c) => c.slug));
  const orphans = (await prisma.equivalenceClass.findMany({ select: { id: true, slug: true } }))
    .filter((c) => !known.has(c.slug));
  if (orphans.length > 0) {
    const ids = orphans.map((o) => o.id);
    const cleared = await prisma.product.updateMany({
      where: { equivalenceClassId: { in: ids } },
      data: { equivalenceClassId: null },
    });
    await prisma.equivalenceClass.deleteMany({ where: { id: { in: ids } } });
    console.log(`Removed ${orphans.length} class(es) no longer defined in code, unassigning ${cleared.count} product(s):`);
    for (const o of orphans) console.log(`  ${o.slug}`);
  }

  let created = 0;
  let updated = 0;
  for (const c of CLASSES) {
    const data = {
      label: c.label,
      section: c.section ?? "grocery",
      unit: c.unit,
      unitSize: c.unitSize,
      attributes: JSON.stringify(c.attributes),
    };
    const existing = await prisma.equivalenceClass.findUnique({ where: { slug: c.slug } });
    await prisma.equivalenceClass.upsert({ where: { slug: c.slug }, update: data, create: { slug: c.slug, ...data } });
    existing ? updated++ : created++;
  }
  const total = await prisma.equivalenceClass.count();
  console.log(`EquivalenceClass: ${created} created, ${updated} updated, ${total} total.`);
  const assigned = await prisma.product.count({ where: { equivalenceClassId: { not: null } } });
  console.log(`Products assigned to a class: ${assigned} (auto-assignment is deliberately NOT done yet).`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
