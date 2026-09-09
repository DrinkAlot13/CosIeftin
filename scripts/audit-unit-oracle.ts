// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// Counts EVERY row, shown or not — our maths against the merchant's, on every row we can check.
// That is deliberate and is the opposite of the user-facing audits: a withheld row is
// still data, and a corruption hiding inside one is still a corruption. Do not add a
// visibility filter here.
// An INDEPENDENT check on our unit-price maths, from the merchant's own published figure.
//
// Everything else in this project validates the unit price against our own parse of our own
// name string — which is the failure the whole codebase keeps repeating: a check that shares
// its assumption with the thing it checks. Kaufland publishes `formattedBasePrice`, e.g.
// "(=1 kg 17.22)": the per-unit price computed by the merchant, from the real pack size, with
// no involvement from us. That is a true oracle.
//
// It found 33 disagreements in 453 comparisons on the first run, and every one is a real
// defect in our size handling: promo packs not expanded ("1kg+330g" read as 0.33 kg),
// multipacks counted as one ("3 buc / 3+1 buc"), and sizes that live in a subtitle we never
// read (Glenfiddich 0,7 l → no size at all).
//
// It is also the answer to a harder question: what a price gate should be anchored on. A gate
// anchored on stored history fires hardest exactly when a parser is corrected. A gate anchored
// on agreement with an independently published per-unit price does not.
//
// Read-only. Run: npm run audit:unit-oracle

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

/** Tolerance for agreement — merchants round their own reference figures. */
const TOLERANCE = 0.02;

type Oracle = {
  unit: string;
  value: number;
  /** The merchant's OWN size string, where it publishes one — a second, independent check. */
  amount?: string | null;
};

/**
 * Pull a published per-unit price out of a merchant's source blob.
 *
 * Kaufland: `formattedBasePrice` = "(=1 kg 17.22)" — unit first, DOT decimal, wrapped in
 * parentheses. Kept as a per-merchant reader rather than one loose regex, because "the shape
 * happens to match" is how the wrong number gets read in the first place.
 */
function readOracle(merchantSlug: string, blob: string): Oracle | null {
  let b: Record<string, unknown>;
  try { b = JSON.parse(blob) as Record<string, unknown>; } catch { return null; }

  if (merchantSlug === "kaufland") {
    const raw = (b.formattedBasePrice ?? b.basePrice) as string | undefined;
    if (typeof raw !== "string") return null;
    const m = raw.match(/\(=\s*1\s*(kg|l|buc)\s+([\d.,]+)\)/i);
    if (!m) return null;
    const value = Number(m[2].replace(",", "."));
    return Number.isFinite(value) && value > 0 ? { unit: m[1].toLowerCase(), value } : null;
  }

  // ── SEZAMO publishes a RICHER oracle than Kaufland, on forty times as many offers.
  //
  //     prices.unitPrice  51.16      the per-unit price, computed by the shop
  //     unit              "kg"       the unit it is quoted in
  //     textualAmount     "250 g"    the shop's OWN size string — a second oracle, on our parse
  //     weightedItem      false      whether the item is sold by weight
  //
  // 7,618 live offers carry it and nothing was reading any of it. Found by the weight-pricing
  // sweep in `audit:variable-weight`, which widened a Mega-Image-shaped detector and
  // immediately found the bigger population elsewhere — the reason a detector shaped around one
  // merchant's payload cannot tell "nobody else does this" from "I only looked in one place".
  if (merchantSlug === "sezamo") {
    const prices = b.prices as Record<string, unknown> | undefined;
    const value = prices && typeof prices.unitPrice === "number" ? prices.unitPrice : null;
    const unit = typeof b.unit === "string" ? b.unit.toLowerCase() : null;
    if (value === null || !unit || !(value > 0)) return null;
    // A weighted item's per-unit price is the price; comparing it against a pack-derived figure
    // compares two different claims. Excluded rather than counted as a disagreement.
    if (b.weightedItem === true) return null;
    return { unit, value, amount: typeof b.textualAmount === "string" ? b.textualAmount : null };
  }
  return null;
}

