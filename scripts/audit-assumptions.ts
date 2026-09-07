// PHASE 6(b) — three assumptions nothing currently verifies, and the queries that expose them.
//
// The method that has found seventeen real defects here: take something the code BELIEVES,
// write the query that would show it false, run it over the whole catalog, and report what
// comes back even if the answer is "nothing". A passing test proves the case you thought of;
// a query over 33,000 real rows finds the ones you did not.
//
// The three chosen, and why each is worth asking:
//
//   1. THE TWIN PAIR. CLAUDE.md says `isCurrent` (JavaScript) and `currentOfferWhere` (SQL) are
//      the same rule expressed twice and "both must agree". Nothing compares the row SETS. If
//      they ever diverge, a page's count and its list disagree and each is internally consistent.
//
//   2. INTEGER MONEY. Every price is supposed to be bani. `Offer.price` is a legacy float kept
//      as a fallback. If the two disagree, which one a given code path reads decides the number
//      a shopper sees — and both look right in isolation.
//
//   3. THE SIZE IN THE NAME. `Product.unitSize` drives every unit price and every class window.
//      It is parsed from the name at ingest. Re-parsing the name now and comparing is the only
//      way to see where the stored value and the product's own name disagree.
//
//   npm run audit:assumptions

import { PrismaClient } from "@prisma/client";
import { isCurrent, MAX_DISPLAY_AGE_DAYS } from "../src/lib/pricing";
import { currentOfferWhere } from "../src/lib/queries";
import { parseQuantity } from "../src/lib/units/parseQuantity";

const prisma = new PrismaClient();

function head(n: number, t: string): void {
  console.log(`\n${"═".repeat(100)}\nASSUMPTION ${n} — ${t}\n${"═".repeat(100)}`);
}

