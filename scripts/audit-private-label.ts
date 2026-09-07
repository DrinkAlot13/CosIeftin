// PHASE 1 — the raw material for private-label equivalence classes. READ-ONLY.
//
// The question: a shop's own 1 L milk and another shop's own 1 L milk are the same trade to a
// shopper, but they can never MATCH — different brands, different names, genuinely different
// products. Only an equivalence class can relate them. Before writing any class, this reports
// what is actually there.
//
// It writes nothing and proposes nothing. It does not decide membership; it shows the groups a
// class WOULD be written over, with every member visible, so the classes can be chosen by
// looking rather than by trusting a score.
//
//   npm run audit:private-label
//   npm run audit:private-label -- --groups=100 --full

import { PrismaClient } from "@prisma/client";
import { currentOfferWhere } from "../src/lib/queries";
import { normalizeRo } from "../src/lib/text/normalizeRo";
import { headNoun, prep } from "../src/lib/scrape-util";

const prisma = new PrismaClient();

/**
 * The private-label brands, as given in the brief.
 *
 * OWNERSHIP IS NOT ASSERTED HERE. It would be easy to write "MEGA -> mega-image" and then
 * report it as a fact, but which merchant a brand belongs to is not something this script can
 * observe — where its products actually APPEAR is. So each brand is matched by name only, and
 * the merchants it turns up at are reported. If a brand appears at one merchant, that is
 * evidence; if it appears at five, it is not a private label and the report will show that.
 */
const BRIEF_BRANDS = [
  "MEGA", "Gusturi romanesti", "Nature's Promise", "Emma", "Auchan", "Carrefour Classic",
  "Cumpana", "Freshful", "Sezamo", "Metro Chef", "Fine Life", "K-Classic", "Clever", "Nr.1",
];

/**
 * House brands the FIRST RUN of this script nominated and the brief's list missed.
 *
 * Each is a retailer's own line, and each appears at exactly one merchant in our data. They are
 * listed apart from the brief's list rather than merged into it, so the report can show what
 * the original list would have measured and what it missed — 1,046 more products, which is a
 * 41% undercount, not a rounding error.
 *
 * DELIBERATELY EXCLUDED from this list, though the discovery pass nominated them: DOVE,
 * GILLETTE, Schwarzkopf, Bic, SAVEX, La Lorraine, Covalact de Tara. Those are national brands
 * that happen to be stocked by one merchant — single-merchant is what a private label looks
 * like from the outside, but it is not what a private label IS, and treating the heuristic as
 * the answer is how a measurement becomes a guess. Also excluded: "Non-brand" and "(bucata)",
 * which are not brands at all but artefacts in the brand column.
 */
const DISCOVERED_BRANDS = [
  "ARO", "Pouce", "Carrefour", "Carrefour Bio", "Carrefour Sensation", "Filiera Auchan",
  "Nature's Promise Bio", "Din Gradina by Freshful", "Cosmia", "RIOBA", "METRO PROFESSIONAL",
  "TARRINGTON HOUSE", "World's Market",
];

const PRIVATE_LABEL_BRANDS = [...BRIEF_BRANDS, ...DISCOVERED_BRANDS];

