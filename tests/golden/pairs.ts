// GOLDEN SET — 200 hand-labelled product pairs drawn from REAL rows in the catalog.
//
// Purpose: a matcher change is only safe if this file's pass rate goes UP. It is weighted
// toward what the fan-out audit proved is actually broken, not toward easy cases.
//
// Labelling rule: SHOULD_MATCH means "a shopper would accept this as the same product at a
// different store". SHOULD_NOT_MATCH means "quoting one's price for the other is a lie".
//
// Categories map to the failure modes we have evidence for:
//   branded-grocery-variant  the Nivea/Chio hole — brand+head-noun+size is not enough
//   pack-size                500 g vs 1 kg must never merge
//   multipack                6x1.5L is not 1.5L
//   private-label            Auchan-brand milk is not Napolact milk
//   cosmetics-variant        differs only by shade/scent/volume
//   alcohol-same-brand       one brand spanning many distinct wines (the Zarea shape)
//   alcohol-variant          Dom Pérignon Brut vs Rose vs Magnum
//   produce-prefix           "ECO <vegetable>" — shared prefix, different vegetable
//   cross-store              genuinely the same item at two merchants (SHOULD_MATCH)

export type Side = { name: string; brand?: string | null; unit: string; unitSize: number; ean?: string | null };
export type Label = "SHOULD_MATCH" | "SHOULD_NOT_MATCH";
export type Category =
  | "branded-grocery-variant" | "pack-size" | "multipack" | "private-label"
  | "cosmetics-variant" | "alcohol-same-brand" | "alcohol-variant" | "produce-prefix"
  | "cross-store" | "dcneu-variant" | "farmacie-variant";

export type Pair = {
  section: string;
  category: Category;
  label: Label;
  a: Side;
  b: Side;
  note?: string;
};

const L = (n: string, brand: string | null, unit: string, unitSize: number, ean?: string): Side =>
  ({ name: n, brand, unit, unitSize, ean });

// ── real Nivea shower gels (the group that fanned out 17x at Mega, Metro AND Penny) ──
const nivea = {
  deepCleanRM: L("Gel de dus Nivea Men Deep Clean 3 in 1 Real Madrid, 500 ml", "Nivea", "l", 0.5),
  deepClean: L("Gel de dus Nivea Men Deep Clean 500 ml", "Nivea", "l", 0.5),
  pureImpact: L("Gel de dus Nivea Men Pure Impact, 500ml", "Nivea", "l", 0.5),
  totalRelax: L("Gel de dus Nivea Men Total Relax, 500 ml", "Nivea", "l", 0.5),
  energy: L("Gel de dus Nivea Men Energy, 500ml", "Nivea", "l", 0.5),
  sensitive: L("Gel de dus Nivea Men Sensitive, 500 ml", "Nivea", "l", 0.5),
  activeClean: L("Gel de dus Nivea Men Active Clean, 500ml", "Nivea", "l", 0.5),
  copii2in1: L("Gel de dus si sampon Nivea 2in1, pentru copii, parfum de mar, 0.5 l", "Nivea", "l", 0.5),
  lemongrass: L("Gel de dus Nivea lemongrass & oil, 500ml", "Nivea", "l", 0.5),
  hawaii: L("Gel de dus Nivea Hawaii Flower & Oil, 500 ml", "Nivea", "l", 0.5),
  cremeSoft750: L("Gel de dus Nivea Creme Soft, 750ml", "Nivea", "l", 0.75),
  cremeAloe750: L("Gel de dus Nivea Creme Aloe, 750ml", "Nivea", "l", 0.75),
  coconut750: L("Gel de dus Nivea Care&Coconut, 750ml", "Nivea", "l", 0.75),
};

// ── real Chio chips (fanned out 15x at Freshful) ──
const chio = {
  sare170: L("Chipsuri cu sare Chio, 170 g", "Chio", "kg", 0.17),
  sare125: L("Chipsuri cu sare Chio, 125 g", "Chio", "kg", 0.125),
  paprica170: L("Chipsuri cu paprica Chio, 170 g", "Chio", "kg", 0.17),
  paprica125: L("Chipsuri cu paprica Chio, 125 g", "Chio", "kg", 0.125),
  smantana170: L("Chipsuri cu smantana si ceapa Chio, 170 g", "Chio", "kg", 0.17),
  smantana125: L("Chipsuri cu smantana si ceapa Chio, 125 g", "Chio", "kg", 0.125),
  cascaval170: L("Chipsuri cu cascaval Chio, 170 g", "Chio", "kg", 0.17),
  cascaval125: L("Chipsuri cu cascaval Chio, 125 g", "Chio", "kg", 0.125),
  bbq125: L("Chipsuri cu barbeque Chio, 125 g", "Chio", "kg", 0.125),
  pui125: L("Chipsuri cu pui la rotisor Chio, 125 g", "Chio", "kg", 0.125),
  sareMare120: L("Chipsuri cu sare de mare Chio Intense, 120 g", "Chio", "kg", 0.12),
  patrunjel120: L("Chipsuri cu smantana si patrunjel Chio Intense, 120 g", "Chio", "kg", 0.12),
};

// ── real Freshful ECO produce (fanned out 20x) ──
const eco = {
  turmeric: L("ECO Turmeric 70 g", "", "kg", 0.07),
  rucola: L("ECO Rucola 100 g", "", "kg", 0.1),
  spanac: L("ECO Baby Spanac 100 g", "", "kg", 0.1),
  germeni: L("ECO Germeni de grau 100 g", "", "kg", 0.1),
  batavia: L("ECO Baby Batavia rosie si verde 100 g", "", "kg", 0.1),
  valeriana: L("ECO Valeriana 100 g", "", "kg", 0.1),
  mereRosii: L("ECO Mere rosii (pachet de 2 sau 4 mere) 400 g", "", "kg", 0.4),
  mereGala: L("ECO Mere rosii Gala 400 g", "", "kg", 0.4),
  ceapa: L("ECO Ceapa galbena 0,75 kg", "", "kg", 0.75),
  morcovi: L("ECO Morcovi din Italia 450 g", "", "kg", 0.45),
  avocado: L("ECO Avocado 1 buc", "", "buc", 1),
  avocado90: L("ECO Avocado  90 Gr+ 1 buc", "", "buc", 1),
};

