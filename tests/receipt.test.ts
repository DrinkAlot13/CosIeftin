// Receipt (bon fiscal) parsing — real Romanian receipt layouts.
// These are prices people ACTUALLY paid, so a parse error here writes fiction into the
// only dataset competitors can't scrape. Every layout we support is pinned.
import { describe, it, expect } from "./run";
import { parseReceiptText, receiptBalances, detectMerchant, detectDate } from "../src/lib/receipt";

const KAUFLAND = `
S.C. KAUFLAND ROMANIA SCS
STR. BARBU VACARESCU NR. 120
C.I.F. RO17962170
BON FISCAL
26.08.2026 18:42
LAPTE ZUZU 1.5% 1L      1 x 6,49       6,49 B
PAINE FELIATA 500G                     4,99 A
OUA MARIMEA M 10BUC     2 x 12,99     25,98 B
PUNGA BIODEGRADABILA    2 x 0,50       1,00 B
TOTAL                                 38,46
NUMERAR                               40,00
REST                                   1,54
VA MULTUMIM!
`;

describe("receipt — Kaufland layout", () => {
  const r = parseReceiptText(KAUFLAND);

  it("detects the merchant", () => expect(r.merchant).toBe("kaufland"));
  it("detects the date", () => expect(r.date?.toISOString().slice(0, 10)).toBe("2026-08-26"));
  it("reads the printed total", () => expect(r.total).toBeCloseTo(38.46));
  it("finds all four product lines", () => expect(r.lines.length).toBe(4));

  it("parses a quantity line's unit price", () => {
    const oua = r.lines.find((l) => l.name.includes("OUA"))!;
    expect(oua.qty).toBe(2);
    expect(oua.unitPrice).toBeCloseTo(12.99);
    expect(oua.lineTotal).toBeCloseTo(25.98);
  });

  it("parses a single-item line", () => {
    const paine = r.lines.find((l) => l.name.includes("PAINE"))!;
    expect(paine.qty).toBe(1);
    expect(paine.unitPrice).toBeCloseTo(4.99);
  });

  it("never turns TOTAL/REST/NUMERAR into products", () => {
    expect(r.lines.some((l) => /total|rest|numerar|multumim/i.test(l.name))).toBeFalsy();
  });

  it("the lines add up to the printed total", () => expect(receiptBalances(r)).toBeTruthy());
});

describe("receipt — other chains and formats", () => {
  it("detects Mega Image", () => expect(detectMerchant("S.C. MEGA IMAGE S.R.L.")).toBe("mega-image"));
  it("detects Lidl", () => expect(detectMerchant("LIDL DISCOUNT SRL")).toBe("lidl"));
  it("detects Profi", () => expect(detectMerchant("PROFI ROM FOOD SRL")).toBe("profi"));
  it("unknown chain -> null", () => expect(detectMerchant("MAGAZINUL LUI GIGEL")).toBe(null));

  it("reads an ISO date", () => expect(detectDate("2026-01-15 09:30")?.toISOString().slice(0, 10)).toBe("2026-01-15"));
  it("reads a dash date", () => expect(detectDate("15-01-2026")?.toISOString().slice(0, 10)).toBe("2026-01-15"));

  it("handles a line with no printed line-total", () => {
    const r = parseReceiptText("CAFEA JACOBS 250G   3 x 18,50");
    expect(r.lines[0].qty).toBe(3);
    expect(r.lines[0].lineTotal).toBeCloseTo(55.5);
  });

  it("RO decimal commas are parsed, not truncated", () => {
    const r = parseReceiptText("ULEI FLOAREA SOARELUI 1L   7,49 A");
    expect(r.lines[0].unitPrice).toBeCloseTo(7.49);
  });

  it("an unbalanced receipt is reported as such", () => {
    const r = parseReceiptText("LAPTE 1L   6,49 B\nTOTAL   99,00");
    expect(receiptBalances(r)).toBeFalsy();
  });
});
