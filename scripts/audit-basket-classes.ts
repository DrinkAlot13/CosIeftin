// ── SCOPE: REPORT ONLY. Run this BEFORE publishing basket v2, and after any class edit.
//
// THE FAILURE THIS EXISTS TO CATCH.
//
// A class-based basket can get cheaper because a class resolved to a smaller or worse product,
// not because prices fell. That is exactly the bug pinning was introduced to kill — the old
// runtime search read +26.8% in three days by changing its own membership — and a class is a
// controlled way to let membership move again. Controlled only if somebody checks.
//
// So, for each of the forty lines:
//
//   • WHAT it resolves to at each shop, by name, pack and price;
//   • the SIZE SPREAD of those packs. A class resolving to 200 ml at one shop and 1 l at
//     another is a bad class, not a cheap shop, and the total it produces is meaningless;
//   • whether any shop can fill it at all.
//
// A class is flagged when the largest pack is more than SPREAD_LIMIT times the smallest. That
// threshold is a reporting line, not a rule the code enforces — the enforcement is the class's
// own `require`/`exclude`/`maxUnitSize`, and a flag here means those need work.
//
// Run: npm run audit:basket-classes

import { PrismaClient } from "@prisma/client";
import { resolveClassesAcrossShops, priceBasketV2 } from "../src/lib/index-v2";
import { INDEX_BASKET_V2 } from "../src/lib/index-basket-v2";

const prisma = new PrismaClient();

/** Largest pack over smallest. Above this, the shops are not buying the same thing. */
const SPREAD_LIMIT = 1.5;
/** Under this many shops a line cannot carry a comparison, whatever its spread. */
const MIN_SHOPS_FOR_COMPARISON = 2;

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);
const lei = (bani: number): string => (bani / 100).toFixed(2);

