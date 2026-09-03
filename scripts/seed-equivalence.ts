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

type Klass = { slug: string; label: string; section?: string; unit: string; unitSize: number; attributes: Record<string, unknown> & { require?: string[]; exclude?: string[] } };

// The fresh-produce classes live in their own file — 60-odd of them, written against the names
// actually in the catalog rather than from memory, and carrying `anySize` because loose produce
// is sold by weight. See src/data/produce-classes.ts for what is deliberately kept apart.
const CLASSES: Klass[] = [
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
  { slug: "faina-alba-1kg", label: "Făină albă tip 000, 1 kg", unit: "kg", unitSize: 1, attributes: { tip: "000", require: ["alba|000"], exclude: ["mix|porumb|migdale|cocos|ovaz|orez|integrala"] } },
  { slug: "zahar-tos-1kg", label: "Zahăr tos alb, 1 kg", unit: "kg", unitSize: 1, attributes: { tip: "tos alb", require: ["alb|tos"], exclude: ["pudra|vanilat|brun|invertit|indulcitor"] } },
  { slug: "orez-bob-lung-1kg", label: "Orez bob lung, 1 kg", unit: "kg", unitSize: 1, attributes: { tip: "bob lung", require: ["bob lung|lung"], exclude: ["basmati|risotto|arborio|pilaf|sarmale|lapte|vafe"] } },
  { slug: "paste-500g", label: "Paste făinoase, 500 g", unit: "kg", unitSize: 0.5, attributes: { tip: "grau dur", require: ["paste"], exclude: ["dinti|tomate|sos|pizza|instant|noodles"] } },
  { slug: "malai-1kg", label: "Mălai, 1 kg", unit: "kg", unitSize: 1, attributes: {  require: ["malai"], exclude: ["mamaliga instant|briose"] } },
  { slug: "ulei-floarea-soarelui-1l", label: "Ulei floarea-soarelui, 1 L", unit: "l", unitSize: 1, attributes: { tip: "floarea soarelui", require: ["floarea"], exclude: ["masline|motor|corp|par|masaj|esential|susan|cocos|spray"] } },
  { slug: "sare-1kg", label: "Sare de bucătărie, 1 kg", unit: "kg", unitSize: 1, attributes: { iodata: null, require: ["sare"], exclude: ["baie|himalaya"] } },

  // ── meat ──
  { slug: "piept-pui-1kg", label: "Piept de pui, 1 kg", unit: "kg", unitSize: 1, attributes: { specie: "pui", transa: "piept", refrigerat: null, require: ["piept"], exclude: ["pane|crispy|afumat|snitel|nuggets|pizza|crenvursti|salam|parizer"] } },
  { slug: "pulpe-pui-1kg", label: "Pulpe de pui, 1 kg", unit: "kg", unitSize: 1, attributes: { specie: "pui", transa: "pulpe", require: ["pulpe"], exclude: ["pane|crispy|afumat|snitel|nuggets"] } },
  { slug: "carne-porc-1kg", label: "Carne de porc, 1 kg", unit: "kg", unitSize: 1, attributes: { specie: "porc", require: ["porc"], exclude: ["slanina|sunca|salam|carnati|pateu|afumat|parizer|mici|pizza|conserva"] } },

  // ── produce ──
  { slug: "cartofi-1kg", label: "Cartofi albi, 1 kg", unit: "kg", unitSize: 1, attributes: { tip: "albi", require: ["cartofi"], exclude: ["pai|chips|congelat|dulci|bio|piure|snack|prajit|preprajit|fulgi|amidon|paine|wedges"] } },
  { slug: "rosii-1kg", label: "Roșii, 1 kg", unit: "kg", unitSize: 1, attributes: {  require: ["rosii"], exclude: ["bulion|pasta|suc|conserva|uscate|sos|cherry uscate"] } },
  { slug: "mere-1kg", label: "Mere, 1 kg", unit: "kg", unitSize: 1, attributes: {  require: ["mere"], exclude: ["suc|compot|otet|uscate|chips|piure"] } },
  { slug: "ceapa-1kg", label: "Ceapă galbenă, 1 kg", unit: "kg", unitSize: 1, attributes: { tip: "galbena", require: ["ceapa"], exclude: ["praf|deshidratat|murat|verde|inele|congelat|legume"] } },

  // ── drinks ──
  { slug: "cafea-macinata-250g", label: "Cafea măcinată, 250 g", unit: "kg", unitSize: 0.25, attributes: { forma: "macinata", require: ["macinata"], exclude: ["capsule|boabe|instant|filtru|lapte pentru|frisca"] } },
  { slug: "apa-plata-2l", label: "Apă plată, 2 L", unit: "l", unitSize: 2, attributes: { tip: "plata", require: ["plata"], exclude: ["gura|colonie|parfum|toaleta|termala|micelara|carbogazoasa|minerala carbogazificata"] } },
  { slug: "bere-blonda-500ml", label: "Bere blondă, 500 ml", unit: "l", unitSize: 0.5, attributes: { tip: "blonda", require: ["blonda"], exclude: ["fara alcool|bruna|radler"] } },

  // ── household ──
  { slug: "hartie-igienica-8", label: "Hârtie igienică, 8 role", unit: "buc", unitSize: 8, attributes: { straturi: ["2", "3"], require: ["igienica"], exclude: ["umeda|servetele|prosoape|bucatarie"] } },
  { slug: "detergent-rufe-3l", label: "Detergent lichid rufe, 3 L", unit: "l", unitSize: 3, attributes: { forma: "lichid", require: ["rufe"], exclude: ["vase|geam|pardoseli|wc|baie|universal|masina de spalat vase"] } },
  ...PRODUCE_CLASSES,
];

async function main() {
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