// ── real alcohol: the Zarea group (brands are POLLUTED in the DB — see notes) ──
const zarea = {
  sangeDeTaur: L("Vin rose Zarea, Sange De Taur, Dulce, 0.75L", "Basilescu", "l", 0.75),
  zeroSauv: L("Zarea Zero alcool Sauvignon Blanc Alb 0.75L", "Cramele Recas", "l", 0.75),
  zeroCab: L("Zarea Zero alcool Cabernet Sauvignon Rosu 0.75L", "San Marzano", "l", 0.75),
  zeroRose: L("Zarea Zero alcool Rose 0.75L", "Sigillum Moldaviae", "l", 0.75),
  bestWishes: L("Zarea Best Wishes Alb Demisec 11% alc. Vin Spumant 0.75L", "Paw Patrol", "l", 0.75),
  gurmetRose: L("Vin Spumant Rose Zarea Gurmet Feteasca Neagra, Dulce, 8%, 0.75L", "Paw Patrol", "l", 0.75),
  gurmentAlb: L("Vin Spumant Alb Zarea Gurment Muscat Ottonel, Dulce, 7.5%, 0.75L", "Paw Patrol", "l", 0.75),
  fetRegala: L("Vin Spumant Zarea Feteasca Regala, Alb ExtraSec, 0.75l", "Vintense", "l", 0.75),
  iceRose: L("Zarea Ice Rose Vin Spumant, Demisec 0.75L", "Piper-Heidsieck", "l", 0.75),
  iceAlb: L("Zarea Ice Alb Vin Spumant, Demisec 0.75L", "Piper-Heidsieck", "l", 0.75),
  bellaVita: L("Vin spumant Zarea, Dulce Bella Vita Asti, Alb, 0.75L", "Martini", "l", 0.75),
};
// the unrelated wines that a single Zarea offer was backing
const otherWines = {
  kendall: L("Vin Kendall-Jackson, Vintners Reserve, Sonoma County, Rosu, Cabernet Sauvignon, 0.75 l", "", "l", 0.75),
  lacerta: L("Vin Rosu Lacerta Feteasca Neagra, Sec, 0.75l", "", "l", 0.75),
  lacertaCuvee: L("Vin Rosu Lacerta Cuvee IX, Sec, 0.75l", "", "l", 0.75),
  cantus: L("Vin Rosu Cantus Primus Feteasca Neagra, Sec, 0.75l", "", "l", 0.75),
  cantusCab: L("Vin Rosu Cantus Primus Cabernet Sauvignon, Sec, 0.75l", "", "l", 0.75),
  metamorfosis: L("Vin Feteasca Neagra Metamorfosis, 0.75L", "", "l", 0.75),
  bogdanSyrah: L("Vin Rosu Domeniul Bogdan Biodinamic, Patrar Syrah, Sec, 0.75l", "", "l", 0.75),
  bogdanMerlot: L("Vin rosu sec Domeniul Bogdan Patrar Merlot 0.75L", "", "l", 0.75),
  explicitMerlot: L("Vin Explicit Merlot Doc Sec 14%, 0.75L", "", "l", 0.75),
  explicitCab: L("Vin Explicit Cabernet Sauvignon Doc Sec 14%, 0.75L", "", "l", 0.75),
  pamanturi: L("Vin Pamanturi Negre Demisec 0.75L", "", "l", 0.75),
  viaColtul: L("Vin Rosu Via Coltul Pietrei Syrah, Sec, 0.75l", "", "l", 0.75),
};

const dp = {
  brut: L("Dom Perignon Brut 0.75L", "", "l", 0.75),
  brutCadou: L("Dom Perignon Brut Cutie Cadou 0.75L", "", "l", 0.75),
  brutNeon: L("Dom Perignon Brut Neon 0.75L", "", "l", 0.75),
  magnum: L("Dom Perignon Brut Magnum 1.5L", "", "l", 1.5),
  neonMagnum: L("Dom Perignon Brut Neon Magnum 1.5L", "", "l", 1.5),
  rose: L("Dom Perignon Rose 0.75L", "", "l", 0.75),
  roseCadou: L("Dom Perignon Rose Cutie Cadou 0.75L", "", "l", 0.75),
  // the cheap Carrefour bottle that was backing all of the above at 32,49 lei
  domBogdan: L("Vin spumant Dom Bogdan alb sec 0.75L", "", "l", 0.75),
};

const lapte = {
  napolact1: L("Lapte de consum integral Napolact, 3.5% grasime, 1 l", "Napolact", "l", 1),
  napolact15: L("Lapte de consum integral Napolact, 3.5% grasime, 1.5 l", "Napolact", "l", 1.5),
  auchanInt: L("Lapte UHT integral Auchan, 3.5% grasime, 1 l", "Auchan", "l", 1),
  auchanSemi: L("Lapte UHT semidegresat Auchan, 1.5% grasime, 1 l", "Auchan", "l", 1),
  auchanCons: L("Lapte de consum integral Auchan, 3.5% grasime, 1 l", "Auchan", "l", 1),
  pouce: L("Lapte semidegresat Pouce, 1.5% grasime, 1 l", "Pouce", "l", 1),
  caimac: L("Lapte de vaca integral Laptaria cu caimac, 3.8 - 4.1% grasime, 1 l", "Laptaria cu caimac", "l", 1),
  zuzu15: L("Lapte Zuzu 1.5% grasime 1L", "Zuzu", "l", 1),
  zuzu15b: L("Lapte Zuzu 1,5% 1 l", "Zuzu", "l", 1),
};

export const PAIRS: Pair[] = [];
const add = (section: string, category: Category, label: Label, a: Side, b: Side, note?: string) =>
  PAIRS.push({ section, category, label, a, b, note });

// ─────────────────────────────────────────────────────────────────────────────
// 1. BRANDED GROCERY VARIANTS — the hole the fan-out audit found (40 pairs)
//    Same brand, same head-noun, same size; different product. Must NOT match.
// ─────────────────────────────────────────────────────────────────────────────
const niveaDistinct: [string, Side][] = [
  ["deepCleanRM", nivea.deepCleanRM], ["pureImpact", nivea.pureImpact], ["totalRelax", nivea.totalRelax],
  ["energy", nivea.energy], ["sensitive", nivea.sensitive], ["activeClean", nivea.activeClean],
  ["copii2in1", nivea.copii2in1], ["lemongrass", nivea.lemongrass], ["hawaii", nivea.hawaii],
];
for (let i = 0; i < niveaDistinct.length; i++) {
  for (let j = i + 1; j < niveaDistinct.length && j <= i + 3; j++) {
    add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH", niveaDistinct[i][1], niveaDistinct[j][1],
      "same brand+size+head-noun, different variant");
  }
}
// the one legitimate Nivea match: the same product written two ways
add("grocery", "cross-store", "SHOULD_MATCH", nivea.deepClean,
  L("NIVEA MEN Gel de dus Deep Clean 500 ml", "Nivea", "l", 0.5), "same product, different word order");
add("grocery", "cross-store", "SHOULD_MATCH", nivea.pureImpact,
  L("Nivea Men Pure Impact gel de dus 500 ml", "Nivea", "l", 0.5));
// 750ml Nivea creme line — distinct scents
add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH", nivea.cremeSoft750, nivea.cremeAloe750);
add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH", nivea.cremeSoft750, nivea.coconut750);
add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH", nivea.cremeAloe750, nivea.coconut750);
// Men vs non-Men at the same size is a different product line
add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH", nivea.deepClean, nivea.lemongrass);
add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH", nivea.energy, nivea.hawaii);
add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH", nivea.copii2in1, nivea.sensitive,
  "children's 2in1 vs men's sensitive — nothing alike but the brand and size");