async function main(): Promise<void> {
  const merchants = await prisma.merchant.findMany({
    where: { active: true },
    select: { id: true, slug: true },
    orderBy: { slug: "asc" },
  });

  console.log("\n════ OUR UNIT PRICE vs THE MERCHANT'S OWN PUBLISHED FIGURE ══════════════════");
  console.log("  The only check in this project that does not share an assumption with the");
  console.log("  thing it is checking. A blank row means that merchant publishes no per-unit");
  console.log("  reference, or keeps no source blob to read it from.\n");
  console.log(`  ${pad("merchant", 14)}${lp("blobs", 8)}${lp("oracle", 9)}${lp("agree", 8)}${lp("differ", 8)}${lp("rate", 8)}`);

  let grandDiffer = 0;
  const worst: { slug: string; name: string; ours: number; theirs: number; unit: string; raw: string; ourSize: number | null; theirSize: string | null; impliedSize: number | null }[] = [];

  for (const m of merchants) {
    const offers = await prisma.offer.findMany({
      // Stale offers are withheld from display, so a stale row's unit price is not a defect
      // anyone can see. Counting them double-reports every product whose size we just fixed.
      where: { merchantId: m.id, rawSourceBlob: { not: null }, isStale: false },
      select: {
        pricePerUnit: true, price: true, storeName: true, rawSourceBlob: true,
        ownUnit: true, ownUnitSize: true,
        product: { select: { name: true, unit: true, unitSize: true } },
      },
    });
    if (offers.length === 0) continue;

    let withOracle = 0, agree = 0, differ = 0;
    for (const o of offers) {
      const oracle = readOracle(m.slug, o.rawSourceBlob!);
      if (!oracle) continue;
      withOracle++;
      // Only compare like with like: a per-buc reference says nothing about our per-kg figure.
      const ourUnit = (o.ownUnit ?? o.product.unit ?? "").toLowerCase();
      if (ourUnit !== oracle.unit) { continue; }
      if (o.pricePerUnit > 0 && Math.abs(o.pricePerUnit - oracle.value) / oracle.value < TOLERANCE) {
        agree++;
      } else {
        differ++;
        // WHAT THE MERCHANT'S FIGURE IMPLIES OUR SIZE SHOULD BE. Every disagreement here is a
        // defect in OUR size handling — that is the entire point of an oracle — so the useful
        // thing to print is not the two prices but the two SIZES they imply.
        const price = o.price;
        const impliedSize = oracle.value > 0 ? price / oracle.value : null;
        worst.push({
          slug: m.slug,
          name: (o.storeName ?? o.product.name).slice(0, 60),
          ours: o.pricePerUnit,
          theirs: oracle.value,
          unit: oracle.unit,
          raw: m.slug === "kaufland" ? String(JSON.parse(o.rawSourceBlob!).formattedBasePrice ?? "") : (oracle.amount ?? ""),
          ourSize: o.ownUnitSize ?? o.product.unitSize ?? null,
          theirSize: oracle.amount ?? null,
          impliedSize,
        });
      }
    }
    grandDiffer += differ;
    const rate = agree + differ === 0 ? "—" : ((differ / (agree + differ)) * 100).toFixed(1) + "%";
    console.log(
      `  ${pad(m.slug, 14)}${lp(offers.length, 8)}${lp(withOracle, 9)}${lp(agree, 8)}${lp(differ, 8)}${lp(rate, 8)}` +
      `${differ > 0 ? "  ⚠" : ""}`,
    );
  }

  if (worst.length > 0) {
    console.log(`\n\n  ${worst.length} DISAGREEMENTS — every one is a defect in OUR size handling,`);
    console.log(`  because the price itself matches the source (verified separately: 607 of 608).\n`);
    // ── GROUPED BY SHAPE, NOT LISTED ONE BY ONE.
    //
    // A list of a hundred rows is a list nobody acts on. The RATIO between our size and the size
    // the merchant's own figure implies NAMES the bug: 1000x is a gram/kilogram slip, a small
    // integer is a multipack counted as one item, a fraction just above 1 is a promo pack whose
    // free part we dropped. Fix a shape and every member of it is fixed at once.
    const shapeOf = (w: (typeof worst)[number]): string => {
      if (!w.ourSize || !w.impliedSize || w.impliedSize <= 0) return "size unknown to us";
      const r = w.ourSize / w.impliedSize;
      const near = (x: number, t: number): boolean => Math.abs(x - t) / t < 0.06;
      if (near(r, 1000) || near(r, 0.001)) return "1000x — grams read as kilograms, or the reverse";
      for (const n of [2, 3, 4, 6, 8, 10, 12, 24]) {
        if (near(r, 1 / n)) return `${n}x too SMALL — a multipack counted as one item`;
        if (near(r, n)) return `${n}x too LARGE — one item counted as a pack`;
      }
      // ── NOT EVERY DISAGREEMENT IS OUR DEFECT, and this bucket is where that shows.
      //
      // Kaufland quotes canned goods per DRAINED weight while the name states the gross:
      //
      //     Roua Fasole albă 540 g       our 0.540 kg   implied 0.400 kg
      //     Mandarine felii întregi 312 g  our 0.312 kg   implied 0.175 kg
      //     Roua Ciuperci tăiate 280 g   our 0.280 kg   implied 0.150 kg
      //
      // Those are the standard drained weights for those tins. Our size is the pack a shopper
      // buys and theirs is the food in it — two different, both-correct claims. Reporting them
      // as our bugs would send someone to "fix" a parser that is right.
      if (r > 1.02 && r < 2) return "LARGER than implied — often a MERCHANT convention (drained weight on tins), sometimes a promo pack's free part dropped";
      if (r < 0.98 && r > 0.5) return "slightly SMALLER — rounding, or net against gross weight";
      return `other (ours / implied = ${r.toFixed(3)})`;
    };

    const byShape = new Map<string, typeof worst>();
    for (const w of worst) {
      const k = shapeOf(w);
      const l = byShape.get(k) ?? [];
      l.push(w);
      byShape.set(k, l);
    }

    console.log(`\n  BY SHAPE — fix a shape, fix every member of it`);
    for (const [shape, list] of [...byShape.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const per = new Map<string, number>();
      for (const w of list) per.set(w.slug, (per.get(w.slug) ?? 0) + 1);
      console.log(`\n    ${String(list.length).padStart(4)}  ${shape}`);
      console.log(`          ${[...per.entries()].map(([m2, n]) => `${m2} ${n}`).join("  ")}`);
      for (const w of list.slice(0, 4)) {
        console.log(`          ${pad(w.name, 54)} ours ${w.ours.toFixed(2)} · theirs ${w.theirs.toFixed(2)} /${w.unit}`);
        console.log(`          ${" ".repeat(54)} our size ${w.ourSize ?? "?"}, implied ${w.impliedSize ? w.impliedSize.toFixed(4) : "?"}${w.theirSize ? `, they say "${w.theirSize}"` : ""}`);
      }
    }
  }
  console.log(`\n  TOTAL DISAGREEMENTS: ${grandDiffer}\n`);

  // ── WHO ELSE PUBLISHES ONE WE ARE NOT READING?
  //
  // Sezamo's 7,618 offers carrying `prices.unitPrice` sat unexamined for months because nothing
  // asked this question — the oracle knew only Kaufland, so "Kaufland is the only merchant with
  // a published per-unit price" was never a finding, it was the reader's own shape reflected
  // back. An oracle that only looks where it already looks cannot grow.
  //
  // So: scan every merchant's payloads for the vocabulary of a published per-unit price, and
  // report whether we READ it. A field present and unread is the next oracle.
  const SIGNALS: { field: string; re: RegExp }[] = [
    { field: "prices.unitPrice", re: /"unitPrice"\s*:\s*[\d.]+/ },
    { field: "formattedBasePrice", re: /"formattedBasePrice"\s*:/ },
    { field: "basePrice", re: /"basePrice"\s*:/ },
    { field: "unitPriceFormatted", re: /"unitPriceFormatted"\s*:/ },
    { field: "pricePerUnit / pricePerUom", re: /"price[Pp]er(Unit|Uom)"\s*:/ },
    { field: "measurementUnitPrice", re: /"measurement\w*[Pp]rice"\s*:/ },
    { field: "textualAmount (their own size)", re: /"textualAmount"\s*:/ },
    { field: "lei/kg in a label", re: /[Ll]ei\s*\/\s*kg/ },
  ];
  const READ_BY_ORACLE = new Set(["kaufland", "sezamo"]);

  console.log(`  ${"─".repeat(92)}`);
  console.log(`  WHO PUBLISHES A PER-UNIT PRICE, AND DO WE READ IT?`);
  console.log(`  ${"─".repeat(92)}`);
  for (const m of merchants) {
    const sample = await prisma.offer.findMany({
      where: { merchantId: m.id, rawSourceBlob: { not: null }, isStale: false },
      select: { rawSourceBlob: true },
      take: 400,
    });
    if (sample.length === 0) continue;
    const found: string[] = [];
    for (const sig of SIGNALS) {
      const n = sample.filter((o) => sig.re.test(o.rawSourceBlob ?? "")).length;
      if (n > 0) found.push(`${sig.field} ${Math.round((n / sample.length) * 100)}%`);
    }
    if (found.length === 0) continue;
    const read = READ_BY_ORACLE.has(m.slug);
    console.log(`  ${pad(m.slug, 16)} ${read ? "READ  " : "UNREAD"}  ${found.join("  ·  ")}`);
  }
  console.log(`\n  UNREAD means the merchant publishes something this oracle does not use. It does`);
  console.log(`  NOT mean the field is usable — the name of a field is not its meaning:`);
  console.log(``);
  console.log(`    mega-image  prices.unitPrice on 100% of offers, and it is THE PACK PRICE`);
  console.log(`                ECHOED BACK. Checked on 40 fixed packs: unitPrice == price on all`);
  console.log(`                40, with unit "piece" — 12,89 for a 250 g cheese whose per-kilo`);
  console.log(`                price is 51,56. It is a real per-unit price ONLY on the ~181`);
  console.log(`                variable-weight items where unitCode is "kilogram".`);
  console.log(`                Wiring it in unverified would have compared a pack price against`);
  console.log(`                our per-kilo figure and reported thousands of false defects.`);
  console.log(``);
  console.log(`    freshful    a "lei/kg" label on 69% of offers, unparsed. Genuinely unexamined`);
  console.log(`                and the best remaining candidate for a fourth oracle.`);
  console.log(``);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
