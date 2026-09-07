// Grocery category assignment. Pure — no database.
//
// Every case here is a real name from the live catalog, and several are bugs the independent
// audit caught after the assigner had already written them. That is the point of the audit and
// the point of these tests: the assigner cannot grade itself, and once something has been caught
// it must not come back.

import { describe, it, expect } from "./run";
import { assignByName, assignByMerchantPath, AUTO_THRESHOLD, REVIEW_THRESHOLD } from "../src/lib/category/assign";
import { ALL_LEAVES, GROCERY_TREE, isCatchAll, isUnplaced, UNPLACED_DEPARTMENT_SLUG, UNPLACED_LEAF_SLUG } from "../src/lib/category/tree";
import { recoverPath } from "../src/lib/category/recover";

const leafOf = (name: string) => assignByName(name).leafSlug;
const deptOf = (name: string) => assignByName(name).department;
const bandOf = (name: string) => assignByName(name).band;

describe("category tree — structure", () => {
  it("every leaf slug is unique", () => {
    expect(new Set(ALL_LEAVES.map((l) => l.slug)).size).toBe(ALL_LEAVES.length);
  });
  it("no leaf slug collides with a department slug", () => {
    const depts = new Set(GROCERY_TREE.map((d) => d.slug));
    expect(ALL_LEAVES.some((l) => depts.has(l.slug))).toBeFalsy();
  });
  it("every leaf carries at least one match rule, EXCEPT the two rule-free kinds", () => {
    // A leaf with no rules can never be filled by name. Two kinds are meant to be like that:
    //   • an "Altele" catch-all — the merchant named a DEPARTMENT and nothing deeper;
    //   • the Neîncadrate leaf — nothing placed the product at all.
    // Both are reachable only from the assigner, never from a product name.
    const scorable = ALL_LEAVES.filter((l) => !isCatchAll(l.slug) && !isUnplaced(l.slug));
    expect(scorable.every((l) => l.match.length > 0)).toBeTruthy();
  });

  it("a catch-all has NO match rules, so no product name can score into it", () => {
    const catchAlls = ALL_LEAVES.filter((l) => isCatchAll(l.slug));
    // Every department EXCEPT the unplaced pile, which holds one leaf and no catch-all: a
    // remainder of a department with no shelves would be the same pile twice.
    expect(catchAlls.length).toBe(GROCERY_TREE.length - 1);
    expect(catchAlls.every((l) => l.match.length === 0)).toBeTruthy();
  });

  it("every real department has exactly one catch-all", () => {
    for (const d of GROCERY_TREE) {
      if (d.slug === UNPLACED_DEPARTMENT_SLUG) continue;
      expect(d.children.filter((c) => isCatchAll(c.slug)).length).toBe(1);
    }
  });

  it("the unplaced pile is one leaf, name-proof, and not a catch-all", () => {
    // It must not be confused with the twelve "-altele" leaves: those hold products whose
    // DEPARTMENT is known. Conflating them would make "how much is unclassified" unanswerable.
    const dept = GROCERY_TREE.find((d) => d.slug === UNPLACED_DEPARTMENT_SLUG);
    expect(dept?.children.length).toBe(1);
    expect(dept?.children[0].slug).toBe(UNPLACED_LEAF_SLUG);
    expect(dept?.children[0].match.length).toBe(0);
    expect(isCatchAll(UNPLACED_LEAF_SLUG)).toBeFalsy();
    expect(isUnplaced(UNPLACED_LEAF_SLUG)).toBeTruthy();
    expect(ALL_LEAVES.filter((l) => isUnplaced(l.slug)).length).toBe(1);
  });

  it("a merchant DEPARTMENT name lands in Altele, never on a shelf leaf", () => {
    // The bug this exists for: "lactate si oua" is Sezamo's department, and scored as a product
    // name it matched the word `oua` at 0.82 and filed 1,047 cheeses under EGGS.
    expect(assignByMerchantPath(["lactate si oua"]).leafSlug).toBe("lactate-oua-altele");
    expect(assignByMerchantPath(["produse congelate"]).leafSlug).toBe("congelate-altele");
    expect(assignByMerchantPath(["fructe si legume"]).leafSlug).toBe("fructe-legume-altele");
  });

  it("a DEEPER shelf level still wins over the department", () => {
    // Altele is the last resort, not the first: a real shelf name must still take precedence.
    expect(assignByMerchantPath(["lactate si oua", "oua de gaina"]).leafSlug).toBe("oua");
    expect(assignByMerchantPath(["produse congelate", "inghetata"]).leafSlug).toBe("inghetata");
  });

  it("an unrecognised path is still unmapped rather than guessed into Altele", () => {
    expect(assignByMerchantPath(["ready to eat cook"]).leafSlug).toBe(null);
    expect(assignByMerchantPath(["curatenie si intretinere"]).leafSlug).toBe(null);
  });
  it("every department has children", () => {
    expect(GROCERY_TREE.every((d) => d.children.length > 0)).toBeTruthy();
  });
});