// Chio flavours at identical size
const chio125: Side[] = [chio.sare125, chio.paprica125, chio.smantana125, chio.cascaval125, chio.bbq125, chio.pui125];
for (let i = 0; i < chio125.length; i++) {
  for (let j = i + 1; j < chio125.length && j <= i + 3; j++) {
    add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH", chio125[i], chio125[j], "same brand+size, different flavour");
  }
}
const chio170: Side[] = [chio.sare170, chio.paprica170, chio.smantana170, chio.cascaval170];
for (let i = 0; i < chio170.length; i++) {
  for (let j = i + 1; j < chio170.length; j++) {
    add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH", chio170[i], chio170[j]);
  }
}
add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH", chio.sareMare120, chio.patrunjel120);

// ─────────────────────────────────────────────────────────────────────────────
// 2. PACK SIZE — same product, different size. Must NOT match. (20 pairs)
// ─────────────────────────────────────────────────────────────────────────────
add("grocery", "pack-size", "SHOULD_NOT_MATCH", chio.sare170, chio.sare125);
add("grocery", "pack-size", "SHOULD_NOT_MATCH", chio.paprica170, chio.paprica125);
add("grocery", "pack-size", "SHOULD_NOT_MATCH", chio.smantana170, chio.smantana125);
add("grocery", "pack-size", "SHOULD_NOT_MATCH", chio.cascaval170, chio.cascaval125);
add("grocery", "pack-size", "SHOULD_NOT_MATCH", nivea.deepClean, L("Gel de dus Nivea Men Deep Clean 250 ml", "Nivea", "l", 0.25));
add("grocery", "pack-size", "SHOULD_NOT_MATCH", nivea.cremeSoft750, L("Gel de dus Nivea Creme Soft, 500ml", "Nivea", "l", 0.5));
add("grocery", "pack-size", "SHOULD_NOT_MATCH", lapte.napolact1, lapte.napolact15);
add("grocery", "pack-size", "SHOULD_NOT_MATCH", L("Faina alba Baneasa 1kg", "Baneasa", "kg", 1), L("Faina alba Baneasa 500g", "Baneasa", "kg", 0.5));
add("grocery", "pack-size", "SHOULD_NOT_MATCH", L("Ulei floarea soarelui Untdelemn de la Bunica 1L", "Untdelemn de la Bunica", "l", 1), L("Ulei floarea soarelui Untdelemn de la Bunica 5L", "Untdelemn de la Bunica", "l", 5));
add("grocery", "pack-size", "SHOULD_NOT_MATCH", L("Zahar tos Coronita 1kg", "Coronita", "kg", 1), L("Zahar tos Coronita 500g", "Coronita", "kg", 0.5));
add("grocery", "pack-size", "SHOULD_NOT_MATCH", L("Orez cu bob lung Auchan 1kg", "Auchan", "kg", 1), L("Orez cu bob lung Auchan 500g", "Auchan", "kg", 0.5));
add("grocery", "pack-size", "SHOULD_NOT_MATCH", L("Iaurt grecesc Olympus 400g", "Olympus", "kg", 0.4), L("Iaurt grecesc Olympus 150g", "Olympus", "kg", 0.15));
add("alcohol", "pack-size", "SHOULD_NOT_MATCH", dp.brut, dp.magnum, "0.75L vs 1.5L magnum");
add("alcohol", "pack-size", "SHOULD_NOT_MATCH", dp.brutNeon, dp.neonMagnum);
add("grocery", "pack-size", "SHOULD_NOT_MATCH", eco.mereRosii, L("ECO Mere rosii 1 kg", "", "kg", 1));
// …and sizes within tolerance ARE the same product
add("grocery", "pack-size", "SHOULD_MATCH", lapte.zuzu15, lapte.zuzu15b, "same product, formatting differs");
add("grocery", "pack-size", "SHOULD_MATCH", L("Lapte Zuzu 1L", "Zuzu", "l", 1), L("Lapte Zuzu 0.99L", "Zuzu", "l", 0.99), "within 6% tolerance");
add("grocery", "pack-size", "SHOULD_MATCH", L("Unt Covalact 200g", "Covalact", "kg", 0.2), L("Unt Covalact 200 g", "Covalact", "kg", 0.2));
add("grocery", "pack-size", "SHOULD_MATCH", L("Faina alba Baneasa 1kg", "Baneasa", "kg", 1), L("Faina alba Baneasa 1 kg", "Baneasa", "kg", 1));
add("grocery", "pack-size", "SHOULD_NOT_MATCH", L("Cafea macinata Jacobs Kronung 250g", "Jacobs", "kg", 0.25), L("Cafea macinata Jacobs Kronung 500g", "Jacobs", "kg", 0.5));

// ─────────────────────────────────────────────────────────────────────────────
// 3. MULTIPACK vs SINGLE (12 pairs)
// ─────────────────────────────────────────────────────────────────────────────
add("grocery", "multipack", "SHOULD_NOT_MATCH", L("Apa minerala Borsec 1.5L", "Borsec", "l", 1.5), L("Apa minerala Borsec 6x1.5L", "Borsec", "l", 9));
add("grocery", "multipack", "SHOULD_NOT_MATCH", L("Bere Ursus 0.5L", "Ursus", "l", 0.5), L("Bere Ursus 6x0.5L", "Ursus", "l", 3));
add("grocery", "multipack", "SHOULD_NOT_MATCH", L("Iaurt de baut Danonino 100 g", "Danonino", "kg", 0.1), L("Iaurt de baut Danonino, capsuni-banane si piersici-caise, 6 x 100 g", "Danonino", "kg", 0.6));
add("grocery", "multipack", "SHOULD_NOT_MATCH", L("Kefir Muller 500 g", "Muller", "kg", 0.5), L("Kefir Muller, 2 x 500 g", "Muller", "kg", 1));
add("grocery", "multipack", "SHOULD_NOT_MATCH", L("Apa plata Dorna 0.5L", "Dorna", "l", 0.5), L("Apa plata Dorna 12x0.5L", "Dorna", "l", 6));
add("grocery", "multipack", "SHOULD_NOT_MATCH", L("Hartie igienica Zewa 4 role", "Zewa", "buc", 4), L("Hartie igienica Zewa 16 role", "Zewa", "buc", 16));
add("grocery", "multipack", "SHOULD_MATCH", L("Apa minerala Borsec 6x1.5L", "Borsec", "l", 9), L("Apa minerala Borsec bax 6 x 1,5 l", "Borsec", "l", 9), "same multipack written differently");
add("grocery", "multipack", "SHOULD_MATCH", L("Bere Ursus 6x0.5L", "Ursus", "l", 3), L("Bere Ursus bax 6 x 0,5 l", "Ursus", "l", 3));
add("grocery", "multipack", "SHOULD_NOT_MATCH", L("Oua de gaina marimea M, 10 bucati", "", "buc", 10), L("Oua de gaina marimea M, 6 bucati", "", "buc", 6));
add("grocery", "multipack", "SHOULD_NOT_MATCH", L("Oua de gaina ECO Filiera Auchan, marime M, cod 0, 10 bucati", "Auchan", "buc", 10), L("Oua de gaina ECO Filiera Auchan, marime M, cod 0, 6 bucati", "Auchan", "buc", 6));
add("grocery", "multipack", "SHOULD_MATCH", L("Oua de gaina marimea L, 10 bucati", "", "buc", 10), L("Oua gaina marime L 10 buc", "", "buc", 10));
add("grocery", "multipack", "SHOULD_NOT_MATCH", L("Oua de gaina marimea L, 10 bucati", "", "buc", 10), L("Oua de gaina marimea M, 10 bucati", "", "buc", 10), "size L vs M — same count, different product");

