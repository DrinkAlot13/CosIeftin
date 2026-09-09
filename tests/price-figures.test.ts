// One tile, several prices, and which one we kept — the classifier behind `probe:price-figures`.
//
// The probe reports ZERO findings across 11 merchants. That is only worth anything if it can be
// shown to report one, so every case below is a REAL string from a REAL page, and the first four
// are the four bugs this project actually shipped:
//
//   penny      "1 BC 0,45 LEI"        we published 0,45 for a pack costing 17,99
//   selgros    "per kg 34 99"         a per-kilo price with no currency symbol anywhere
//   penny      "preț cu PENNY card"   the loyalty price stored as the shelf price
//   dcneu      "Fără TVA: 20,41 Lei"  the without-VAT figure read as the price
//
// The rest are the FALSE positives the first version produced — 18 of 30 pages, every one wrong.
// They are here because the fix (a label attaches only if no other number sits between) is
// invisible from the passing cases alone, and a later "simplification" back to a character
// window would look harmless and silently restore all eighteen.
import { describe, it, expect } from "./run";
import { classifyOurFigure } from "../scripts/probe-price-figures";

const lei = (n: number) => Math.round(n * 100);

describe("price figures — the label must attach to OUR number", () => {
  // ── THE FOUR REAL DEFECTS ────────────────────────────────────────────────────────────────
  it("catches a per-unit price stored as the pack price (penny, the 0,45 bug)", () => {
    const text = "preț fără PENNY card 22,99 LEI 1 BC 0,58 LEI preț cu PENNY card 17,99 LEI 1 BC 0,45 LEI";
    expect(classifyOurFigure(text, lei(0.45), false).outcome).toBe("MATCHED_PER_UNIT");
  });

  it("catches a per-kilo price with no currency symbol (selgros)", () => {
    const text = "LEROY SOMON 1 2 KG per kg 34 99 07/09/2026 - 13/09/2026";
    expect(classifyOurFigure(text, lei(34.99), false).outcome).toBe("MATCHED_PER_UNIT");
  });

  it("catches the loyalty price stored as the shelf price (penny)", () => {
    const text = "preț fără PENNY card 22,99 LEI preț cu PENNY card 17,99 LEI";
    expect(classifyOurFigure(text, lei(17.99), false).outcome).toBe("MATCHED_LOYALTY");
  });

  // …and the shelf price on the SAME page is not a finding. Getting this wrong would report
  // every Penny offer as a defect.
  it("does not flag the non-card price beside it", () => {
    const text = "preț fără PENNY card 22,99 LEI preț cu PENNY card 17,99 LEI";
    expect(classifyOurFigure(text, lei(22.99), false).outcome).toBe("MATCHED_PACK");
  });

  it("catches a without-VAT figure stored as the price (dcneu's historical bug)", () => {
    const text = "LUMANARI CONICE 24.69 Lei Fără TVA: 20.41 Lei Stoc";
    expect(classifyOurFigure(text, lei(20.41), false).outcome).toBe("MATCHED_NO_VAT");
  });

  // ── AND THE EIGHTEEN FALSE POSITIVES, one per shape ──────────────────────────────────────
  // A colon means the label introduces what FOLLOWS. Read as a suffix, this reports DCNeu as
  // broken on the merchant whose real defect was exactly this figure — the fixed code wearing
  // the old bug's symptom.
  it("does not flag the WITH-VAT price that precedes a 'Fără TVA:' label", () => {
    const text = "LUMANARI CONICE 24.69 Lei Fără TVA: 20.41 Lei Stoc";
    expect(classifyOurFigure(text, lei(24.69), false).outcome).toBe("MATCHED_PACK");
  });

  it("does not flag a price followed by a DIFFERENT number's per-kilo label (freshful)", () => {
    const text = "7,99 Lei Economisești 25% 5,99 Lei 66,56 Lei/kg Avantajele Freshful";
    expect(classifyOurFigure(text, lei(5.99), false).outcome).toBe("MATCHED_PACK");
  });

  it("does not flag a price PRECEDED by a different number's per-litre label (mega-image)", () => {
    const text = "Bere blonda 0.66L 8.62 Lei/L Fii primul care evalueaza 8.62 Lei/L 5 69 Lei + 0.5 Lei x 1 buc";
    expect(classifyOurFigure(text, lei(5.69), false).outcome).toBe("MATCHED_PACK");
  });

  it("does not flag a pack price sitting after a per-kilo figure (sezamo)", () => {
    const text = "Felie de tort vegan cu ciocolata si capsune 110 g 349,91 lei/kg 38 49 lei Adaugă";
    expect(classifyOurFigure(text, lei(38.49), false).outcome).toBe("MATCHED_PACK");
  });

  // A with-VAT figure IS what a Romanian shopper pays, so it is the correct thing to have
  // stored — the classifier names the label and the outcome stays "this is the price".
  it("does not flag the TVA-inclus price beside a fara-TVA one (finestore)", () => {
    const text = "COMENZI PESTE 700 LEI 82 01 lei TVA inclus 67 78 lei fara TVA";
    const r = classifyOurFigure(text, lei(82.01), false);
    expect(r.outcome).toBe("MATCHED_PACK");
    expect(r.label).toBe("WITH_VAT");
  });

  // ── THE CASE THAT IS NEITHER, AND WHY THE BUG SURVIVED SO LONG ───────────────────────────
  //
  // A 1-litre bottle's price IS its price per litre. The label attaches perfectly and carries
  // no information. Penny's catalogue is mostly produce sold by the kilo, which is precisely
  // why 4 wrong prices hid among 29 for weeks.
  // NOTE THE TEXT: the per-unit occurrence must be the ONLY one. On Auchan's real page 2,79
  // also appears unqualified, and an unqualified occurrence settles it as the plain price —
  // which is why the live run reports auchan as PACK rather than COINCIDES. COINCIDES is for
  // the case where every occurrence carries the label.
  it("reports a 1-unit pack as COINCIDES, not as a finding", () => {
    const text = "In stoc 2,79 lei/l Adauga in cos";
    expect(classifyOurFigure(text, lei(2.79), true).outcome).toBe("COINCIDES");
  });

  it("an unqualified occurrence anywhere settles it as the plain price", () => {
    const text = "In stoc 2,79 lei + 0,5 lei garantie 2,79 lei/l Adauga in cos";
    expect(classifyOurFigure(text, lei(2.79), true).outcome).toBe("MATCHED_PACK");
  });

  it("…and the same text IS a finding when the pack is not one unit", () => {
    const text = "In stoc 2,79 lei/l Adauga in cos";
    expect(classifyOurFigure(text, lei(2.79), false).outcome).toBe("MATCHED_PER_UNIT");
  });

  // ── A PRICE THE HTML DOES NOT CONTAIN IS NOT A WRONG PRICE ───────────────────────────────
  // Auchan, Metro and Carrefour render prices in the browser. Calling that ABSENT invited the
  // reading "our price disagrees with the shop", which it does not say.
  it("reports NOT_IN_HTML rather than accusing a client-rendered page", () => {
    expect(classifyOurFigure("Biscuiti vanilie BN, 285g In stoc Adauga in cos", lei(12.69), false).outcome)
      .toBe("NOT_IN_HTML");
  });

  // Carrefour and Selgros split the decimal across two elements; Auchan spaces it out.
  it("finds a price split across elements", () => {
    expect(classifyOurFigure("8 29 Lei 7 99 Lei", lei(7.99), false).outcome).toBe("MATCHED_PACK");
    expect(classifyOurFigure("In stoc 2 , 79 lei garantie", lei(2.79), false).outcome).toBe("MATCHED_PACK");
  });
});