describe("category assignment — what the product IS", () => {
  it("plain staples land where a shopper would look", () => {
    expect(deptOf("Lapte de consum integral Olympus, 3.7% grasime, 1 l")).toBe("lactate-oua");
    expect(leafOf("Paine alba feliata Vel Pitar, 500 g")).toBe("paine");
    expect(leafOf("Oua de gaina, Regalina, marime M, cod 2, 10 bucati")).toBe("oua");
    expect(leafOf("Ulei de floarea soarelui Bunica, 1 l")).toBe("ulei-otet");
  });

  it("the discriminating word is not required to be first", () => {
    // Romanian names lead with the brand or the form. Scoring only index 0 as strong put 40% of
    // the catalog into REVIEW, nearly all of it correct.
    expect(leafOf("Napolact Lapte 3.5% 1 L")).toBe("lapte");
    expect(leafOf("Pachet chefir Napolact, 3.3% grasime, 3 x 330 g")).toBe("iaurt-sana");
    expect(bandOf("Napolact Lapte 3.5% 1 L")).toBe("AUTO");
  });

  it("CREAM CHEESE IS NOT A CLEANING PRODUCT", () => {
    // Caught by audit:categories after the assigner had written it: a bare "crema" rule scored
    // 0.95 at index 0 and beat "branza" at index 2, filing Almette under Curățenie și igienă.
    for (const n of [
      "Crema de branza cu smantana Almette, 250 g",
      "Crema de branza tartinabila Hochland Creme Clasic, 200 g",
      "Crema de branza Philadelphia Original XL, 300 g",
    ]) {
      expect(deptOf(n)).toBe("lactate-oua");
    }
  });

  it("milk chocolate and body lotion are not milk", () => {
    expect(deptOf("Ciocolata cu lapte Milka, 100 g")).toBe("dulciuri-snacks");
    expect(deptOf("Lapte de corp Lactovit, 400ml") === "lactate-oua").toBeFalsy();
  });

  it("a spread containing butter is not butter", () => {
    expect(leafOf("Biscuiti cu unt Leibniz, 200 g")).toBe("biscuiti-napolitane");
  });

  it("beer has a home — 492 products had none", () => {
    expect(deptOf("Bere blonda Neumarkt, 0.5 l")).toBe("bauturi");
    expect(leafOf("Bere blonda Albacher, 0.5 l")).toBe("bere-cidru");
  });

  it("Romanian inflection is handled by prefix matching", () => {
    expect(leafOf("Chifle Kaiser 20 x 65 g")).toBe("paine");
    expect(leafOf("Rodii (Punica granatum)")).toBe("fructe-proaspete");
  });

  it("short words stay EXACT so 'unt' never matches 'munte'", () => {
    expect(deptOf("MUNTE LACT Creminos 200 g") === "lactate-oua" && leafOf("MUNTE LACT Creminos 200 g") === "unt-margarina").toBeFalsy();
  });

  it("an avoid rule beats any match in the same leaf", () => {
    expect(leafOf("Detergent de vase Fairy Rodie, 1.35 l")).toBe("detergent-vase");
  });
});

describe("category assignment — the three bands", () => {
  it("a confident hit is AUTO and a miss is NONE", () => {
    expect(bandOf("Paine alba feliata Vel Pitar, 500 g")).toBe("AUTO");
    expect(bandOf("METRO Chef Valeriana 200 g")).toBe("NONE");
  });

  it("nothing is written below the AUTO threshold", () => {
    const a = assignByName("METRO Chef Valeriana 200 g");
    expect(a.score < AUTO_THRESHOLD).toBeTruthy();
    expect(a.band === "AUTO").toBeFalsy();
  });

  it("the thresholds are ordered", () => {
    expect(REVIEW_THRESHOLD < AUTO_THRESHOLD).toBeTruthy();
  });

  it("an empty name is never assigned", () => {
    expect(assignByName("").leafSlug).toBe(null);
    expect(assignByName("   ").band).toBe("NONE");
  });
});

describe("merchant paths beat inference", () => {
  it("maps a merchant's own path onto our tree", () => {
    const a = assignByMerchantPath(["Lactate si oua", "Oua", "Oua de gaina"]);
    expect(a.leafSlug).toBe("oua");
    expect(a.band).toBe("AUTO");
  });

  it("prefers the DEEPEST level, which is the most specific", () => {
    expect(assignByMerchantPath(["Bacanie", "Paste fainoase"]).leafSlug).toBe("paste-fainoase");
  });

  it("reports an unmapped path instead of guessing", () => {
    const a = assignByMerchantPath(["Zzz", "Qqq"]);
    expect(a.leafSlug).toBe(null);
    expect(a.reason.includes("unmapped")).toBeTruthy();
  });
});

