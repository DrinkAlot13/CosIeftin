// Penny's 30-day minimum — read offline from the real tile text, with no network or browser.
//
// `probe:omnibus` fetched 50 live product pages across 11 merchants. Penny was the ONLY one
// that prints the EU-Omnibus 30-day minimum, on 5 of 5 pages, and the database held zero
// OMNIBUS_30D values. The figure was on the page the whole time.
//
// It was dropped on purpose, for a good reason that stopped being one. Penny's tile puts three
// things inside the price wrapper:
//
//     de mi 09.09.2026 până ma 15.09.2026          ← promo validity range
//     preț minim ultimele 30 de zile: 6,99 LEI     ← the Omnibus figure
//     preț fără PENNY card 8,99 LEI                ← the price
//
// A loose `[class*="price"]` swept up all three, `09.09.2026` parsed as an amount, and
// **1092026 lei** was written onto real products. The fix narrowed the price selector — and
// took the 30-day figure with it.
//
// These strings are copied verbatim from https://www.penny.ro/categorie/oferte-site-kw37,
// fetched 2026-09-09.
import { describe, it, expect } from "./run";
import { readReferenceStatement } from "../scripts/adapters/runner";
import { parsePriceDetailed } from "../src/lib/price/parsePrice";
import { penny } from "../scripts/adapters/penny";

const LOWEST = "preț minim ultimele 30 de zile: 6,99 LEI";
const VALIDITY = "de mi 09.09.2026 până ma 15.09.2026";
const PRICE = "preț fără PENNY card 8,99 LEI 1 KG 8,99 LEI preț cu PENNY card 5,99 LEI 1 KG 5,99 LEI";

describe("Penny — the 30-day minimum is read, and cannot become a price", () => {
  it("reads the Omnibus figure from the dedicated node", () => {
    const r = readReferenceStatement(parsePriceDetailed(PRICE), LOWEST);
    expect(r.bani).toBe(699);
    expect(r.kind).toBe("OMNIBUS_30D");
  });

  // TWO INDEPENDENT DEFENCES, and it is worth knowing which one is doing the work.
  //
  // `parsePrice` already strips the Omnibus phrase and any date before it scans for an amount,
  // so the reference node yields NO current price on its own — 6,99 is returned as a reference
  // and nothing is returned as a price. That is the parser's own rule, tested in
  // tests/parsePrice.test.ts, and it is the first defence.
  //
  // `readReferenceStatement` is the second: it cannot return a price whatever the parser says,
  // because its result type has no price in it. The narrowing that lost this figure for the
  // whole database was a third kind — selector discipline — and it is the kind that failed.
  it("yields a reference and no price, and structurally cannot yield one", () => {
    const direct = parsePriceDetailed(LOWEST);
    expect(direct.priceBani).toBe(null);
    expect(direct.referencePriceBani).toBe(699);

    const r = readReferenceStatement({ referencePriceBani: undefined, referencePriceKind: null }, LOWEST);
    expect(r.bani).toBe(699);
    expect(Object.prototype.hasOwnProperty.call(r, "priceBani")).toBe(false);
  });

  // The regression that caused the original narrowing. A date is not an amount.
  it("never turns the promo validity range into 1092026 lei", () => {
    expect(parsePriceDetailed(VALIDITY).priceBani).toBe(null);
    const r = readReferenceStatement(parsePriceDetailed(PRICE), VALIDITY);
    expect(r.bani).toBe(null);
  });

  it("falls back to a reference found in the price text when there is no reference node", () => {
    const r = readReferenceStatement({ referencePriceBani: 1234, referencePriceKind: "STRIKETHROUGH" }, "");
    expect(r.bani).toBe(1234);
    expect(r.kind).toBe("STRIKETHROUGH");
  });

  it("the adapter declares the selector, so this is wired and not merely possible", () => {
    expect(penny.dom?.reference?.[0]).toBe('[data-test="product-price-lowest-price"]');
    // …and the price selector stays narrow. Widening it is the bug this replaces.
    expect(penny.dom?.price.some((s) => s.includes("*="))).toBe(false);
  });
});
