// ── TWO PRICES ON ONE TILE, AND THE SELECTOR TOOK THE WRONG ONE. READ-ONLY.
//
// This defect has now been discovered THREE TIMES SEPARATELY, once per merchant, each time as
// if it were new:
//
//   mega-image  a per-kilo price beside an approximate weight and a till price — 35,99/kg
//               stored as if it were what the pack costs (25,19)
//   penny       "preț fără PENNY card 22,99 · 1 BC 0,58 · preț cu PENNY card 17,99 · 1 BC 0,45"
//               four figures in one wrapper; we stored the LAST — 0,45 lei for a 17,99 pack
//   selgros     "per BUC." / "per kg" beside a price split across two spans
//
// and a fourth turned up while writing this: **carrefour** stores `"8 29 Lei 7 99 Lei"` — a
// was-price and a current price, both split across spans.
//
// One shape, four merchants, four separate investigations. This closes the class instead.
//
// ── WHY `rawPriceText` ALONE CANNOT ANSWER IT, which is the trap.
//
// That column holds WHAT THE SELECTOR REACHED, not what the tile showed. Penny's carried all
// four figures until the selector was narrowed — and the narrowing that fixed the bug also
// erased the evidence of it. So a survey of stored strings finds the merchants whose selector is
// too WIDE, and is blind by construction to the ones whose selector is confidently too narrow.
// Section 1 is therefore a lead, not a verdict, and `probe:price-figures` asks the pages.
//
// ── SECTION 2 IS THE ACTUAL INVARIANT, and it needs no selectors at all.
//
// Where a merchant publishes its own per-unit price, our stored PACK price can be checked
// against it directly:
//
//     stored price ≈ merchant's per-unit price   AND   the pack is not one unit
//         → we stored a per-unit figure as the pack price
//
// That is exactly the Penny bug, stated without reference to any DOM. It is the same figure
// `audit:unit-oracle` uses and the opposite question: the oracle asks whether our unit-price
// MATHS is right, this asks whether our PRICE is a unit price wearing a pack price's name.
//
//   npm run audit:price-figures
//   npm run audit:price-figures -- --json logs/price-figures.json

import { PrismaClient } from "@prisma/client";
import { readMerchantUnitPrice } from "../src/lib/price/merchant-unit-price";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number) => String(s).padStart(n);
const lei = (b: number) => (b / 100).toFixed(2).replace(".", ",");

/**
 * Every money-looking figure in a stored source string, in reading order.
 *
 * DELIBERATELY BROAD, because the merchants differ and a narrow detector reports "one price
 * here" about a tile showing four. The first version required a dot or comma decimal and found
 * ZERO figures in all 5,279 Carrefour rows — whose format is `8 29 Lei`, the decimal separator
 * being a gap between two <span>s. Reporting "Carrefour shows one price" would have been the
 * detector's own shape read back as a fact about the merchant.
 */
export function moneyFigures(raw: string): number[] {
  const out: number[] = [];
  // `8 29 Lei` / `7 99 Lei` — split spans, currency attached. Must run BEFORE the plain scan,
  // and its match is consumed so the halves are not also counted as two separate figures.
  let rest = raw;
  for (const m of [...raw.matchAll(/(\d{1,4})\s+(\d{2})\s*(?:lei|ron)\b/gi)]) {
    out.push(Number(m[1]) * 100 + Number(m[2]));
    rest = rest.replace(m[0], " ");
  }
  // 12.69 / 12,69
  for (const m of [...rest.matchAll(/(\d{1,5})[.,](\d{2})\b/g)]) {
    out.push(Number(m[1]) * 100 + Number(m[2]));
    rest = rest.replace(m[0], " ");
  }
  // A bare integer that is the whole string, or is currency-attached: lemanoir stores "27".
  for (const m of [...rest.matchAll(/\b(\d{1,5})\s*(?:lei|ron)\b|^\s*(\d{1,5})\s*$/gi)]) {
    const v = m[1] ?? m[2];
    if (v) out.push(Number(v) * 100);
  }
  return out;
}

