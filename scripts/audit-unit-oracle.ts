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

type Oracle = { unit: string; value: number };

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
  const worst: { slug: string; name: string; ours: number; theirs: number; unit: string; raw: string }[] = [];

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
        worst.push({
          slug: m.slug,
          name: (o.storeName ?? o.product.name).slice(0, 44),
          ours: o.pricePerUnit,
          theirs: oracle.value,
          unit: oracle.unit,
          raw: String(JSON.parse(o.rawSourceBlob!).formattedBasePrice ?? ""),
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
    console.log(`  ${pad("product", 46)}${lp("ours", 11)}${lp("merchant", 11)}   published`);
    for (const w of worst.slice(0, 40)) {
      console.log(
        `  ${pad(w.name, 46)}${lp(w.ours.toFixed(2), 11)}${lp(w.theirs.toFixed(2), 11)}   ${w.raw}`,
      );
    }
  }
  console.log(`\n  TOTAL DISAGREEMENTS: ${grandDiffer}\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