// ─────────────────────────────────────────────────────────────────────────────
// 4. PRIVATE LABEL vs NATIONAL BRAND (14 pairs)
// ─────────────────────────────────────────────────────────────────────────────
add("grocery", "private-label", "SHOULD_NOT_MATCH", lapte.auchanInt, lapte.napolact1);
add("grocery", "private-label", "SHOULD_NOT_MATCH", lapte.auchanSemi, lapte.pouce);
add("grocery", "private-label", "SHOULD_NOT_MATCH", lapte.auchanCons, lapte.caimac);
add("grocery", "private-label", "SHOULD_NOT_MATCH", lapte.napolact1, lapte.caimac);
add("grocery", "private-label", "SHOULD_NOT_MATCH", lapte.pouce, lapte.napolact1);
add("grocery", "private-label", "SHOULD_NOT_MATCH", L("Faina alba K-Classic 1kg", "K-Classic", "kg", 1), L("Faina alba Baneasa 1kg", "Baneasa", "kg", 1));
add("grocery", "private-label", "SHOULD_NOT_MATCH", L("Ulei floarea soarelui Auchan 1L", "Auchan", "l", 1), L("Ulei floarea soarelui Bunica 1L", "Untdelemn de la Bunica", "l", 1));
add("grocery", "private-label", "SHOULD_NOT_MATCH", L("Zahar tos Auchan 1kg", "Auchan", "kg", 1), L("Zahar tos Coronita 1kg", "Coronita", "kg", 1));
add("grocery", "private-label", "SHOULD_NOT_MATCH", L("Cafea macinata Carrefour 250g", "Carrefour", "kg", 0.25), L("Cafea macinata Jacobs Kronung 250g", "Jacobs", "kg", 0.25));
add("grocery", "private-label", "SHOULD_NOT_MATCH", L("Unt K-Classic 200g", "K-Classic", "kg", 0.2), L("Unt Covalact 200g", "Covalact", "kg", 0.2));
add("grocery", "private-label", "SHOULD_NOT_MATCH", L("Iaurt cu specific grecesc 10% grasime, 400g Auchan", "Auchan", "kg", 0.4), L("Iaurt grecesc Olympus 400g", "Olympus", "kg", 0.4));
add("grocery", "private-label", "SHOULD_MATCH", L("Lapte UHT integral Auchan, 3.5% grasime, 1 l", "Auchan", "l", 1), L("Lapte UHT integral Auchan 3,5% 1l", "Auchan", "l", 1));
add("grocery", "private-label", "SHOULD_MATCH", L("Faina alba K-Classic 1kg", "K-Classic", "kg", 1), L("K-Classic faina alba tip 000, 1 kg", "K-Classic", "kg", 1));
add("grocery", "private-label", "SHOULD_NOT_MATCH", lapte.auchanInt, lapte.auchanSemi, "same private label, integral vs semidegresat");

// ─────────────────────────────────────────────────────────────────────────────
// 5. PRODUCE PREFIX — "ECO <thing>" shares a prefix, not a product (16 pairs)
// ─────────────────────────────────────────────────────────────────────────────
const ecoSame: Side[] = [eco.rucola, eco.spanac, eco.germeni, eco.batavia, eco.valeriana];
for (let i = 0; i < ecoSame.length; i++) {
  for (let j = i + 1; j < ecoSame.length; j++) {
    add("grocery", "produce-prefix", "SHOULD_NOT_MATCH", ecoSame[i], ecoSame[j], "identical size, different vegetable");
  }
}
add("grocery", "produce-prefix", "SHOULD_NOT_MATCH", eco.mereRosii, eco.mereGala, "both 400 g apples but different varieties");
add("grocery", "produce-prefix", "SHOULD_NOT_MATCH", eco.avocado, eco.avocado90);
add("grocery", "produce-prefix", "SHOULD_NOT_MATCH", eco.ceapa, L("ECO Cartofi albi 0,75 kg", "", "kg", 0.75));
add("grocery", "produce-prefix", "SHOULD_NOT_MATCH", eco.morcovi, L("ECO Ceapa rosie 450 g", "", "kg", 0.45));
add("grocery", "produce-prefix", "SHOULD_MATCH", eco.rucola, L("ECO Rucola proaspata 100 g", "", "kg", 0.1));
add("grocery", "produce-prefix", "SHOULD_MATCH", eco.morcovi, L("ECO Morcovi Italia 450 g", "", "kg", 0.45));
add("grocery", "produce-prefix", "SHOULD_NOT_MATCH", eco.turmeric, L("ECO Ghimbir 70 g", "", "kg", 0.07));

// ─────────────────────────────────────────────────────────────────────────────
// 6. ALCOHOL, SAME BRAND / DIFFERENT WINE — the Zarea shape (30 pairs)
// ─────────────────────────────────────────────────────────────────────────────
const zareaList: Side[] = [
  zarea.sangeDeTaur, zarea.zeroSauv, zarea.zeroCab, zarea.zeroRose, zarea.bestWishes,
  zarea.gurmetRose, zarea.gurmentAlb, zarea.fetRegala, zarea.iceRose, zarea.iceAlb, zarea.bellaVita,
];
for (let i = 0; i < zareaList.length; i++) {
  for (let j = i + 1; j < zareaList.length && j <= i + 2; j++) {
    add("alcohol", "alcohol-same-brand", "SHOULD_NOT_MATCH", zareaList[i], zareaList[j], "distinct Zarea wines, same size");
  }
}
// THE regression: the 15-lei Sânge de Taur must not back unrelated wines
for (const w of [otherWines.kendall, otherWines.lacerta, otherWines.cantus, otherWines.metamorfosis,
  otherWines.bogdanSyrah, otherWines.explicitMerlot, otherWines.pamanturi, otherWines.viaColtul,
  otherWines.lacertaCuvee, otherWines.bogdanMerlot, otherWines.explicitCab, otherWines.cantusCab]) {
  add("alcohol", "alcohol-same-brand", "SHOULD_NOT_MATCH", zarea.sangeDeTaur, w, "THE 64-way over-match regression");
}
add("alcohol", "alcohol-same-brand", "SHOULD_NOT_MATCH", otherWines.lacerta, otherWines.lacertaCuvee, "same producer, different cuvée");
add("alcohol", "alcohol-same-brand", "SHOULD_NOT_MATCH", otherWines.cantus, otherWines.cantusCab);
add("alcohol", "alcohol-same-brand", "SHOULD_NOT_MATCH", otherWines.explicitMerlot, otherWines.explicitCab);
add("alcohol", "alcohol-same-brand", "SHOULD_NOT_MATCH", otherWines.bogdanSyrah, otherWines.bogdanMerlot);
add("alcohol", "cross-store", "SHOULD_MATCH", otherWines.lacerta, L("Vin rosu Lacerta Feteasca Neagra sec 0.75 l", "", "l", 0.75));
add("alcohol", "cross-store", "SHOULD_MATCH", otherWines.metamorfosis, L("Vin Feteasca Neagra Metamorfosis 0,75 l", "", "l", 0.75));
add("alcohol", "cross-store", "SHOULD_MATCH", zarea.sangeDeTaur, L("Vin rose Zarea Sange de Taur dulce 0,75 l", "", "l", 0.75));

