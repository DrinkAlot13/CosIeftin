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

type Klass = { slug: string; label: string; section?: string; unit: string; unitSize: number; attributes: Record<string, unknown> };

const CLASSES: Klass[] = [
  // ── dairy & eggs ──
  { slug: "oua-l-10", label: "Ouă mărimea L, 10 buc", unit: "buc", unitSize: 10, attributes: { size: "L", type: "oua de gaina", cod: ["0", "1", "2", "3"] } },
  { slug: "oua-m-10", label: "Ouă mărimea M, 10 buc", unit: "buc", unitSize: 10, attributes: { size: "M", type: "oua de gaina" } },
  { slug: "lapte-integral-1l", label: "Lapte integral 3,5%, 1 L", unit: "l", unitSize: 1, attributes: { grasime: "3.5", tip: "vaca", uht: null } },
  { slug: "lapte-semi-1l", label: "Lapte semidegresat 1,5%, 1 L", unit: "l", unitSize: 1, attributes: { grasime: "1.5", tip: "vaca" } },
  { slug: "unt-200g", label: "Unt 82%, 200 g", unit: "kg", unitSize: 0.2, attributes: { grasime: "82", tip: "unt de masa" } },
  { slug: "iaurt-natural-400g", label: "Iaurt natural, 400 g", unit: "kg", unitSize: 0.4, attributes: { tip: "natural" } },
  { slug: "iaurt-grecesc-400g", label: "Iaurt grecesc, 400 g", unit: "kg", unitSize: 0.4, attributes: { tip: "grecesc" } },
  { slug: "smantana-200g", label: "Smântână 20%, 200 g", unit: "kg", unitSize: 0.2, attributes: { grasime: "20" } },
  { slug: "branza-telemea-400g", label: "Brânză telemea, 400 g", unit: "kg", unitSize: 0.4, attributes: { tip: "telemea" } },
  { slug: "cascaval-400g", label: "Cașcaval, 400 g", unit: "kg", unitSize: 0.4, attributes: { tip: "cascaval" } },

  // ── bakery & staples ──
  { slug: "paine-alba-500g", label: "Pâine albă, 500 g", unit: "kg", unitSize: 0.5, attributes: { tip: "alba", feliata: null } },
  { slug: "faina-alba-1kg", label: "Făină albă tip 000, 1 kg", unit: "kg", unitSize: 1, attributes: { tip: "000" } },
  { slug: "zahar-tos-1kg", label: "Zahăr tos alb, 1 kg", unit: "kg", unitSize: 1, attributes: { tip: "tos alb" } },
  { slug: "orez-bob-lung-1kg", label: "Orez bob lung, 1 kg", unit: "kg", unitSize: 1, attributes: { tip: "bob lung" } },
  { slug: "paste-500g", label: "Paste făinoase, 500 g", unit: "kg", unitSize: 0.5, attributes: { tip: "grau dur" } },
  { slug: "malai-1kg", label: "Mălai, 1 kg", unit: "kg", unitSize: 1, attributes: {} },
  { slug: "ulei-floarea-soarelui-1l", label: "Ulei floarea-soarelui, 1 L", unit: "l", unitSize: 1, attributes: { tip: "floarea soarelui" } },
  { slug: "sare-1kg", label: "Sare de bucătărie, 1 kg", unit: "kg", unitSize: 1, attributes: { iodata: null } },

  // ── meat ──
  { slug: "piept-pui-1kg", label: "Piept de pui, 1 kg", unit: "kg", unitSize: 1, attributes: { specie: "pui", transa: "piept", refrigerat: null } },
  { slug: "pulpe-pui-1kg", label: "Pulpe de pui, 1 kg", unit: "kg", unitSize: 1, attributes: { specie: "pui", transa: "pulpe" } },
  { slug: "carne-porc-1kg", label: "Carne de porc, 1 kg", unit: "kg", unitSize: 1, attributes: { specie: "porc" } },

  // ── produce ──
  { slug: "cartofi-1kg", label: "Cartofi albi, 1 kg", unit: "kg", unitSize: 1, attributes: { tip: "albi" } },
  { slug: "rosii-1kg", label: "Roșii, 1 kg", unit: "kg", unitSize: 1, attributes: {} },
  { slug: "mere-1kg", label: "Mere, 1 kg", unit: "kg", unitSize: 1, attributes: {} },
  { slug: "ceapa-1kg", label: "Ceapă galbenă, 1 kg", unit: "kg", unitSize: 1, attributes: { tip: "galbena" } },

  // ── drinks ──
  { slug: "cafea-macinata-250g", label: "Cafea măcinată, 250 g", unit: "kg", unitSize: 0.25, attributes: { forma: "macinata" } },
  { slug: "apa-plata-2l", label: "Apă plată, 2 L", unit: "l", unitSize: 2, attributes: { tip: "plata" } },
  { slug: "bere-blonda-500ml", label: "Bere blondă, 500 ml", unit: "l", unitSize: 0.5, attributes: { tip: "blonda" } },

  // ── household ──
  { slug: "hartie-igienica-8", label: "Hârtie igienică, 8 role", unit: "buc", unitSize: 8, attributes: { straturi: ["2", "3"] } },
  { slug: "detergent-rufe-3l", label: "Detergent lichid rufe, 3 L", unit: "l", unitSize: 3, attributes: { forma: "lichid" } },
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
