// GOLDEN SET — hand-labeled product pairs, including the two production bugs that
// cost us a rebuild. If a matcher change makes any of these flip, the build fails.
//
//   Zarea:        1 cheap Carrefour wine backed 64 unrelated wines (brand+size too loose)
//   Dom Pérignon: 1 Carrefour "dom" bottle backed every DP variant (unbranded over-match)
import { describe, it, expect } from "./run";
import { matchDecision } from "../src/lib/scrape-util";
import { normalizeText, foldDiacritics } from "../src/lib/matching";

const wine = (name: string, brand = "") => ({ name, brand, unit: "l", unitSize: 0.75 });

describe("matcher — alcohol over-matching regressions", () => {
  it("REJECT: Zarea rosé does not back a Kendall-Jackson", () =>
    expect(matchDecision(
      { name: "Vin Kendall-Jackson, Vintners Reserve, Sonoma County, Rosu, Cabernet Sauvignon, 0.75 l", brand: "Zarea", unit: "l", unitSize: 0.75 },
      wine("Vin rose Zarea Sange de Taur dulce 0.75L", "Zarea"),
      "alcohol",
    ).ok).toBeFalsy());

  it("REJECT: Zarea rosé does not back a Lacerta Fetească Neagră", () =>
    expect(matchDecision(
      { name: "Vin Rosu Lacerta Feteasca Neagra, Sec, 0.75l", brand: "Zarea", unit: "l", unitSize: 0.75 },
      wine("Vin rose Zarea Sange de Taur dulce 0.75L", "Zarea"),
      "alcohol",
    ).ok).toBeFalsy());

  it("REJECT: a generic 'Dom' bottle does not back Dom Pérignon Brut", () =>
    expect(matchDecision(
      { name: "Dom Perignon Brut 0.75L", brand: "", unit: "l", unitSize: 0.75 },
      wine("Vin spumant Dom Bogdan alb sec 0.75L"),
      "alcohol",
    ).ok).toBeFalsy());

  it("REJECT: Dom Pérignon Rose is not Dom Pérignon Brut", () =>
    expect(matchDecision(
      { name: "Dom Perignon Brut 0.75L", brand: "", unit: "l", unitSize: 0.75 },
      wine("Dom Perignon Rose 0.75L"),
      "alcohol",
    ).ok).toBeFalsy());

  it("ACCEPT: the same wine across two stores still matches", () =>
    expect(matchDecision(
      { name: "Vin Rosu Lacerta Feteasca Neagra, Sec, 0.75l", brand: "", unit: "l", unitSize: 0.75 },
      wine("Vin rosu Lacerta Feteasca Neagra sec 0.75 l"),
      "alcohol",
    ).ok).toBeTruthy());

  it("ACCEPT: Dom Pérignon Brut matches itself across stores", () =>
    expect(matchDecision(
      { name: "Dom Perignon Brut 0.75L", brand: "", unit: "l", unitSize: 0.75 },
      wine("Dom Perignon Brut 0.75 L"),
      "alcohol",
    ).ok).toBeTruthy());
});

describe("matcher — size guards", () => {
  it("REJECT: 500 g never merges into 1 kg", () =>
    expect(matchDecision(
      { name: "Faina alba Baneasa 1kg", brand: "Baneasa", unit: "kg", unitSize: 1 },
      { name: "Faina alba Baneasa 500g", brand: "Baneasa", unit: "kg", unitSize: 0.5 },
    ).ok).toBeFalsy());

  it("REJECT: 0.75 L wine never merges into a 1.5 L magnum", () =>
    expect(matchDecision(
      { name: "Dom Perignon Brut 0.75L", brand: "", unit: "l", unitSize: 0.75 },
      { name: "Dom Perignon Brut Magnum 1.5L", brand: "", unit: "l", unitSize: 1.5 },
      "alcohol",
    ).ok).toBeFalsy());

  it("ACCEPT: 6% size tolerance (990 ml ≈ 1 L)", () =>
    expect(matchDecision(
      { name: "Lapte Zuzu 1L", brand: "Zuzu", unit: "l", unitSize: 1 },
      { name: "Lapte Zuzu 0.99L", brand: "Zuzu", unit: "l", unitSize: 0.99 },
    ).ok).toBeTruthy());

  it("REJECT: different unit families (kg vs l)", () =>
    expect(matchDecision(
      { name: "Iaurt Zuzu 1kg", brand: "Zuzu", unit: "kg", unitSize: 1 },
      { name: "Lapte Zuzu 1L", brand: "Zuzu", unit: "l", unitSize: 1 },
    ).ok).toBeFalsy());
});