describe("recovering a merchant path from stored data", () => {
  it("reads Auchan's VTEX categories out of a TRUNCATED blob", () => {
    // The blob is capped at 4096 bytes and never parses as JSON; the array is read textually.
    const blob = '{"productId":"1","categories":["/Lactate si oua/Oua/Oua de gaina/","/Lactate si oua/Oua/","/Lactate si oua/"],"link":"htt';
    const p = recoverPath({ merchantSlug: "auchan", rawSourceBlob: blob, productUrl: null, url: null, categoryPath: null });
    expect(p!.levels).toEqual(["Lactate si oua", "Oua", "Oua de gaina"]);
    expect(p!.source).toBe("auchan-blob");
  });

  it("reads Mega Image's category out of the product URL path", () => {
    const p = recoverPath({
      merchantSlug: "mega-image", rawSourceBlob: null,
      productUrl: "/Lactate-si-oua/Lapte-proaspat/Lapte-proaspat-semidegresat/Lapte-1-5-grasime-1L/p/39620",
      url: null, categoryPath: null,
    });
    expect(p!.levels).toEqual(["Lactate si oua", "Lapte proaspat", "Lapte proaspat semidegresat"]);
  });

  it("reads Freshful's breadcrumbs", () => {
    const blob = JSON.stringify({ breadcrumbs: [{ name: "Lactate & ouă" }, { name: "Iaurt, desert și sana" }, { name: "Iaurt simplu" }] });
    const p = recoverPath({ merchantSlug: "freshful", rawSourceBlob: blob, productUrl: null, url: null, categoryPath: null });
    expect(p!.levels.length).toBe(3);
    expect(p!.levels[2]).toBe("Iaurt simplu");
  });

  it("returns null for a merchant that publishes nothing, rather than inventing one", () => {
    expect(recoverPath({ merchantSlug: "metro", rawSourceBlob: '{"meta":{},"pr":{}}', productUrl: "/shop/pv/BTY-X7915380032", url: null, categoryPath: null })).toBe(null);
    expect(recoverPath({ merchantSlug: "sezamo", rawSourceBlob: null, productUrl: "/napolact-lapte-1-5-pet", url: null, categoryPath: null })).toBe(null);
  });

  it("survives malformed input without throwing", () => {
    expect(recoverPath({ merchantSlug: "freshful", rawSourceBlob: "{not json", productUrl: null, url: null, categoryPath: null })).toBe(null);
    expect(recoverPath({ merchantSlug: "auchan", rawSourceBlob: "", productUrl: null, url: null, categoryPath: null })).toBe(null);
  });
});

describe("a merchant path is recovered from ANY merchant that supplies one", () => {
  // The old `default: return null` meant a scraper could start persisting a perfectly good
  // category and recovery would silently discard it, because nobody remembered to add a case.
  // Same shape as toPriceSource returning SHELF from its default branch for 2,217 offers: a
  // default that swallows a valid value and reports nothing.
  const at = (merchantSlug: string, categoryPath: string | null) =>
    recoverPath({ merchantSlug, rawSourceBlob: null, productUrl: null, url: null, categoryPath });

  it("recovers a path from a merchant with no case of its own", () => {
    const r = at("sezamo", "lactate-si-oua");
    expect(r?.source).toBe("merchant-path");
    expect(r?.levels.join("|")).toBe("lactate si oua");
  });

  it("splits a multi-level path deepest-last, the order the mapper reads", () => {
    const r = at("carrefour", "bacanie-carrefour/alimente/cafea/cafea-macinata");
    expect(r?.levels.length).toBe(4);
    expect(r?.levels[3]).toBe("cafea macinata");
  });

  it("still returns null when the merchant supplies nothing", () => {
    expect(at("metro", null)).toBe(null);
    expect(at("metro", "   ")).toBe(null);
  });

  it("does not hijack a merchant that has its own richer source", () => {
    // dcneu keeps its own case, so its label stays distinguishable in the audit.
    expect(at("dcneu", "Scule / Bormasini")?.source).toBe("dcneu-path");
  });

  it("a recovered grocery path reaches a leaf", () => {
    const r = at("sezamo", "lactate-si-oua");
    const a = assignByMerchantPath(r!.levels);
    expect(a.leafSlug !== null).toBeTruthy();
    expect(a.band).toBe("AUTO");
  });
});