// ─────────────────────────────────────────────────────────────────────────────
// 7. ALCOHOL VARIANTS — Dom Pérignon (14 pairs)
// ─────────────────────────────────────────────────────────────────────────────
add("alcohol", "alcohol-variant", "SHOULD_NOT_MATCH", dp.brut, dp.rose, "Brut vs Rosé — the short token IS the product");
add("alcohol", "alcohol-variant", "SHOULD_NOT_MATCH", dp.brut, dp.brutCadou);
add("alcohol", "alcohol-variant", "SHOULD_NOT_MATCH", dp.brut, dp.brutNeon);
add("alcohol", "alcohol-variant", "SHOULD_NOT_MATCH", dp.rose, dp.roseCadou);
add("alcohol", "alcohol-variant", "SHOULD_NOT_MATCH", dp.brutCadou, dp.brutNeon);
add("alcohol", "alcohol-variant", "SHOULD_NOT_MATCH", dp.rose, dp.brutNeon);
add("alcohol", "alcohol-variant", "SHOULD_NOT_MATCH", dp.magnum, dp.neonMagnum);
// THE 32,49-lei regression: a generic "Dom" bottle is not Dom Pérignon
add("alcohol", "alcohol-variant", "SHOULD_NOT_MATCH", dp.brut, dp.domBogdan, "THE 32,49 lei regression");
add("alcohol", "alcohol-variant", "SHOULD_NOT_MATCH", dp.rose, dp.domBogdan);
add("alcohol", "alcohol-variant", "SHOULD_NOT_MATCH", dp.brutCadou, dp.domBogdan);
add("alcohol", "alcohol-variant", "SHOULD_NOT_MATCH", dp.brutNeon, dp.domBogdan);
add("alcohol", "cross-store", "SHOULD_MATCH", dp.brut, L("Dom Perignon Brut 0,75 l", "", "l", 0.75));
add("alcohol", "cross-store", "SHOULD_MATCH", dp.rose, L("Dom Perignon Rose 0,75 l", "", "l", 0.75));
add("alcohol", "cross-store", "SHOULD_MATCH", dp.magnum, L("Dom Perignon Brut Magnum 1,5 l", "", "l", 1.5));

// ─────────────────────────────────────────────────────────────────────────────
// 8. COSMETICS — differ only by shade / scent / volume (18 pairs)
// ─────────────────────────────────────────────────────────────────────────────
const cosm = (n: string, b: string, ml: number) => L(n, b, "l", ml / 1000);
add("cosmetice", "cosmetics-variant", "SHOULD_NOT_MATCH", cosm("Crema hidratanta Nivea Soft 50 ml", "Nivea", 50), cosm("Crema hidratanta Nivea Creme 50 ml", "Nivea", 50));
add("cosmetice", "cosmetics-variant", "SHOULD_NOT_MATCH", cosm("Sampon Head&Shoulders Classic Clean 400 ml", "Head&Shoulders", 400), cosm("Sampon Head&Shoulders Menthol Fresh 400 ml", "Head&Shoulders", 400));
add("cosmetice", "cosmetics-variant", "SHOULD_NOT_MATCH", cosm("Sampon Head&Shoulders Classic Clean 400 ml", "Head&Shoulders", 400), cosm("Sampon Head&Shoulders Anti-Matreata 400 ml", "Head&Shoulders", 400));
add("cosmetice", "cosmetics-variant", "SHOULD_NOT_MATCH", cosm("Apa micelara Garnier Skin Naturals 400 ml", "Garnier", 400), cosm("Apa micelara Garnier Bifazica 400 ml", "Garnier", 400));
add("cosmetice", "cosmetics-variant", "SHOULD_NOT_MATCH", cosm("Gel de curatare CeraVe Foaming 236 ml", "CeraVe", 236), cosm("Gel de curatare CeraVe Hydrating 236 ml", "CeraVe", 236));
add("cosmetice", "cosmetics-variant", "SHOULD_NOT_MATCH", cosm("Lotiune corp Nivea Rich Nourishing 400 ml", "Nivea", 400), cosm("Lotiune corp Nivea Express Hydration 400 ml", "Nivea", 400));
add("cosmetice", "cosmetics-variant", "SHOULD_NOT_MATCH", cosm("Deodorant Rexona Cotton Dry 150 ml", "Rexona", 150), cosm("Deodorant Rexona Invisible Black White 150 ml", "Rexona", 150));
add("cosmetice", "cosmetics-variant", "SHOULD_NOT_MATCH", cosm("Sampon Elseve Total Repair 5, 400 ml", "Elseve", 400), cosm("Sampon Elseve Color Vive, 400 ml", "Elseve", 400));
add("cosmetice", "pack-size", "SHOULD_NOT_MATCH", cosm("Sampon Head&Shoulders Classic Clean 400 ml", "Head&Shoulders", 400), cosm("Sampon Head&Shoulders Classic Clean 250 ml", "Head&Shoulders", 250));
add("cosmetice", "pack-size", "SHOULD_NOT_MATCH", cosm("Apa micelara Garnier Skin Naturals 400 ml", "Garnier", 400), cosm("Apa micelara Garnier Skin Naturals 200 ml", "Garnier", 200));
add("cosmetice", "cosmetics-variant", "SHOULD_MATCH", cosm("Sampon Head&Shoulders Classic Clean 400 ml", "Head&Shoulders", 400), cosm("Head & Shoulders sampon Classic Clean 400ml", "Head&Shoulders", 400));
add("cosmetice", "cosmetics-variant", "SHOULD_MATCH", cosm("Apa micelara Garnier Skin Naturals 400 ml", "Garnier", 400), cosm("Garnier Skin Naturals apa micelara 400 ml", "Garnier", 400));
add("cosmetice", "cosmetics-variant", "SHOULD_NOT_MATCH", cosm("Ruj Maybelline Color Sensational 01 Nude", "Maybelline", 5), cosm("Ruj Maybelline Color Sensational 02 Rose", "Maybelline", 5));
add("cosmetice", "cosmetics-variant", "SHOULD_NOT_MATCH", cosm("Fond de ten Maybelline Fit Me 110 Porcelain 30 ml", "Maybelline", 30), cosm("Fond de ten Maybelline Fit Me 220 Natural Beige 30 ml", "Maybelline", 30), "shade code is the whole difference");
add("cosmetice", "cosmetics-variant", "SHOULD_NOT_MATCH", cosm("Crema de fata Avene Hydrance 40 ml", "Avene", 40), cosm("Crema de fata Avene Cicalfate 40 ml", "Avene", 40));
add("cosmetice", "cosmetics-variant", "SHOULD_NOT_MATCH", cosm("Sapun lichid Dove Original 250 ml", "Dove", 250), cosm("Sapun lichid Dove Go Fresh 250 ml", "Dove", 250));
add("cosmetice", "cosmetics-variant", "SHOULD_MATCH", cosm("Sapun lichid Dove Original 250 ml", "Dove", 250), cosm("Dove sapun lichid Original 250ml", "Dove", 250));
add("cosmetice", "cosmetics-variant", "SHOULD_NOT_MATCH", cosm("Spuma de ras Gillette Series Sensitive 250 ml", "Gillette", 250), cosm("Spuma de ras Gillette Series Moisturizing 250 ml", "Gillette", 250));

