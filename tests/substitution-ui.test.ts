// The substitution engine's new surfaces: class membership, class-level picking, and the
// Romanian wording. All pure — no database.
//
// These exist because every one of them is a place where a wrong answer is INVISIBLE. A bad
// class assignment shows up as a plausible substitute the shopper only discovers at the till; a
// mis-ordered pick shows up as "cel mai ieftin" next to something that is not; and a wording bug
// shows up as a confident sentence about a saving that is actually a surcharge.

import { describe, it, expect } from "./run";
import { membershipOk, rulesFromAttributes } from "../src/lib/substitution/class-rules";
import { explainPick, explainResolution } from "../src/lib/substitution/explain";
import { anonymousContext, pickForClass } from "../src/lib/substitution/pick";
import type { OfferLike, Resolution } from "../src/lib/substitution/resolve";
import { RECIPES } from "../src/data/recipes";

// ── class membership ────────────────────────────────────────────────────────────
describe("equivalence class membership", () => {
  const telemea = { require: ["telemea"], exclude: ["burduf|topita"] };

  it("admits the thing itself", () => {
    expect(membershipOk("Telemea de vaca Olympus, 350 g", telemea).ok).toBeTruthy();
  });

  it("REFUSES a different cheese that shares the head noun", () => {
    // The proposer's first run wanted to file this as telemea.
    expect(membershipOk("Branza de burduf Covalact, 300 g", telemea).ok).toBeFalsy();
  });

  it("refuses anything missing the discriminator", () => {
    expect(membershipOk("Cascaval Delaco, 350 g", telemea).ok).toBeFalsy();
  });

  it("matches exclusions on WORD PREFIX, because Romanian inflects", () => {
    // "congelat" has to catch "congelati" and "congelate", or frozen potatoes enter the
    // fresh-potato class — which is exactly what happened.
    const cartofi = { require: ["cartofi"], exclude: ["congelat|prajit"] };
    expect(membershipOk("Cartofi albi, 5 kg", cartofi).ok).toBeTruthy();
    expect(membershipOk("Gradena Cartofi congelati 1 kg", cartofi).ok).toBeFalsy();
    expect(membershipOk("Edenia Cartofi preprajiti 1 kg", { require: ["cartofi"], exclude: ["preprajit"] }).ok).toBeFalsy();
  });

  it("accepts either spelling of a fat percentage", () => {
    const lapte = { require: ["integral|3 5"] };
    expect(membershipOk("Lapte UHT integral LaDorna, 3.5% grasime, 1 l", lapte).ok).toBeTruthy();
    expect(membershipOk("Lapte de consum 3,5% ZuZu 1 l", lapte).ok).toBeTruthy();
    expect(membershipOk("Lapte semidegresat 1,5% 1 l", lapte).ok).toBeFalsy();
  });

  it("folds Romanian diacritics on both sides", () => {
    expect(membershipOk("Hârtie igienică Zewa, 8 role", { require: ["igienica"] }).ok).toBeTruthy();
  });

  it("treats absent or malformed attributes as no rules, never as a blanket refusal", () => {
    // Asserted through BEHAVIOUR rather than object shape: what matters is that a class with
    // no rules admits everything, not which keys the parser happens to leave undefined.
    expect(membershipOk("anything at all", rulesFromAttributes(null)).ok).toBeTruthy();
    expect(membershipOk("anything at all", rulesFromAttributes("{not json")).ok).toBeTruthy();
    expect(membershipOk("anything at all", rulesFromAttributes('{"tip":"x"}')).ok).toBeTruthy();
    expect(membershipOk("anything at all", {}).ok).toBeTruthy();
  });
});

// ── picking for a need ──────────────────────────────────────────────────────────
const offer = (id: number, productId: number, merchantId: number, priceBani: number, opts: Partial<OfferLike["product"]> & { pack?: number; avail?: string } = {}): OfferLike => ({
  id, productId, merchantId, priceBani,
  packQuantity: opts.pack ?? 1000,
  unit: "G",
  availability: opts.avail ?? "in stock",
  isStale: false, isExpired: false, hasUnresolvedAnomaly: false, requiresLoyaltyCard: false,
  promoValidTo: null,
  product: {
    id: productId, name: opts.name ?? `P${productId}`, brand: opts.brand ?? null,
    equivalenceClassId: opts.equivalenceClassId ?? 7,
    isPrivateLabel: opts.isPrivateLabel ?? false,
  },
});

