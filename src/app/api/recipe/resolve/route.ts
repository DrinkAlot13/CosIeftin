// Resolve a recipe's NEEDS into concrete products, for this shopper.
//
// POST { slug } -> { lines: [{ classSlug, label, chosen?, why, alternatives, unavailable }] }
//
// The recipe names equivalence classes. This turns each one into the product THIS shopper should
// get — explicit favourite, then inferred favourite, then private label if they opted in, then
// cheapest per unit — and returns the reason in Romanian so the card can show it before anything
// lands in the cart.
//
// A class with nothing buyable comes back `unavailable: true` and is NOT replaced by a near-miss
// from another class. Two of our thirty classes are genuinely empty, and a recipe that needs one
// must say so.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { RECIPES } from "@/data/recipes";
import { explainPick } from "@/lib/substitution/explain";
import { loadOffers, loadUserContext } from "@/lib/substitution/load";
import { pickForClass } from "@/lib/substitution/pick";
import { guard } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = guard("write", req);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { slug?: unknown; preferPrivateLabel?: unknown } | null;
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const recipe = RECIPES.find((r) => r.slug === slug);
  if (!recipe) return NextResponse.json({ error: "Rețetă necunoscută." }, { status: 404 });

  const classSlugs = [...new Set(recipe.ingredients.map((i) => i.classSlug))];
  const classes = await prisma.equivalenceClass.findMany({
    where: { slug: { in: classSlugs } },
    select: { id: true, slug: true, label: true, unit: true, unitSize: true },
  });
  const bySlug = new Map(classes.map((c) => [c.slug, c]));

  const user = await getCurrentUser();
  const [ctx, offers] = await Promise.all([
    loadUserContext(user?.id ?? null, { preferPrivateLabel: body?.preferPrivateLabel === true }),
    loadOffers({ classIds: classes.map((c) => c.id) }),
  ]);

  const productIds = [...new Set(offers.map((o) => o.product.id))];
  const slugRows = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, slug: true },
  });
  const slugById = new Map(slugRows.map((p) => [p.id, p.slug]));

  const lines = recipe.ingredients.map((ing) => {
    const cls = bySlug.get(ing.classSlug);
    if (!cls) {
      return {
        classSlug: ing.classSlug, label: ing.label, qty: ing.qty,
        unavailable: true, why: "Nu cunoaștem acest tip de produs.", chosen: null, alternatives: 0,
      };
    }
    const pick = pickForClass(cls.id, ctx, offers, { unitsNeeded: cls.unitSize * ing.qty });
    if (!pick) {
      return {
        classSlug: ing.classSlug, label: ing.label, qty: ing.qty,
        unavailable: true,
        why: `Nu avem ${cls.label.toLowerCase()} în stoc la niciun magazin urmărit.`,
        chosen: null, alternatives: 0,
      };
    }
    return {
      classSlug: ing.classSlug,
      label: ing.label,
      qty: ing.qty,
      unavailable: false,
      chosen: {
        productId: pick.offer.product.id,
        slug: slugById.get(pick.offer.product.id) ?? "",
        name: pick.offer.product.name,
        brand: pick.offer.product.brand,
        priceBani: pick.offer.priceBani,
      },
      why: explainPick(pick.basis, pick.unitPriceBani, cls.unit),
      alternatives: pick.alternatives,
    };
  });

  return NextResponse.json({
    recipe: { slug: recipe.slug, name: recipe.name },
    signedIn: Boolean(user),
    lines,
    resolved: lines.filter((l) => !l.unavailable).length,
    total: lines.length,
  });
}