// ─────────────────────────────────────────────────────────────────────────────
// 9. DCNEU — brand-heavy discounter catalog (12 pairs)
// ─────────────────────────────────────────────────────────────────────────────
const dn = (n: string, ml: number) => L(n, "", "l", ml / 1000);
add("dcneu", "dcneu-variant", "SHOULD_NOT_MATCH", dn("NIVEA ANTIPERSPIRANT DEO 250ML DRY FRESH", 250), dn("NIVEA ANTIPERSPIRANT DEO 250ML FRESH NATURAL", 250));
add("dcneu", "dcneu-variant", "SHOULD_NOT_MATCH", dn("NIVEA ANTIPERSPIRANT DEO 250ML DOUBLE EFECT", 250), dn("NIVEA ANTIPERSPIRANT DEO 250ML DERMA CONTROL RESTORE", 250));
add("dcneu", "dcneu-variant", "SHOULD_NOT_MATCH", dn("NIVEA ANTIPERSPIRANT DEO 250ML FRESH ROSE TOUCH", 250), dn("NIVEA ANTIPERSPIRANT DEO 250ML DRY FRESH", 250));
add("dcneu", "dcneu-variant", "SHOULD_NOT_MATCH", dn("NIVEA GEL DUS 250ML CASHMERE", 250), dn("NIVEA LAPTE CORP 250ML 5IN1 NOURISHING CREAM MILK", 250), "shower gel vs body milk");
add("dcneu", "dcneu-variant", "SHOULD_NOT_MATCH", dn("NIVEA GEL DUS 250ML CASHMERE", 250), dn("NIVEA ANTIPERSPIRANT DEO 250ML DRY FRESH", 250));
add("dcneu", "dcneu-variant", "SHOULD_NOT_MATCH", dn("NIVEA BORSETA CADOU (SG250ML+SGL400ML+LIPBALM) FEEL GOOD SKIN", 250), dn("NIVEA GEL DUS 250ML CASHMERE", 250), "gift set vs single product");
add("dcneu", "dcneu-variant", "SHOULD_NOT_MATCH", dn("NIVEA CREMA 150ML MEN HIDRATANTA", 150), dn("NIVEA CREMA HIDRATANTA 150ML", 150), "men's line vs standard");
add("dcneu", "dcneu-variant", "SHOULD_MATCH", dn("NIVEA GEL DUS 250ML CASHMERE", 250), dn("Nivea gel de dus Cashmere 250 ml", 250));
add("dcneu", "dcneu-variant", "SHOULD_MATCH", dn("NIVEA ANTIPERSPIRANT DEO 250ML DRY FRESH", 250), dn("Nivea deodorant antiperspirant Dry Fresh 250 ml", 250));
add("dcneu", "pack-size", "SHOULD_NOT_MATCH", dn("NIVEA GEL DUS 250ML CASHMERE", 250), dn("NIVEA GEL DUS 500ML CASHMERE", 500));
add("dcneu", "dcneu-variant", "SHOULD_NOT_MATCH", dn("NIVEA CASETA CADOU (SG250ML+FACEWASH100ML+CR30ML) MEN KEEP IT ESSENTIAL", 250), dn("NIVEA BORSETA CADOU (SG250ML+SGL400ML+LIPBALM) FEEL GOOD SKIN", 250));
add("dcneu", "dcneu-variant", "SHOULD_NOT_MATCH", dn("NIVEA ANTIPERSPIRANT DEO 150ML DRY FRESH", 150), dn("NIVEA ANTIPERSPIRANT DEO 250ML DRY FRESH", 250));

// ─────────────────────────────────────────────────────────────────────────────
// 10. FARMACIE — dosage and count are the product (10 pairs)
// ─────────────────────────────────────────────────────────────────────────────
const ph = (n: string, cnt: number) => L(n, "", "buc", cnt);
add("farmacie", "farmacie-variant", "SHOULD_NOT_MATCH", ph("Paracetamol 500 mg, 20 comprimate", 20), ph("Paracetamol 1000 mg, 20 comprimate", 20), "dosage differs");
add("farmacie", "farmacie-variant", "SHOULD_NOT_MATCH", ph("Nurofen 200 mg, 24 comprimate", 24), ph("Nurofen Forte 400 mg, 24 comprimate", 24));
add("farmacie", "farmacie-variant", "SHOULD_NOT_MATCH", ph("Vitamina D3 2000 UI, 60 capsule", 60), ph("Vitamina D3 4000 UI, 60 capsule", 60));
add("farmacie", "farmacie-variant", "SHOULD_NOT_MATCH", ph("Magneziu B6, 50 comprimate", 50), ph("Magneziu B6 Forte, 50 comprimate", 50));
add("farmacie", "pack-size", "SHOULD_NOT_MATCH", ph("Paracetamol 500 mg, 20 comprimate", 20), ph("Paracetamol 500 mg, 10 comprimate", 10));
add("farmacie", "pack-size", "SHOULD_NOT_MATCH", ph("Vitamina C 1000 mg, 30 comprimate", 30), ph("Vitamina C 1000 mg, 60 comprimate", 60));
add("farmacie", "farmacie-variant", "SHOULD_MATCH", ph("Paracetamol 500 mg, 20 comprimate", 20), ph("Paracetamol 500mg 20 compr.", 20));
add("farmacie", "farmacie-variant", "SHOULD_MATCH", ph("Vitamina D3 2000 UI, 60 capsule", 60), ph("Vitamina D3 2000UI 60 caps", 60));
add("farmacie", "farmacie-variant", "SHOULD_NOT_MATCH", ph("Omega 3, 60 capsule", 60), ph("Omega 3 Forte, 60 capsule", 60));
add("farmacie", "farmacie-variant", "SHOULD_NOT_MATCH", ph("Aspirina 500 mg, 20 comprimate", 20), ph("Aspirina Cardio 100 mg, 20 comprimate", 20));