describe("pickForClass — the recipe's choice", () => {
  const cheap = offer(1, 10, 1, 500, { name: "Ieftin" });
  const dear = offer(2, 11, 1, 900, { name: "Scump" });
  const own = offer(3, 12, 1, 700, { name: "Marca proprie", isPrivateLabel: true });
  const all = [cheap, dear, own];

  it("takes the cheapest per unit when nothing else is known", () => {
    const p = pickForClass(7, anonymousContext(), all);
    expect(p!.offer.product.name).toBe("Ieftin");
    expect(p!.basis).toBe("CHEAPEST");
  });

  it("an EXPLICIT favourite beats a cheaper stranger", () => {
    const ctx = anonymousContext();
    ctx.favouriteProductIds.add(11);
    const p = pickForClass(7, ctx, all);
    expect(p!.offer.product.name).toBe("Scump");
    expect(p!.basis).toBe("FAVOURITE");
  });

  it("an EXPLICIT favourite beats an INFERRED one", () => {
    const ctx = anonymousContext();
    ctx.favouriteProductIds.add(11);
    ctx.inferredFavouriteProductIds.add(12);
    expect(pickForClass(7, ctx, all)!.basis).toBe("FAVOURITE");
  });

  it("an INFERRED favourite beats price but loses to explicit", () => {
    const ctx = anonymousContext();
    ctx.inferredFavouriteProductIds.add(11);
    const p = pickForClass(7, ctx, all);
    expect(p!.offer.product.name).toBe("Scump");
    expect(p!.basis).toBe("INFERRED");
  });

  it("private label wins only when the shopper opted in", () => {
    expect(pickForClass(7, anonymousContext(false), all)!.basis).toBe("CHEAPEST");
    expect(pickForClass(7, anonymousContext(true), all)!.basis).toBe("PRIVATE_LABEL");
  });

  it("never returns something out of stock", () => {
    const gone = offer(4, 13, 1, 100, { name: "Epuizat", avail: "out of stock" });
    const p = pickForClass(7, anonymousContext(), [gone, dear]);
    expect(p!.offer.product.name).toBe("Scump");
  });

  it("returns null for an empty class rather than a near-miss from another one", () => {
    // Two of our thirty classes are genuinely empty. A recipe needing one must say so.
    expect(pickForClass(999, anonymousContext(), all)).toBe(null);
  });

  it("restricts to one merchant when asked", () => {
    const elsewhere = offer(5, 14, 2, 100, { name: "Alt magazin" });
    const p = pickForClass(7, anonymousContext(), [...all, elsewhere], { merchantId: 2 });
    expect(p!.offer.product.name).toBe("Alt magazin");
    expect(p!.basis).toBe("ONLY_OPTION");
  });
});

// ── the Romanian wording ────────────────────────────────────────────────────────
const resolution = (over: Partial<Resolution> & { reason: Resolution["reason"] }): Resolution => ({
  status: "SUBSTITUTED", offer: null, quantityPlan: [], totalBani: 0, alternatives: [], ...over,
});

describe("explainResolution — the sentence the shopper reads", () => {
  it("names the shop, both products, and the saving", () => {
    const e = explainResolution(resolution({
      reason: {
        code: "SUBSTITUTED_EQUIVALENT",
        requestedProductName: "Lapte Zuzu",
        chosenProductName: "Lapte Olympus",
        savingPerUnitBani: 230,
      },
    }), "Mega Image", "l");
    expect(e.headline).toBe("Nu am găsit Lapte Zuzu la Mega Image. Am ales Lapte Olympus — cu 2,30 lei/L mai ieftin.");
    expect(e.tone).toBe("good");
  });

  it("says MORE EXPENSIVE when it is, rather than hiding the sign", () => {
    const e = explainResolution(resolution({
      reason: { code: "SUBSTITUTED_EQUIVALENT", requestedProductName: "A", chosenProductName: "B", savingPerUnitBani: -150 },
    }), "Auchan", "kg");
    expect(e.headline).toContain("cu 1,50 lei/kg mai scump");
    expect(e.tone).toBe("warn");
  });

  it("a pinned EXACT line explains why nothing was substituted", () => {
    const e = explainResolution(resolution({
      status: "UNAVAILABLE",
      reason: { code: "EXACT_ONLY_NOT_STOCKED", requestedProductName: "Lapte Zuzu" },
    }), "Metro", "l");
    expect(e.headline).toContain("nu este la Metro");
    expect(e.detail).toContain("fixat");
  });

  it("does not claim a saving when there is no comparison", () => {
    const e = explainResolution(resolution({
      reason: { code: "SUBSTITUTED_EQUIVALENT", requestedProductName: "A", chosenProductName: "B" },
    }), "Kaufland", "buc");
    expect(e.headline.includes("mai ieftin")).toBeFalsy();
    expect(e.headline.includes("mai scump")).toBeFalsy();
  });

  it("unit words are the ones a shopper compares in", () => {
    for (const [unit, word] of [["kg", "kg"], ["g", "kg"], ["l", "L"], ["ml", "L"], ["buc", "buc"]] as const) {
      const e = explainResolution(resolution({
        reason: { code: "SUBSTITUTED_EQUIVALENT", requestedProductName: "A", chosenProductName: "B", savingPerUnitBani: 100 },
      }), "S", unit);
      expect(e.headline).toContain(`/${word} `);
    }
  });
});

describe("explainPick — why this product for this need", () => {
  it("gives the resolver's own reason, with the unit price", () => {
    expect(explainPick("FAVOURITE", 1250, "kg")).toBe("pentru că e la favorite (12,50 lei/kg)");
    expect(explainPick("INFERRED", 800, "l")).toBe("pentru că îl cumperi des (8,00 lei/L)");
    expect(explainPick("CHEAPEST", 199, "buc")).toBe("cel mai ieftin pe unitate (1,99 lei/buc)");
  });
});

// ── the recipes themselves ──────────────────────────────────────────────────────
describe("recipes are needs, not products", () => {
  it("there are 15", () => expect(RECIPES.length).toBe(15));

  it("every ingredient names an equivalence class and a quantity", () => {
    for (const r of RECIPES) {
      expect(r.ingredients.length > 0).toBeTruthy();
      for (const i of r.ingredients) {
        expect(i.classSlug.length > 0).toBeTruthy();
        expect(i.qty > 0).toBeTruthy();
        expect(i.label.length > 0).toBeTruthy();
      }
    }
  });

  it("recipe slugs are unique", () => {
    expect(new Set(RECIPES.map((r) => r.slug)).size).toBe(RECIPES.length);
  });

  it("no recipe names the same class twice — that would double the line", () => {
    for (const r of RECIPES) {
      expect(new Set(r.ingredients.map((i) => i.classSlug)).size).toBe(r.ingredients.length);
    }
  });
});