type Flag = {
  offerId: number; merchant: string; product: string;
  storedBani: number; unitPrice: number; unit: string; packSize: number | null;
  packUnit: string | null; weighted: boolean; multiple: number | null;
};

async function main(): Promise<void> {
  const offers = await prisma.offer.findMany({
    where: { merchant: { active: true }, isStale: false },
    select: {
      id: true, priceBani: true, price: true, rawPriceText: true, rawSourceBlob: true,
      isVariableWeight: true, quotedUnitPriceBani: true,
      merchant: { select: { slug: true } },
      product: { select: { name: true, unitSize: true, unit: true } },
    },
  });

  console.log("═".repeat(104));
  console.log("PACK PRICE OR UNIT PRICE? — one tile, several figures, and which one we kept");
  console.log(`${offers.length} live offers across ${new Set(offers.map((o) => o.merchant.slug)).size} merchants`);
  console.log("═".repeat(104));

  // ── SECTION 1: HOW MANY FIGURES DID THE SOURCE STRING CARRY? ─────────────────────────────
  const bySlug = new Map<string, { total: number; multi: number; posn: Map<string, number>; sample: string[] }>();
  for (const o of offers) {
    const slug = o.merchant.slug;
    if (!bySlug.has(slug)) bySlug.set(slug, { total: 0, multi: 0, posn: new Map(), sample: [] });
    const e = bySlug.get(slug)!;
    e.total++;
    const figs = moneyFigures(o.rawPriceText ?? "");
    const uniq = [...new Set(figs)];
    if (uniq.length < 2) continue;
    e.multi++;
    const stored = o.priceBani ?? Math.round(o.price * 100);
    const where =
      stored === figs[0] ? "first"
      : stored === figs[figs.length - 1] ? "last"
      : stored === Math.min(...uniq) ? "min"
      : stored === Math.max(...uniq) ? "max"
      : "NOT AMONG THEM";
    e.posn.set(where, (e.posn.get(where) ?? 0) + 1);
    if (e.sample.length < 2) e.sample.push(`stored ${lei(stored)} · figures [${uniq.map(lei).join(", ")}] · ${JSON.stringify((o.rawPriceText ?? "").slice(0, 70))}`);
  }

  console.log(`\n  1. SOURCE STRINGS CARRYING MORE THAN ONE PRICE — a lead, not a verdict\n`);
  console.log(`  ${pad("merchant", 16)}${lp("live", 7)}${lp("multi", 8)}   where our stored price sits`);
  console.log("  " + "─".repeat(78));
  for (const [slug, e] of [...bySlug].sort((a, b) => b[1].multi - a[1].multi)) {
    const p = [...e.posn].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ") || "—";
    console.log(`  ${pad(slug, 16)}${lp(e.total, 7)}${lp(e.multi, 8)}   ${p}`);
    for (const s of e.sample) console.log(`      ${s}`);
  }
  console.log(`\n  A merchant reading 0 here is NOT cleared. rawPriceText holds what the selector`);
  console.log(`  reached: Penny's carried all four figures until the selector was narrowed, and the`);
  console.log(`  narrowing that fixed the bug erased the evidence of it. Only \`probe:price-figures\``);
  console.log(`  can tell "the tile shows one price" from "our selector only ever saw one".`);

  // ── SECTION 2: THE INVARIANT ─────────────────────────────────────────────────────────────
  const TOL = 0.02; // 2% — merchant rounding, not a different number
  const near = (a: number, b: number) => b > 0 && Math.abs(a - b) / b <= TOL;

  const flags: Flag[] = [];
  const checkable = new Map<string, number>();

  for (const o of offers) {
    const mup = readMerchantUnitPrice(o.merchant.slug, o.rawSourceBlob);
    if (!mup) continue;
    checkable.set(o.merchant.slug, (checkable.get(o.merchant.slug) ?? 0) + 1);

    const stored = o.priceBani ?? Math.round(o.price * 100);
    const size = o.product.unitSize;
    const pUnit = o.product.unit ? o.product.unit.toLowerCase() : null;

    // Comparable only when the merchant quotes in the unit our size is stored in.
    const sameUnit =
      (mup.unit === "kg" && pUnit === "kg") ||
      (mup.unit === "l" && pUnit === "l") ||
      (mup.unit.startsWith("buc") && pUnit === "buc");
    if (!sameUnit || size == null || !(size > 0)) continue;

    // THE DEFECT: our stored price equals the merchant's PER-UNIT price, on a pack that is not
    // one unit. A one-unit pack is the case where the two figures legitimately coincide, which
    // is exactly why this hid at Penny — a catalogue of kilo produce.
    if (near(stored / 100, mup.value) && !near(size, 1)) {
      flags.push({
        offerId: o.id, merchant: o.merchant.slug, product: o.product.name,
        storedBani: stored, unitPrice: mup.value, unit: mup.unit,
        packSize: size, packUnit: pUnit, weighted: mup.weighted === true,
        multiple: size,
      });
    }
  }

  console.log(`\n${"─".repeat(104)}`);
  console.log(`  2. THE INVARIANT — stored price vs the merchant's OWN per-unit price\n`);
  console.log(`  ${pad("merchant", 16)}${lp("checkable", 11)}${lp("flagged", 9)}${lp("rate", 8)}`);
  console.log("  " + "─".repeat(44));
  const slugs = [...new Set([...checkable.keys()])].sort();
  for (const s of slugs) {
    const c = checkable.get(s) ?? 0;
    const f = flags.filter((x) => x.merchant === s).length;
    console.log(`  ${pad(s, 16)}${lp(c, 11)}${lp(f, 9)}${lp(`${((f / Math.max(1, c)) * 100).toFixed(1)}%`, 8)}`);
  }
  const noOracle = [...bySlug.keys()].filter((s) => !checkable.has(s)).sort();
  if (noOracle.length > 0) {
    console.log(`\n  NOT CHECKABLE — these merchants publish no per-unit price we read, so this`);
    console.log(`  invariant says NOTHING about them. That is an absence of evidence, not a pass:`);
    console.log(`    ${noOracle.join(", ")}`);
  }

  if (flags.length > 0) {
    console.log(`\n  EVERY FLAGGED ROW — our price, their per-unit price, and the pack it is on:`);
    for (const f of flags.slice(0, 30)) {
      console.log(`    ${pad(f.merchant, 14)} #${f.offerId}  we ${lei(f.storedBani)}  their ${f.unitPrice.toFixed(2)}/${f.unit}  pack ${f.packSize} ${f.packUnit}${f.weighted ? "  [merchant says SOLD BY WEIGHT]" : ""}`);
      console.log(`      ${f.product.slice(0, 84)}`);
    }
    if (flags.length > 30) console.log(`    … and ${flags.length - 30} more.`);
    console.log(`\n  A row marked SOLD BY WEIGHT is not necessarily our defect: for those the per-unit`);
    console.log(`  price IS the price, and the question is whether our PACK SIZE should be 1.`);
  }

  console.log(`\n${"═".repeat(104)}`);
  console.log(`  ${flags.length} offers hold a price equal to the merchant's own per-unit figure on a pack`);
  console.log(`  that is not one unit. ${checkable.size} of ${bySlug.size} merchants can be checked this way at all.`);
  console.log("═".repeat(104));

  emitJson({
    pass: true, offers: offers.length,
    multiFigure: Object.fromEntries([...bySlug].map(([k, v]) => [k, v.multi])),
    checkable: Object.fromEntries(checkable),
    flagged: flags.length,
    flags: flags.slice(0, 200),
    notCheckable: noOracle,
  });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