// ─────────────────────────────────────────────────────────────────────────────
// 11. CROSS-STORE TRUE POSITIVES — these MUST keep matching (20 pairs)
// ─────────────────────────────────────────────────────────────────────────────
add("grocery", "cross-store", "SHOULD_MATCH", chio.sare125, L("Chio chipsuri cu sare 125 g", "Chio", "kg", 0.125));
add("grocery", "cross-store", "SHOULD_MATCH", chio.paprica170, L("Chio chipsuri paprika 170g", "Chio", "kg", 0.17));
add("grocery", "cross-store", "SHOULD_MATCH", lapte.napolact1, L("Lapte Napolact integral 3,5% 1 l", "Napolact", "l", 1));
add("grocery", "cross-store", "SHOULD_MATCH", lapte.caimac, L("Lapte integral Laptaria cu caimac 1 l", "Laptaria cu caimac", "l", 1));
add("grocery", "cross-store", "SHOULD_MATCH", L("Unt Covalact 200g", "Covalact", "kg", 0.2), L("Unt de masa Covalact 82% 200 g", "Covalact", "kg", 0.2));
add("grocery", "cross-store", "SHOULD_MATCH", L("Nutella crema tartinabila 400g", "Nutella", "kg", 0.4, "3017620425035"), L("NUTELLA CREMA CACAO ALUNE 400 G", "", "kg", 0.4, "3017620425035"), "EAN join beats name difference");
add("grocery", "cross-store", "SHOULD_MATCH", L("Branza telemea Fagaras 400g", "", "kg", 0.4), L("Branza telemea Făgăraş 400 g", "", "kg", 0.4), "cedilla vs comma-below");
add("grocery", "cross-store", "SHOULD_MATCH", L("Iaurt grecesc Olympus 400g", "Olympus", "kg", 0.4), L("Iaurt cu specific grecesc Olympus, 400 g", "Olympus", "kg", 0.4));
add("grocery", "cross-store", "SHOULD_MATCH", L("Cafea macinata Jacobs Kronung 250g", "Jacobs", "kg", 0.25), L("Cafea Jacobs Kronung macinata 250 g", "Jacobs", "kg", 0.25));
add("grocery", "cross-store", "SHOULD_MATCH", L("Ulei floarea soarelui Untdelemn de la Bunica 1L", "Untdelemn de la Bunica", "l", 1), L("Ulei de floarea soarelui Untdelemn de la Bunica, 1 l", "Untdelemn de la Bunica", "l", 1));
add("grocery", "cross-store", "SHOULD_MATCH", L("Zahar tos Coronita 1kg", "Coronita", "kg", 1), L("Zahar alb tos Coronita 1 kg", "Coronita", "kg", 1));
add("grocery", "cross-store", "SHOULD_MATCH", L("Orez cu bob lung Auchan 1kg", "Auchan", "kg", 1), L("Orez bob lung Auchan, 1 kg", "Auchan", "kg", 1));
add("grocery", "cross-store", "SHOULD_MATCH", L("Faina alba Baneasa 1kg", "Baneasa", "kg", 1), L("Faina alba tip 000 Baneasa 1 kg", "Baneasa", "kg", 1));
add("grocery", "cross-store", "SHOULD_MATCH", eco.spanac, L("ECO Baby Spanac proaspat 100 g", "", "kg", 0.1));
add("grocery", "cross-store", "SHOULD_MATCH", nivea.totalRelax, L("Nivea Men gel de dus Total Relax 500 ml", "Nivea", "l", 0.5));
add("grocery", "cross-store", "SHOULD_MATCH", nivea.energy, L("NIVEA MEN Energy gel de dus 500ml", "Nivea", "l", 0.5));
add("alcohol", "cross-store", "SHOULD_MATCH", zarea.iceAlb, L("Vin spumant Zarea Ice Alb demisec 0,75 l", "", "l", 0.75));
add("alcohol", "cross-store", "SHOULD_MATCH", otherWines.explicitMerlot, L("Vin rosu Explicit Merlot DOC sec 0,75 l", "", "l", 0.75));
add("cosmetice", "cross-store", "SHOULD_MATCH", cosm("Crema hidratanta Nivea Soft 50 ml", "Nivea", 50), cosm("Nivea Soft crema hidratanta 50ml", "Nivea", 50));
add("farmacie", "cross-store", "SHOULD_MATCH", ph("Nurofen 200 mg, 24 comprimate", 24), ph("Nurofen 200mg 24 comprimate filmate", 24));

// ── DESCRIPTOR ASYMMETRY (added 2026-09-08, BEFORE the fix that addresses it) ──────────────
//
// Two merchants describing ONE product in two vocabularies. Each side carries a token the other
// lacks, so `mutually-distinct` fires — correctly by its own definition, and wrongly in effect,
// because "UHT" and "de consum integral" are two ways of saying the same thing about the same
// milk, not two different milks.
//
// These are added BEFORE the descriptor exemption is written, so the fix is GRADED against them
// rather than tuned to them. Every SHOULD_MATCH here is a pair I have read and would accept as
// the same product at a different shop.
//
// The Freshful cases are the commonest shape by a wide margin: Freshful omits the brand from its
// product names, so the catalog side carries a brand token and the store side carries a
// descriptor, and each has something unique. That is a naming convention, not a difference.
//
// The SHOULD_NOT_MATCH cases are the guard-rail: a descriptor that CONTRADICTS one on the other
// side must still block. `uht` against silence is not a difference; `uht` against `proaspat` is.
const desc = (n: string, brand: string | null, unit: string, size: number): Side =>
  ({ name: n, brand, unit, unitSize: size });

// Napolact — the case that started this: 11 catalog rows for one product.
add("grocery", "cross-store", "SHOULD_MATCH",
  desc("Lapte de consum integral Napolact, 3.5% grasime, 1 l", "Napolact", "l", 1),
  desc("Lapte UHT Napolact 3.5% grasime 1L", "Napolact", "l", 1));
add("grocery", "cross-store", "SHOULD_MATCH",
  desc("Lapte de consum integral Napolact, 3.5% grasime, 1.5 l", "Napolact", "l", 1.5),
  desc("Napolact Lapte 3,5% Grasime 1,5 L", "Napolact", "l", 1.5));

// Lăptăria cu Caimac — same shape, different brand.
add("grocery", "cross-store", "SHOULD_MATCH",
  desc("Lapte de vaca integral Laptaria cu caimac, 3.8 - 4.1% grasime, 1 l", "Laptaria cu caimac", "l", 1),
  desc("Lapte de vaca 3.8-4.1% grasime 1L", "Laptaria cu caimac", "l", 1));

// Almette — brand-leading against description-leading.
add("grocery", "cross-store", "SHOULD_MATCH",
  desc("Crema de branza cu smantana Almette, 250 g", "Almette", "kg", 0.25),
  desc("Crema de branza proaspata cu smantana 250g", "Almette", "kg", 0.25));

