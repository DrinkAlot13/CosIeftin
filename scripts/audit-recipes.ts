// ── SCOPE: DATA INTEGRITY ─────────────────────────────────────────────────────
// Do the 15 seeded recipes actually resolve against the live catalog, end to end?
//
// A recipe names NEEDS (equivalence classes) and the engine picks products. That indirection is
// what makes substitution possible, and it is also what makes a recipe able to fail silently: a
// class with nothing in it produces a line the shopper never sees, and the card cheerfully says
// "6 produse adăugate" having added five.
//
// So this runs every recipe twice:
//   1. ACROSS ALL SHOPS — can the need be met anywhere? A "no" here is a catalog gap.
//   2. AT ONE SHOP      — the best single shop for that recipe, where substitution actually
//                         happens. This is what the shopper experiences on a real trip.
//
// A recipe with more than a third of its ingredients unavailable is reported as a BAD RECIPE FOR
// OUR CATALOG. That is a judgement about our data, not about the cooking: "pui cu cartofi" is a
// fine recipe and we simply cannot fill it, and saying so is more useful than hiding it.
//
// Read-only. Run: npm run audit:recipes

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";
import { RECIPES } from "../src/data/recipes";
import { explainPick, explainResolution } from "../src/lib/substitution/explain";
import { loadMerchants, loadOffers, loadUserContext } from "../src/lib/substitution/load";
import { pickForClass } from "../src/lib/substitution/pick";
import { resolveLine } from "../src/lib/substitution/resolve";

const prisma = new PrismaClient();

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);
const lei = (b: number) => (b / 100).toFixed(2);

/** More than a third unavailable and the recipe is not one our catalog can serve. */
const BAD_RECIPE_THRESHOLD = 1 / 3;

