// Romanian normalization. The headline requirement: BOTH Unicode encodings of ș and ț
// must fold identically, because both appear in scraped data and NFD does not unify them.
import { describe, it, expect } from "./run";
import {
  normalizeRo, foldDiacritics, tokensRo, overlapTokensRo, leadTokenRo, jaccard, isStopword,
} from "../src/lib/text/normalizeRo";

// Explicit codepoints so the test cannot be defeated by an editor silently converting them.
const S_COMMA: string = "ș"; // ș  comma-below, correct Romanian
const S_CEDIL: string = "ş"; // ş  Turkish cedilla, widely mis-used for Romanian
const T_COMMA: string = "ț"; // ț  comma-below
const T_CEDIL: string = "ţ"; // ţ  cedilla

describe("normalizeRo — the two Unicode variants of ș and ț", () => {
  it("the two ș codepoints really are different (guards the premise)", () =>
    expect(S_COMMA === S_CEDIL).toBeFalsy());
  it("the two ț codepoints really are different", () => expect(T_COMMA === T_CEDIL).toBeFalsy());

  it("comma-below ș folds to s", () => expect(foldDiacritics(S_COMMA)).toBe("s"));
  it("cedilla ş folds to s", () => expect(foldDiacritics(S_CEDIL)).toBe("s"));
  it("comma-below ț folds to t", () => expect(foldDiacritics(T_COMMA)).toBe("t"));
  it("cedilla ţ folds to t", () => expect(foldDiacritics(T_CEDIL)).toBe("t"));

  it("Făgăraș (comma) and Făgăraş (cedilla) normalize identically", () =>
    expect(normalizeRo("Făgăra" + S_COMMA)).toBe(normalizeRo("Făgăra" + S_CEDIL)));
  it("both spellings land on the ASCII form", () => {
    expect(normalizeRo("Făgăra" + S_COMMA)).toBe("fagaras");
    expect(normalizeRo("Făgăra" + S_CEDIL)).toBe("fagaras");
  });

  it("ț both ways: țuică / ţuică", () =>
    expect(normalizeRo(T_COMMA + "uică")).toBe(normalizeRo(T_CEDIL + "uică")));
  it("uppercase variants fold too", () =>
    expect(normalizeRo("ȘTEFAN")).toBe(normalizeRo("ŞTEFAN")));
});

describe("normalizeRo — the rest of the alphabet", () => {
  it("folds ă â î", () => expect(foldDiacritics("ăâî")).toBe("aai"));
  it("folds uppercase Ă Â Î", () => expect(foldDiacritics("ĂÂÎ")).toBe("aai"));
  it("full set to ASCII", () => expect(foldDiacritics("ăâîșțĂÂÎȘȚ")).toBe("aaistaaist"));
  it("plain ASCII is untouched", () => expect(normalizeRo("lapte zuzu")).toBe("lapte zuzu"));
});

describe("normalizeRo — lowercase, punctuation, whitespace", () => {
  it("lowercases", () => expect(normalizeRo("LAPTE")).toBe("lapte"));
  it("strips punctuation", () => expect(normalizeRo("Brânză, telemea!")).toBe("branza telemea"));
  it("collapses whitespace", () => expect(normalizeRo("  lapte    zuzu  ")).toBe("lapte zuzu"));
  it("handles newlines and tabs", () => expect(normalizeRo("lapte\n\tzuzu")).toBe("lapte zuzu"));
  it("keeps digits", () => expect(normalizeRo("Lapte 1,5% 1L")).toBe("lapte 1 5 1l"));
  it("null → empty string", () => expect(normalizeRo(null)).toBe(""));
  it("undefined → empty string", () => expect(normalizeRo(undefined)).toBe(""));
  it("a real product name", () =>
    expect(normalizeRo("Brânză Telemea Făgăraş, 400 g!")).toBe("branza telemea fagaras 400 g"));
});

describe("tokensRo — blocking tokens (>=3 chars, no digits, no stopwords)", () => {
  it("drops stopwords", () => expect(tokensRo("lapte de vaca").includes("de")).toBeFalsy());
  it("drops short tokens", () => expect(tokensRo("vin a b rosu").join(" ")).toBe("vin rosu"));
  it("drops numeric tokens", () => expect(tokensRo("Lapte 1L 500g").join(" ")).toBe("lapte"));
  it("keeps real words", () => expect(tokensRo("Brânză Telemea").join(" ")).toBe("branza telemea"));
  it("isStopword knows the RO fillers", () => expect(isStopword("pentru")).toBeTruthy());
});

describe("overlapTokensRo — scoring tokens KEEP short words", () => {
  // This is the fix for the 64-way wine over-match: variants live in short tokens.
  it("keeps a 1-character variant marker", () =>
    expect(overlapTokensRo("Cuvee I").includes("i")).toBeTruthy());
  it("keeps 'Brut' and 'Rose' distinct", () => {
    const brut = new Set(overlapTokensRo("Dom Perignon Brut"));
    const rose = new Set(overlapTokensRo("Dom Perignon Rose"));
    expect(jaccard(brut, rose) < 0.6).toBeTruthy();
  });
  it("identical names score 1", () => {
    const a = new Set(overlapTokensRo("Vin rosu Lacerta Feteasca Neagra sec"));
    const b = new Set(overlapTokensRo("Vin Rosu Lacerta Feteasca Neagra, Sec"));
    expect(jaccard(a, b)).toBe(1);
  });
  it("unrelated wines score far below the 0.6 gate", () => {
    const zarea = new Set(overlapTokensRo("Vin rose Zarea Sange de Taur dulce"));
    const kj = new Set(overlapTokensRo("Vin Kendall-Jackson Vintners Reserve Cabernet Sauvignon"));
    expect(jaccard(zarea, kj) < 0.6).toBeTruthy();
  });
  it("still drops digits (size is checked separately)", () =>
    expect(overlapTokensRo("Lapte 1L").includes("1l")).toBeFalsy());
});

describe("leadTokenRo", () => {
  it("takes the first significant token", () => expect(leadTokenRo("Lapte Zuzu 1.5% 1L")).toBe("lapte"));
  it("skips a leading stopword", () => expect(leadTokenRo("de Brânză")).toBe("branza"));
  it("empty input → empty string", () => expect(leadTokenRo("")).toBe(""));
});

describe("jaccard", () => {
  it("identical sets", () => expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1));
  it("disjoint sets", () => expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0));
  it("half overlap", () => expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3));
  it("empty set is 0, not NaN", () => expect(jaccard(new Set(), new Set(["a"]))).toBe(0));
});