// Freshful's brand omission — the pattern behind nearly all 2,097 recoverable pairs.
add("grocery", "cross-store", "SHOULD_MATCH",
  desc("Salam de Sibiu Agricola, 120 g", "Agricola", "kg", 0.12),
  desc("Salam de Sibiu, feliat 120g", "Agricola", "kg", 0.12));
add("grocery", "cross-store", "SHOULD_MATCH",
  desc("Sunca de Carpati Reinert, 100 g", "Reinert", "kg", 0.1),
  desc("Suncă de Carpați feliată 100g", "Reinert", "kg", 0.1));
add("grocery", "cross-store", "SHOULD_MATCH",
  desc("Iaurt cremos Covalact, 900 g", "Covalact", "kg", 0.9),
  desc("Iaurt cremos 5% grăsime, 900g", "Covalact", "kg", 0.9));

// ── THE GUARD-RAIL. A descriptor that CONTRADICTS still blocks. ──
// If the exemption is written too loosely these start passing, and that is the failure mode
// worth catching: fresh milk quoted at UHT's price is a wrong price, not a lost comparison.
add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH",
  desc("Lapte UHT Zuzu 3.5% grasime 1 l", "Zuzu", "l", 1),
  desc("Lapte proaspat Zuzu 3.5% grasime 1 l", "Zuzu", "l", 1));
add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH",
  desc("Lapte de consum integral Napolact 3.5% 1 l", "Napolact", "l", 1),
  desc("Lapte de consum degresat Napolact 0.1% 1 l", "Napolact", "l", 1));
add("grocery", "pack-size", "SHOULD_NOT_MATCH",
  desc("Iaurt cremos Covalact, 900 g", "Covalact", "kg", 0.9),
  desc("Iaurt cremos 5% grăsime, 400g", "Covalact", "kg", 0.4));

// ─────────────────────────────────────────────────────────────────────────────
// BRAND-FIRST NAMES — `headNoun` returns the BRAND, not the noun
//
// Added BEFORE the head-noun fix is written, so the fix is GRADED against them rather than
// tuned to them. `headNoun` is `sigTokens(nname)[0]`, and its own comment states the assumption:
// "RO names are noun-first". Measured across 6,939 branded grocery targets, 1,885 of them
// (27.2%) lead with the brand, so the "head noun" of "BUCEGI Carne Porc 300 g" is `bucegi` —
// and `decide()` then demands that word in the merchant's own name BEFORE the brand gate runs.
// 327 of 353 head-noun refusals (92.6%) sit on brand-first rows.
//
// The SHOULD_MATCH cases are the shape that compounds with the brand-in-name survey: a
// brand-first catalog row meeting a merchant that omits brands from its names.
//
// THE GUARD-RAILS MATTER MORE. Removing the brand from the head-noun test also removes whatever
// blocking that test was doing by accident, and these are the pairs it was blocking correctly.
// The last two are the exact leaks the full-catalog simulation showed: Milka Bubbly is a
// different bar, and a brandless "Apa plata 500ml" could be any of a dozen waters.
const bf = (n: string, brand: string | null, unit: string, size: number): Side =>
  ({ name: n, brand, unit, unitSize: size });

add("grocery", "cross-store", "SHOULD_MATCH",
  bf("BUCEGI Carne Porc 300 g", "Bucegi", "kg", 0.3),
  bf("Conserva carne de porc 300g", "Bucegi", "kg", 0.3));
add("grocery", "cross-store", "SHOULD_MATCH",
  bf("Poiana Ciocolata cu Lapte 90 g", "Poiana", "kg", 0.09),
  bf("Ciocolata cu lapte 90g", "Poiana", "kg", 0.09));
add("grocery", "cross-store", "SHOULD_MATCH",
  bf("Chio Hula Hoops Inele Cascaval 70 g", "Chio", "kg", 0.07),
  bf("Pufuleti crocanti Hula Hoops cu aroma de cascaval 70 g", "Chio", "kg", 0.07));

// ── GUARD-RAILS: what the brand-as-head-noun was blocking, correctly, by accident. ──
add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH",
  bf("BUCEGI Carne Porc 300 g", "Bucegi", "kg", 0.3),
  bf("Carne de curcan 300g", "Bucegi", "kg", 0.3));
add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH",
  bf("Poiana Ciocolata Lapte si Stafide 90 g", "Poiana", "kg", 0.09),
  bf("Ciocolata cu alune si stafide 90g", "Poiana", "kg", 0.09));
add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH",
  bf("Ciocolata cu lapte Milka, 90 g", "Milka", "kg", 0.09),
  bf("Ciocolata aerata cu lapte 90g", "Milka", "kg", 0.09));
add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH",
  bf("Apa plata minerala San Benedetto, 0.5 l", "San Benedetto", "l", 0.5),
  bf("Apa plata 500ml", null, "l", 0.5));

// ─────────────────────────────────────────────────────────────────────────────
// NUMERIC VARIANT CODES — a bare number is the discriminator and overlapTokens()
// drops it as size noise (docs/SOAK.md, 2026-09-16). Real names, real catalog IDs.
// ─────────────────────────────────────────────────────────────────────────────
add("cosmetice", "cosmetics-variant", "SHOULD_NOT_MATCH",
  L("Vopsea de par fara amoniac L'Oreal Paris Casting Creme Gloss 500, 180 ml", "L'Oreal", "l", 0.18),
  L("Vopsea de par fara amoniac L'Oreal Paris Casting Creme Gloss 613, 180 ml", "L'Oreal", "l", 0.18),
  "product #7646 vs #7663 — Auchan's own storeName ('...Gloss 500...') was live-matched onto both");

add("alcohol", "alcohol-variant", "SHOULD_NOT_MATCH",
  L("Chivas Regal 12 Ani 0.7L", "Chivas Regal", "l", 0.7),
  L("Chivas Regal 18 Ani 0.7L", "Chivas Regal", "l", 0.7),
  "age statement is the whole product; 12/18/25 Ani all sat live behind one FineStore/Carrefour listing");

add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH",
  L("aro Creveti Whiteleg, Cruzi, Decorticati, Curatati, 16/20, 800 g", "aro", "kg", 0.8),
  L("aro Creveti Whiteleg, Cruzi, Decorticati, Curatati, 26/30, 800 g", "aro", "kg", 0.8),
  "count-per-kilo grade — same brand, head-noun and size, different grade");

add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH",
  L("Faina alba de grau tip 000 pentru cozonac 1kg", null, "kg", 1),
  L("Faina de grau alba 650 1kg", null, "kg", 1),
  "milling grade, not a size — 000 vs 650 differ by protein/gluten content, not weight");

add("grocery", "branded-grocery-variant", "SHOULD_NOT_MATCH",
  L("Pampers Active baby scutec chilotel nr. 5, 11-17 kg, 32 bucati", "Pampers", "buc", 32),
  L("Pampers Act.Baby Scutece Nr.6, 13-18 kg ,32 bucati", "Pampers", "buc", 32),
  "diaper size 5 vs 6 — the most consequential live pair found: a wrong nappy size, not a wrong price");