async function main(): Promise<void> {
  // ── 1 ────────────────────────────────────────────────────────────────────────
  head(1, "`isCurrent` (JS) and `currentOfferWhere` (SQL) select the SAME offers");
  console.log(`  CLAUDE.md: "Both must agree; the test covers the predicate, and this is its query twin."`);
  console.log(`  Nothing has ever compared the row SETS. Doing it directly.\n`);

  const sqlIds = new Set(
    (await prisma.offer.findMany({ where: currentOfferWhere(), select: { id: true } })).map((o) => o.id),
  );
  // Every offer that COULD qualify, judged in JavaScript by the other half of the pair.
  const all = await prisma.offer.findMany({
    select: {
      id: true, availability: true, isStale: true, flagged: true, lastObservedAt: true,
      priceSource: true, merchant: { select: { active: true } },
    },
  });
  const jsIds = new Set(
    all.filter((o) => isCurrent(o as never) && o.merchant.active && o.priceSource !== "DELIVERY_PLATFORM").map((o) => o.id),
  );
  const onlySql = [...sqlIds].filter((id) => !jsIds.has(id));
  const onlyJs = [...jsIds].filter((id) => !sqlIds.has(id));
  console.log(`  SQL says current: ${sqlIds.size}`);
  console.log(`  JS  says current: ${jsIds.size}`);
  console.log(`  in SQL but not JS: ${onlySql.length}`);
  console.log(`  in JS but not SQL: ${onlyJs.length}`);
  if (onlySql.length || onlyJs.length) {
    const sample = await prisma.offer.findMany({
      where: { id: { in: [...onlySql.slice(0, 4), ...onlyJs.slice(0, 4)] } },
      select: {
        id: true, availability: true, isStale: true, flagged: true, lastObservedAt: true,
        priceSource: true, merchant: { select: { slug: true, active: true } }, product: { select: { name: true } },
      },
    });
    for (const o of sample) {
      const side = sqlIds.has(o.id) ? "SQL only" : "JS only";
      console.log(`    ${side}  offer ${o.id} [${o.merchant.slug}] avail=${o.availability} stale=${o.isStale} flagged=${o.flagged} seen=${o.lastObservedAt?.toISOString().slice(0, 10) ?? "null"} src=${o.priceSource}`);
    }
    console.log(`  ⇒ THE PAIR DISAGREES. A page's count and its list are computed by different halves.`);
  } else {
    console.log(`  ⇒ HOLDS. The two definitions select exactly the same ${sqlIds.size} offers.`);
  }

  // ── 2 ────────────────────────────────────────────────────────────────────────
  head(2, "`priceBani` and the legacy `price` float say the same thing");
  const rows = await prisma.offer.findMany({
    select: { id: true, price: true, priceBani: true, merchant: { select: { slug: true } }, product: { select: { name: true } } },
  });
  const nullBani = rows.filter((r) => r.priceBani == null);
  const disagree = rows.filter((r) => r.priceBani != null && Math.abs(r.priceBani - Math.round(r.price * 100)) > 0);
  console.log(`  offers                         ${rows.length}`);
  console.log(`  priceBani IS NULL              ${nullBani.length}`);
  console.log(`  priceBani != round(price*100)  ${disagree.length}`);
  if (disagree.length) {
    const byMerchant = new Map<string, number>();
    for (const d of disagree) byMerchant.set(d.merchant.slug, (byMerchant.get(d.merchant.slug) ?? 0) + 1);
    console.log(`  by merchant: ${[...byMerchant.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`);
    for (const d of disagree.slice(0, 6)) {
      console.log(`    offer ${d.id} [${d.merchant.slug}] float ${d.price} -> ${Math.round(d.price * 100)} bani, stored ${d.priceBani}  ${d.product.name.slice(0, 40)}`);
    }
    const worst = disagree.reduce((a, b) => (Math.abs(b.priceBani! - Math.round(b.price * 100)) > Math.abs(a.priceBani! - Math.round(a.price * 100)) ? b : a));
    console.log(`  ⇒ THEY DISAGREE. Largest gap: offer ${worst.id}, ${Math.abs(worst.priceBani! - Math.round(worst.price * 100)) / 100} lei.`);
  } else {
    console.log(`  ⇒ HOLDS. Every non-null priceBani equals round(price*100).`);
  }

  // ── 3 ────────────────────────────────────────────────────────────────────────
  head(3, "`Product.unitSize` agrees with the size written in the product's own name");
  const products = await prisma.product.findMany({
    where: { section: "grocery", offers: { some: currentOfferWhere() } },
    select: { id: true, name: true, unit: true, unitSize: true },
  });
  let unparseable = 0, agree = 0;
  const mismatches: { name: string; stored: string; parsed: string; ratio: number }[] = [];
  for (const p of products) {
    const q = parseQuantity(p.name);
    if (!q) { unparseable++; continue; }
    // parseQuantity is canonical G / ML / BUC; Product stores kg / l / buc.
    const toStored =
      q.unit === "G" ? { unit: "kg", value: q.value / 1000 }
      : q.unit === "ML" ? { unit: "l", value: q.value / 1000 }
      : { unit: "buc", value: q.value };
    if (toStored.unit !== p.unit) {
      mismatches.push({ name: p.name, stored: `${p.unitSize} ${p.unit}`, parsed: `${toStored.value} ${toStored.unit}`, ratio: Infinity });
      continue;
    }
    const ratio = p.unitSize > 0 ? Math.max(toStored.value / p.unitSize, p.unitSize / toStored.value) : Infinity;
    // 1% tolerance for float storage, not for a real difference.
    if (ratio <= 1.01) agree++;
    else mismatches.push({ name: p.name, stored: `${p.unitSize} ${p.unit}`, parsed: `${toStored.value} ${toStored.unit}`, ratio });
  }
  console.log(`  live grocery products          ${products.length}`);
  console.log(`  no size readable from the name ${unparseable}`);
  console.log(`  stored agrees with the name    ${agree}`);
  console.log(`  DISAGREE                       ${mismatches.length}  (${((mismatches.length / Math.max(1, products.length)) * 100).toFixed(2)}%)`);
  if (mismatches.length) {
    const bad = mismatches.sort((a, b) => b.ratio - a.ratio).slice(0, 12);
    console.log(`  WORST (by how far apart), unit mismatches first:`);
    for (const m of bad) {
      console.log(`    ${m.ratio === Infinity ? "unit  " : `${m.ratio.toFixed(1)}x  `} stored ${m.stored.padEnd(12)} name says ${m.parsed.padEnd(12)} ${m.name.slice(0, 46)}`);
    }
    console.log(`  ⇒ A stored size that disagrees with the name drives a wrong unit price AND a`);
    console.log(`    wrong equivalence-class window, and neither says where the number came from.`);
  } else {
    console.log(`  ⇒ HOLDS.`);
  }
  console.log(`\n(display-age window in force: ${MAX_DISPLAY_AGE_DAYS} days)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