describe("matcher — grocery brand behaviour", () => {
  it("ACCEPT: same branded grocery item across stores", () =>
    expect(matchDecision(
      { name: "Lapte Zuzu 1.5% grasime 1L", brand: "Zuzu", unit: "l", unitSize: 1 },
      { name: "Lapte Zuzu 1,5% 1 L", brand: "Zuzu", unit: "l", unitSize: 1 },
    ).ok).toBeTruthy());

  it("REJECT: different brand, same product type", () =>
    expect(matchDecision(
      { name: "Lapte Zuzu 1L", brand: "Zuzu", unit: "l", unitSize: 1 },
      { name: "Lapte Napolact 1L", brand: "Napolact", unit: "l", unitSize: 1 },
    ).ok).toBeFalsy());

  it("REJECT: unrelated product sharing a size", () =>
    expect(matchDecision(
      { name: "Ulei floarea soarelui Untdelemn de la Bunica 1L", brand: "Untdelemn de la Bunica", unit: "l", unitSize: 1 },
      { name: "Lapte Zuzu 1L", brand: "Zuzu", unit: "l", unitSize: 1 },
    ).ok).toBeFalsy());
});

describe("matcher — EAN is a join, not a guess", () => {
  it("ACCEPT: identical EAN wins even with different names", () =>
    expect(matchDecision(
      { name: "Nutella crema tartinabila 400g", brand: "Nutella", unit: "kg", unitSize: 0.4, ean: "3017620425035" },
      { name: "NUTELLA CREMA CACAO ALUNE 400 G", brand: "", unit: "kg", unitSize: 0.4, ean: "3017620425035" },
    ).ok).toBeTruthy());

  it("EAN match scores 1.0", () =>
    expect(matchDecision(
      { name: "Nutella 400g", brand: "Nutella", unit: "kg", unitSize: 0.4, ean: "3017620425035" },
      { name: "Nutella cacao 400g", brand: "", unit: "kg", unitSize: 0.4, ean: "3017620425035" },
    ).score).toBe(1));

  it("REJECT: invalid-checksum EANs are not treated as a join", () =>
    expect(matchDecision(
      { name: "Produs A 1L", brand: "", unit: "l", unitSize: 1, ean: "1111111111111" },
      { name: "Produs B 1L", brand: "", unit: "l", unitSize: 1, ean: "1111111111111" },
      "alcohol",
    ).ok).toBeFalsy());
});

describe("Romanian diacritics — comma-below vs cedilla", () => {
  it("comma-below ș and cedilla ş fold the same", () =>
    expect(normalizeText("Făgăraș")).toBe(normalizeText("Făgăraş")));

  it("comma-below ț and cedilla ţ fold the same", () =>
    expect(normalizeText("smântână onctuoasă ț")).toBe(normalizeText("smântână onctuoasă ţ")));

  it("folds the full RO set to ASCII", () =>
    expect(foldDiacritics("ăâîșțĂÂÎȘȚ")).toBe("aaistAAIST"));

  it("MATCH: brânză Făgăraș across both spellings", () =>
    expect(matchDecision(
      { name: "Brânză telemea Făgăraș 400g", brand: "", unit: "kg", unitSize: 0.4 },
      { name: "Branza telemea Fagaraş 400 g", brand: "", unit: "kg", unitSize: 0.4 },
    ).ok).toBeTruthy());

  it("cedilla spelling still finds the product in search normalization", () =>
    expect(normalizeText("Ţuică de prune")).toBe("tuica de prune"));
});
