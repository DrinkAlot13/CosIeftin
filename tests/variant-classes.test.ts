// The Pepsi page. Catalog product 1905, four merchants, four different products.
//
// "Bautura carbogazoasa cu gust de zmeura Pepsi, doza, 6 x 0.33 l" carried offers from
// Auchan, Freshful, Mega Image and Carrefour. A user landed on a page saying Mega Image sells
// raspberry Pepsi six-packs for 10,49 when what Mega sells is a 2 L cola bottle.
//
// Six sessions of fixes made that page steadily more accurate about the wrong thing — the
// Auchan price corrected to 11,69, the badge moved to the right row, the merchant count made
// honest — and none of it helped, because the page should not have existed in that shape.
//
// WHY NOTHING CAUGHT IT:
//   • the size gate passed: 6 × 0.33 = 1.98 L vs 2 L is 1%, and the tolerance is 6%
//   • mutual distinction fired but returned REVIEW, not REJECT, because the score was high
//   • variantTokens had NO FLAVOUR WORDS AT ALL — zmeura and cola were ordinary tokens
import { describe, it, expect } from "./run";
import { decide, prep } from "../src/lib/scrape-util";
import { variantConflict, variantTokensOf } from "../src/lib/variant-classes";

const CAT = "Bautura carbogazoasa cu gust de zmeura Pepsi, doza, 6 x 0.33 l";
const SIX = { unit: "l", unitSize: 1.98 };
const TWO_L = { unit: "l", unitSize: 2 };

const judge = (store: string, size = TWO_L) =>
  decide(prep(CAT, null, null), SIX, prep(store, null, null), size, "grocery");

describe("the Pepsi page — every offer on it was a different product", () => {
  it("rejects the Mega Image cola bottle", () => {
    const d = judge("Bautura carbogazoasa Pepsi Cola, 2 l");
    expect(d.ok).toBe(false);
    expect(d.band).toBe("REJECT");
    expect(d.reason).toBe("variant-flavour");
  });

  it("rejects the Freshful cola PET", () => {
    expect(judge("Bautura carbogazoasa Pepsi Cola PET 2 l").band).toBe("REJECT");
  });

  it("rejects the Carrefour zero-sugar bottle", () => {
    expect(judge("Bautura carbogazoasa Pepsi Zero Zahar, 2 l").band).toBe("REJECT");
  });

  it("rejects the AUCHAN offer too — it is a 2 l bottle, not a six-pack", () => {
    // The one nobody expected. Auchan's own recorded name is "…zmeura Pepsi, 2 l": right
    // flavour, wrong pack. Correcting its price to 11,69 made the page more precisely wrong.
    const d = judge("Bautura carbogazoasa cu gust de zmeura Pepsi, 2 l");
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("pack-shape");
  });

  it("still accepts a GENUINE zmeura six-pack", () => {
    const d = judge("Bautura carbogazoasa cu gust de zmeura Pepsi doza 6 x 0.33 l", SIX);
    expect(d.ok).toBe(true);
    expect(d.band).toBe("AUTO_MATCH");
  });
});

describe("variant classes — disagreement blocks, silence does not", () => {
  it("a flavour difference is a hard block regardless of score", () => {
    // These two names overlap almost completely. The score should not get a vote.
    const c = variantConflict("Iaurt cu capsuni Danone 125 g", "Iaurt cu piersici Danone 125 g");
    expect(c?.klass).toBe("flavour");
  });

  it("SILENCE is not disagreement — one side naming a format is a fuller description", () => {
    // "doza" vs nothing must not block: the same rule the matcher applies to dosage.
    expect(variantConflict("Bere Ursus doza 0.5 l", "Bere Ursus 0.5 l")).toBe(null);
  });

  it("agreement inside a class passes even when other words differ", () => {
    expect(variantConflict("Suc de portocale Cappy 1 l", "Cappy portocale suc natural 1 l")).toBe(null);
  });

  it("blocks a fat-content difference", () => {
    expect(variantConflict("Lapte Zuzu 1.5% 1 l", "Lapte Zuzu 3.5% 1 l")?.klass).toBe("fat");
  });

  it("blocks a sweetener difference, including the two-word form", () => {
    expect(variantConflict("Coca-Cola Zero 2 l", "Coca-Cola Original 2 l")?.klass).toBe("qualifier");
    expect(variantConflict("Pepsi fara zahar 2 l", "Pepsi clasic 2 l")?.klass).toBe("qualifier");
  });

  it("blocks a container difference", () => {
    expect(variantConflict("Bere Timisoreana doza 0.5 l", "Bere Timisoreana sticla 0.5 l")?.klass).toBe("format");
  });

  it("does NOT cross classes — a flavour word and a format word are not a contradiction", () => {
    // Merging the lists into one would start rejecting real matches. "zmeura" answers a
    // different question from "doza".
    expect(variantConflict("Pepsi zmeura 2 l", "Pepsi doza 2 l")).toBe(null);
  });

  it("classifies the tokens it finds", () => {
    const t = variantTokensOf("Bautura carbogazoasa cu gust de zmeura Pepsi, doza, 6 x 0.33 l");
    expect([...t.get("flavour")!]).toEqual(["zmeura"]);
    expect([...t.get("format")!]).toEqual(["doza"]);
  });
});

describe("pack shape — a six-pack is not a bottle", () => {
  it("blocks 6 x 0.33 against a single 2 l, though the totals differ by 1%", () => {
    // 6 × 0.33 = 1.98 against 2.00 is inside the 6% size tolerance. Two unrelated products
    // agreed on volume by accident, and the size gate had no way to see it.
    const d = judge("Bautura carbogazoasa cu gust de zmeura Pepsi, 2 l");
    expect(d.reason).toBe("pack-shape");
  });

  it("does NOT block two singles", () => {
    // Both default to packCount 1: nothing is being asserted, so nothing contradicts.
    const d = decide(
      prep("Lapte Zuzu 1 l", null, null), { unit: "l", unitSize: 1 },
      prep("Lapte Zuzu integral 1 l", null, null), { unit: "l", unitSize: 1 },
      "grocery",
    );
    expect(d.reason === "pack-shape").toBe(false);
  });

  it("does not block two multipacks of the same shape", () => {
    const d = decide(
      prep("Bere Ursus 6 x 0.5 l", null, null), { unit: "l", unitSize: 3 },
      prep("Bere Ursus doza 6x500ml", null, null), { unit: "l", unitSize: 3 },
      "grocery",
    );
    expect(d.reason === "pack-shape").toBe(false);
  });
});