async function main(): Promise<void> {
  console.log(`\n════ BASKET v2 — CLASS RESOLUTION AUDIT ═════════════════════════════════════`);
  console.log(`  Forty lines, each defined as an equivalence class. Flags a class whose chosen`);
  console.log(`  packs differ by more than ${SPREAD_LIMIT}x across shops — that is a bad class, not a`);
  console.log(`  cheap shop, and any total built on it is meaningless.\n`);

  const resolutions = await resolveClassesAcrossShops();
  const now = await priceBasketV2();

  const wide: string[] = [];
  const thin: string[] = [];
  const empty: string[] = [];

  console.log(`  ${pad("LINE", 26)} ${lp("shops", 6)} ${lp("min", 8)} ${lp("max", 8)} ${lp("spread", 7)}  VERDICT`);
  console.log(`  ${"-".repeat(92)}`);

  for (const r of resolutions) {
    const n = r.picks.length;
    if (n === 0) {
      empty.push(r.item.key);
      console.log(`  ${pad(r.item.label, 26)} ${lp(0, 6)} ${lp("—", 8)} ${lp("—", 8)} ${lp("—", 7)}  ✗ NO SHOP CAN FILL IT`);
      continue;
    }
    const sizes = r.picks.map((p) => p.packQuantity).filter((q) => q > 0);
    const min = sizes.length ? Math.min(...sizes) : 0;
    const max = sizes.length ? Math.max(...sizes) : 0;
    const spread = min > 0 ? max / min : 0;

    // ── WHAT A WIDE SPREAD MEANS DEPENDS ON HOW THE LINE IS PRICED.
    //
    // For a FIXED-PACK class the pack IS the line, so two shops choosing 200 ml and 1 l are not
    // pricing the same thing and the total is meaningless. Flag it.
    //
    // For a WEIGHT-SOLD class (`anySize`) the line is priced per kilo, so a 200 g single banana
    // and a 1 kg bag both price "1 kg of bananas" correctly. Flagging that would be reporting
    // the design as a defect. The first version of this audit did exactly that and called five
    // healthy classes broken.
    //
    // What still matters for a weight-sold class is that the picks sit inside the class's own
    // size window — if one does not, the window is not being enforced, which is the real fault.
    const outsideWindow = r.picks.filter((p) => {
      const inClassUnits = p.unit === "buc" || p.unit === "BUC" ? p.packQuantity : p.packQuantity / 1000;
      if (r.minUnitSize != null && inClassUnits < r.minUnitSize) return true;
      if (r.maxUnitSize != null && inClassUnits > r.maxUnitSize) return true;
      return false;
    });
    const tooWide = r.anySize ? outsideWindow.length > 0 : spread > SPREAD_LIMIT;
    const tooFew = n < MIN_SHOPS_FOR_COMPARISON;
    if (tooWide) wide.push(r.item.key);
    if (tooFew) thin.push(r.item.key);
    const verdict = tooWide
      ? (r.anySize ? `✗ ${outsideWindow.length} PICK(S) OUTSIDE THE SIZE WINDOW` : "✗ SIZES DISAGREE")
      : tooFew ? "· one shop only — no comparison"
      : r.anySize ? "✓ (per kg — pack sizes may differ)" : "✓";
    console.log(
      `  ${pad(r.item.label, 26)} ${lp(n, 6)} ${lp(min.toFixed(0), 8)} ${lp(max.toFixed(0), 8)} ` +
      `${lp(spread.toFixed(2) + "x", 7)}  ${verdict}`,
    );
  }

  // ── The detail for anything flagged, because a number without the rows under it is a claim
  //    nobody can check.
  const flagged = resolutions.filter((r) => wide.includes(r.item.key));
  if (flagged.length > 0) {
    console.log(`\n  WHAT THE FLAGGED CLASSES ACTUALLY RESOLVED TO`);
    for (const r of flagged) {
      console.log(`\n    ${r.item.label}  (class ${r.item.classSlug}, canonical ${r.classUnitSize} ${r.classUnit})`);
      for (const p of r.picks.sort((a, b) => a.packQuantity - b.packQuantity)) {
        console.log(`      ${pad(p.merchantSlug, 16)} ${lp(p.packQuantity.toFixed(0), 8)} ${pad(p.unit, 4)} ${lp(lei(p.priceBani), 9)} lei  ${p.productName.slice(0, 46)}`);
      }
    }
  }

  // ── Per shop.
  console.log(`\n\n  PER SHOP — a basket is only comparable with one that filled the same lines`);
  console.log(`  ${pad("SHOP", 18)} ${lp("filled", 7)} ${lp("missing", 8)} ${lp("total lei", 11)}  missing lines`);
  console.log(`  ${"-".repeat(92)}`);
  for (const s of now.shops) {
    const missingKeys = s.lines.filter((l) => l.priceBani == null).map((l) => l.item.key);
    console.log(
      `  ${pad(s.merchantSlug, 18)} ${lp(s.found, 7)} ${lp(s.missing, 8)} ${lp(lei(s.totalBani), 11)}  ` +
      `${missingKeys.slice(0, 6).join(", ")}${missingKeys.length > 6 ? ` +${missingKeys.length - 6}` : ""}`,
    );
  }

  console.log(`\n  cel mai mic preț per produs, de oriunde: ${lei(now.bestAnywhereBani)} lei`);
  console.log(`  (${now.bestAnywhereLines.filter((l) => l.priceBani != null).length}/${INDEX_BASKET_V2.length} linii — this is the shopping-around price, NOT any one shop's basket)`);

  console.log(`\n${"─".repeat(92)}`);
  console.log(`  SUMMARY`);
  console.log(`    lines whose packs disagree by more than ${SPREAD_LIMIT}x : ${wide.length}${wide.length ? "  → " + wide.join(", ") : ""}`);
  console.log(`    lines only one shop can fill                : ${thin.length}${thin.length ? "  → " + thin.join(", ") : ""}`);
  console.log(`    lines NO shop can fill                      : ${empty.length}${empty.length ? "  → " + empty.join(", ") : ""}`);
  if (now.missingClasses.length) {
    console.log(`    basket lines naming a class that does NOT EXIST: ${now.missingClasses.join(", ")}`);
  }
  const publishable = wide.length === 0 && empty.length === 0;
  console.log(`\n  ${publishable ? "✓ nothing blocks publication" : "✗ DO NOT PUBLISH until the flagged classes are fixed or the gaps are stated on the page"}\n`);

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