async function main(): Promise<void> {
  const classes = await prisma.equivalenceClass.findMany({
    select: { id: true, slug: true, label: true, unit: true, unitSize: true },
  });
  const bySlug = new Map(classes.map((c) => [c.slug, c]));
  const ctx = await loadUserContext(null);
  const merchants = await loadMerchants();
  const merchantName = new Map(merchants.map((m) => [m.id, m.name]));

  const allClassIds = classes.map((c) => c.id);
  const offers = await loadOffers({ classIds: allClassIds, take: 20000 });

  console.log(`\n════ RECIPES — ${RECIPES.length} recipes against the live catalog ═══════════════════`);
  console.log(`  ${offers.length} offers loaded across ${classes.length} equivalence classes.\n`);

  const report: unknown[] = [];
  const bad: string[] = [];
  let unknownClass = 0;

  for (const recipe of RECIPES) {
    // ── 1. Can each need be met ANYWHERE?
    const lines = recipe.ingredients.map((ing) => {
      const cls = bySlug.get(ing.classSlug);
      if (!cls) { unknownClass++; return { ing, cls: null, pick: null }; }
      const pick = pickForClass(cls.id, ctx, offers, { unitsNeeded: cls.unitSize * ing.qty });
      return { ing, cls, pick };
    });
    const availableEverywhere = lines.filter((l) => l.pick != null);
    const missing = lines.filter((l) => l.pick == null);

    // ── 2. Which single shop serves this recipe best, and what happens there?
    const shopScores = merchants.map((m) => {
      let found = 0;
      let total = 0;
      for (const l of lines) {
        if (!l.cls) continue;
        const p = pickForClass(l.cls.id, ctx, offers, { merchantId: m.id, unitsNeeded: l.cls.unitSize * l.ing.qty });
        if (p) { found++; total += p.offer.priceBani * l.ing.qty; }
      }
      return { m, found, total };
    }).sort((a, b) => b.found - a.found || a.total - b.total);
    const bestShop = shopScores[0];

    // At that shop, resolve each line THROUGH the real resolver so substitutions are named the
    // way the UI names them — same code path, same wording.
    const atShop = lines.map((l) => {
      if (!l.cls || !l.pick) return { label: l.ing.label, status: "UNAVAILABLE" as const, note: "nu există în catalog" };
      // The line's "requested" product is what the shopper would have got globally; at this
      // shop the resolver may have to substitute within the class.
      const line = { productId: l.pick.offer.product.id, qty: l.ing.qty, substitutionMode: "EQUIVALENT" as const };
      const r = resolveLine(line, bestShop.m.id, ctx, offers);
      const e = explainResolution(r, bestShop.m.name, l.cls.unit);
      return {
        label: l.ing.label,
        status: r.status,
        requested: l.pick.offer.product.name,
        chosen: r.offer?.product.name ?? null,
        totalBani: r.totalBani,
        note: e.headline,
      };
    });

    const substituted = atShop.filter((a) => a.status === "SUBSTITUTED").length;
    const unavailableAtShop = atShop.filter((a) => a.status === "UNAVAILABLE").length;
    const share = missing.length / lines.length;
    const isBad = share > BAD_RECIPE_THRESHOLD;
    if (isBad) bad.push(`${recipe.name} — ${missing.length}/${lines.length} indisponibile`);

    console.log(`${isBad ? "✗" : " "} ${recipe.emoji} ${pad(recipe.name, 30)} ` +
      `${lp(availableEverywhere.length, 2)}/${lines.length} disponibile · ` +
      `cel mai bun magazin: ${pad(bestShop?.m.name ?? "—", 12)} ${lp(bestShop?.found ?? 0, 2)}/${lines.length}` +
      `${substituted ? ` · ${substituted} înlocuite` : ""}`);

    for (const a of atShop) {
      const mark = a.status === "EXACT" ? "  ✓" : a.status === "SUBSTITUTED" ? "  ↻" : "  ✗";
      const price = "totalBani" in a && a.totalBani ? ` ${lp(lei(a.totalBani), 8)} lei` : "";
      console.log(`${mark} ${pad(a.label, 26)}${price}  ${a.note}`);
    }
    if (missing.length) {
      console.log(`     LIPSESC PESTE TOT: ${missing.map((m) => m.ing.label).join(", ")}`);
    }
    console.log();

    report.push({
      slug: recipe.slug, name: recipe.name,
      ingredients: lines.length,
      availableAnywhere: availableEverywhere.length,
      missingEverywhere: missing.map((m) => m.ing.label),
      bestShop: bestShop ? { name: bestShop.m.name, found: bestShop.found, totalBani: bestShop.total } : null,
      substitutedAtBestShop: substituted,
      unavailableAtBestShop: unavailableAtShop,
      badForCatalog: isBad,
      lines: atShop,
    });
  }

  console.log("─".repeat(92));
  console.log(`\n  BAD RECIPES FOR OUR CATALOG (more than a third of ingredients unavailable):`);
  if (bad.length === 0) console.log("    none — every recipe can be filled.");
  else for (const b of bad) console.log(`    ✗ ${b}`);

  if (unknownClass > 0) {
    console.log(`\n  ✗ ${unknownClass} ingredient(s) name an equivalence class that does not exist.`);
  }

  const totalIng = RECIPES.reduce((s, r) => s + r.ingredients.length, 0);
  const totalAvail = (report as { availableAnywhere: number }[]).reduce((s, r) => s + r.availableAnywhere, 0);
  console.log(`\n  ${totalAvail}/${totalIng} ingredients resolve somewhere (${((totalAvail / totalIng) * 100).toFixed(0)}%).`);
  console.log(`  ${bad.length}/${RECIPES.length} recipes are badly served by our catalog.\n`);

  emitJson({ recipes: report, bad, unknownClass, totalIngredients: totalIng, resolvedIngredients: totalAvail });

  await prisma.$disconnect();
  // A recipe naming a class that does not exist is a code error and fails the audit. A recipe
  // our CATALOG cannot fill is a finding, not a failure — the catalog changes nightly.
  if (unknownClass > 0) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