/** Longest brand name first, so a specific line beats the generic one that contains it. */
const BRANDS_BY_SPECIFICITY = [...PRIVATE_LABEL_BRANDS].sort(
  (a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length,
);

/** A brand matches a product by its OWN brand field, or by leading its name. Reported apart. */
type Hit = { how: "brand-field" | "name-prefix" | "name-phrase"; brand: string };

function brandHit(name: string, brand: string | null, needle: string): Hit | null {
  const n = normalizeRo(needle);
  if (!n) return null;
  if (brand && normalizeRo(brand) === n) return { how: "brand-field", brand: needle };
  const nn = normalizeRo(name);
  // Whole-word boundaries on both sides: "MEGA" must not match "Omega 3", and "Emma" must not
  // match "Emmentaler". This is the difference between a measurement and a plausible number.
  const words = nn.split(/\s+/).filter(Boolean);
  const needleWords = n.split(/\s+/).filter(Boolean);
  for (let i = 0; i + needleWords.length <= words.length; i++) {
    if (needleWords.every((w, j) => words[i + j] === w)) {
      return { how: i === 0 ? "name-prefix" : "name-phrase", brand: needle };
    }
  }
  return null;
}

type Row = {
  id: number; name: string; brand: string | null; unit: string; unitSize: number;
  merchants: string[]; priceByMerchant: Map<string, number>;
  hit: Hit | null;
};

function sizeKey(unit: string, unitSize: number): string {
  return `${unit}:${Number(unitSize.toFixed(3))}`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const topN = Number((argv.find((a) => a.startsWith("--groups=")) ?? "--groups=100").split("=")[1]);
  const full = argv.includes("--full");

  const live = currentOfferWhere();
  const products = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: live } },
    select: {
      id: true, name: true, brand: true, unit: true, unitSize: true,
      offers: { where: live, select: { priceBani: true, merchant: { select: { slug: true } } } },
    },
  });

  const attrCount = await prisma.productAttribute.count({ where: { key: "isPrivateLabel" } });

  const rows: Row[] = products.map((p) => {
    const priceByMerchant = new Map<string, number>();
    for (const o of p.offers) if (o.priceBani != null) priceByMerchant.set(o.merchant.slug, o.priceBani);
    // MOST SPECIFIC BRAND FIRST. "Carrefour Bio" and "Carrefour Classic" both contain
    // "Carrefour", and whichever is tested first wins — so a plain first-match loop would file
    // every Carrefour Bio product under the conventional line and quietly merge BIO with
    // non-BIO, which is exactly the distinction the brief forbids collapsing.
    let hit: Hit | null = null;
    for (const b of BRANDS_BY_SPECIFICITY) {
      hit = brandHit(p.name, p.brand, b);
      if (hit) break;
    }
    return {
      id: p.id, name: p.name, brand: p.brand, unit: p.unit, unitSize: p.unitSize,
      merchants: [...priceByMerchant.keys()].sort(), priceByMerchant, hit,
    };
  });

  const pl = rows.filter((r) => r.hit);

  // ── 1. HOW MANY, AND WHERE ────────────────────────────────────────────────────
  console.log("=".repeat(96));
  console.log("PHASE 1 — PRIVATE-LABEL RAW MATERIAL");
  console.log("=".repeat(96));
  console.log(`\nLive grocery products (DELIVERY_PLATFORM excluded, as everywhere): ${products.length}`);
  console.log(`ProductAttribute rows with key "isPrivateLabel": ${attrCount}`);
  if (attrCount === 0) {
    console.log(`  ^ THE ATTRIBUTE HAS NEVER BEEN SET ON ANYTHING. The brief says "where set" —`);
    console.log(`    it is set nowhere, so every figure below comes from brand names alone.`);
  }
  const briefOnly = pl.filter((r) => BRIEF_BRANDS.includes(r.hit!.brand)).length;
  console.log(`Private-label products found by brand name: ${pl.length}  (${((pl.length / products.length) * 100).toFixed(1)}% of live)`);
  console.log(`  of which the brief's 14 brands find:      ${briefOnly}`);
  console.log(`  found only by the 13 brands DISCOVERED:   ${pl.length - briefOnly}  (+${(((pl.length - briefOnly) / Math.max(1, briefOnly)) * 100).toFixed(0)}% on the brief's list)`);

  console.log(`\n${"─".repeat(96)}\nBY BRAND — and the merchants each brand actually appears at\n${"─".repeat(96)}`);
  console.log(`${"brand".padEnd(20)} ${"products".padStart(8)} ${"1-shop".padStart(7)}  ${"by".padEnd(12)} merchants`);
  for (const b of PRIVATE_LABEL_BRANDS) {
    const mine = pl.filter((r) => r.hit!.brand === b);
    if (mine.length === 0) { console.log(`${b.padEnd(20)} ${String(0).padStart(8)}       -  ${"-".padEnd(12)} —`); continue; }
    const single = mine.filter((r) => r.merchants.length === 1).length;
    const merchantCount = new Map<string, number>();
    for (const r of mine) for (const m of r.merchants) merchantCount.set(m, (merchantCount.get(m) ?? 0) + 1);
    const how = new Map<string, number>();
    for (const r of mine) how.set(r.hit!.how, (how.get(r.hit!.how) ?? 0) + 1);
    const howStr = [...how.entries()].map(([k, v]) => `${k.slice(0, 4)}:${v}`).join(" ");
    const at = [...merchantCount.entries()].sort((a, b2) => b2[1] - a[1]).map(([m, c]) => `${m}(${c})`).join(" ");
    console.log(`${b.padEnd(20)} ${String(mine.length).padStart(8)} ${String(single).padStart(7)}  ${howStr.padEnd(12)} ${at}`);
  }

  console.log(`\n${"─".repeat(96)}\nBY MERCHANT — private-label products carried, and how many are single-shop TODAY\n${"─".repeat(96)}`);
  const perMerchant = new Map<string, { total: number; pl: number; plSingle: number }>();
  for (const r of rows) {
    for (const m of r.merchants) {
      const e = perMerchant.get(m) ?? { total: 0, pl: 0, plSingle: 0 };
      e.total++;
      if (r.hit) { e.pl++; if (r.merchants.length === 1) e.plSingle++; }
      perMerchant.set(m, e);
    }
  }
  console.log(`${"merchant".padEnd(22)} ${"live prods".padStart(10)} ${"priv.label".padStart(10)} ${"share".padStart(7)} ${"of those 1-shop".padStart(16)}`);
  for (const [m, e] of [...perMerchant.entries()].sort((a, b) => b[1].pl - a[1].pl)) {
    const share = e.total ? ((e.pl / e.total) * 100).toFixed(1) + "%" : "-";
    const sh = e.pl ? `${e.plSingle} (${((e.plSingle / e.pl) * 100).toFixed(0)}%)` : "-";
    console.log(`${m.padEnd(22)} ${String(e.total).padStart(10)} ${String(e.pl).padStart(10)} ${share.padStart(7)} ${sh.padStart(16)}`);
  }

  const plSingle = pl.filter((r) => r.merchants.length === 1).length;
  console.log(`\nOverall: ${plSingle} of ${pl.length} private-label products are single-shop today (${((plSingle / Math.max(1, pl.length)) * 100).toFixed(1)}%).`);
  console.log(`That is the pool a class can act on — a product already at 2+ merchants does not need one.`);

  // ── 2. BRANDS THE DATA ITSELF NOMINATES ───────────────────────────────────────
  // A brand carried by exactly one merchant, with real volume, is what a private label looks
  // like from the outside. This is DISCOVERY, not a claim: the list is for reading.
  console.log(`\n${"─".repeat(96)}\nCANDIDATE PRIVATE LABELS THE DATA NOMINATES (single-merchant brands, 15+ live products)\nNot in the brief's list. Reported for reading, not used below.\n${"─".repeat(96)}`);
  const byBrand = new Map<string, { n: number; merchants: Set<string> }>();
  for (const r of rows) {
    if (!r.brand) continue;
    const key = r.brand.trim();
    const e = byBrand.get(key) ?? { n: 0, merchants: new Set<string>() };
    e.n++;
    for (const m of r.merchants) e.merchants.add(m);
    byBrand.set(key, e);
  }
  const candidates = [...byBrand.entries()]
    .filter(([b, e]) => e.merchants.size === 1 && e.n >= 15 && !PRIVATE_LABEL_BRANDS.some((p) => normalizeRo(p) === normalizeRo(b)))
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 30);
  for (const [b, e] of candidates) console.log(`  ${b.padEnd(32)} ${String(e.n).padStart(4)} products   only at ${[...e.merchants][0]}`);
  if (candidates.length === 0) console.log("  (none)");

  // ── 3. THE GROUPS A CLASS WOULD BE WRITTEN OVER ───────────────────────────────
  // Grouped by head noun + unit + exact size, because that is the granularity a class has to
  // commit to: the brief requires an explicit min/max window, not a tolerance.
  type Group = {
    key: string; head: string; unit: string; size: number;
    rows: Row[]; merchants: Set<string>;
  };
  const groups = new Map<string, Group>();
  for (const r of pl) {
    const h = headNoun(prep(r.name, r.brand, null).nname);
    if (!h) continue;
    const key = `${h}|${sizeKey(r.unit, r.unitSize)}`;
    const g = groups.get(key) ?? { key, head: h, unit: r.unit, size: r.unitSize, rows: [], merchants: new Set<string>() };
    g.rows.push(r);
    for (const m of r.merchants) g.merchants.add(m);
    groups.set(key, g);
  }

  const ranked = [...groups.values()]
    .filter((g) => g.merchants.size >= 2)
    .sort((a, b) => b.merchants.size * b.rows.length - a.merchants.size * a.rows.length)
    .slice(0, topN);

  console.log(`\n${"=".repeat(96)}`);
  console.log(`TOP ${ranked.length} GROUPS BY (distinct merchants x products) — head noun + unit + exact size`);
  console.log(`${groups.size} groups in total; ${[...groups.values()].filter((g) => g.merchants.size >= 2).length} span 2+ merchants.`);
  console.log(`A group at ONE merchant cannot become a useful class, so those are excluded from the ranking.`);
  console.log("=".repeat(96));
  console.log(`\n${"#".padStart(4)} ${"head noun".padEnd(18)} ${"size".padEnd(10)} ${"mrch".padStart(4)} ${"prod".padStart(4)} ${"score".padStart(5)}  merchants`);
  ranked.forEach((g, i) => {
    console.log(`${String(i + 1).padStart(4)} ${g.head.padEnd(18)} ${`${g.size} ${g.unit}`.padEnd(10)} ${String(g.merchants.size).padStart(4)} ${String(g.rows.length).padStart(4)} ${String(g.merchants.size * g.rows.length).padStart(5)}  ${[...g.merchants].join(" ")}`);
  });

  // ── 4. THE MEMBERS, IN FULL ───────────────────────────────────────────────────
  console.log(`\n${"=".repeat(96)}`);
  console.log(`THE RAW MATERIAL — every product in every group above, with its own size and price`);
  console.log(`This is what a class would claim is interchangeable. Read it before approving one.`);
  console.log("=".repeat(96));
  const show = full ? ranked : ranked.slice(0, 40);
  for (const [i, g] of show.entries()) {
    console.log(`\n[${i + 1}] ${g.head} — ${g.size} ${g.unit}   ${g.merchants.size} merchants, ${g.rows.length} products`);
    // SIZE SPREAD, stated. Every row here shares an exact size by construction, so the spread
    // that matters is across the head noun as a whole — reported next to it.
    const sameHead = [...groups.values()].filter((x) => x.head === g.head && x.unit === g.unit);
    const sizes = sameHead.map((x) => x.size).sort((a, b) => a - b);
    if (sizes.length > 1) {
      console.log(`     sizes carried for "${g.head}" in ${g.unit}: ${sizes.join(", ")}  (spread ${(sizes[sizes.length - 1] / Math.max(sizes[0], 1e-9)).toFixed(1)}x)`);
    }
    for (const r of g.rows.sort((a, b) => a.merchants[0].localeCompare(b.merchants[0]))) {
      const prices = [...r.priceByMerchant.entries()].map(([m, b]) => `${m} ${(b / 100).toFixed(2)}`).join("  ");
      console.log(`     ${r.name.slice(0, 58).padEnd(58)} ${prices}`);
    }
  }
  if (!full && ranked.length > show.length) {
    console.log(`\n… ${ranked.length - show.length} more groups. Re-run with --full to print them all.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
