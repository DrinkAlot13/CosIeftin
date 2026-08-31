// DCNeu full extraction, entirely offline.
//
// Fixture provenance: `gel-de-dus.html`, `stock-variety.html` and `detail-in-stock.html` are
// verbatim captures. The four `card-*.html` files are derived from a REAL card with exactly
// one field changed (stock wording, the VAT pair, a Logare button, a removed price-tax), so
// each case under test is isolated without inventing markup wholesale.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import { parseCard, parseProducts, parseDetail, readStock } from "../scripts/scrape-dcneu";

const FIX = join(process.cwd(), "tests", "fixtures", "dcneu");
const read = (f: string) => (existsSync(join(FIX, f)) ? readFileSync(join(FIX, f), "utf8") : "");

describe("DCNeu — stock status", () => {
  it("reads Romanian in-stock wording", () => expect(readStock("In stoc")).toBe("IN_STOCK"));
  it("reads out-of-stock wording", () => expect(readStock("Nu este în stoc")).toBe("OUT_OF_STOCK"));
  it("reads the cedilla-free spelling too", () => expect(readStock("Nu este in stoc")).toBe("OUT_OF_STOCK"));
  it("reads 'stoc epuizat'", () => expect(readStock("Stoc epuizat")).toBe("OUT_OF_STOCK"));
  it("reads limited stock", () => expect(readStock("Stoc limitat")).toBe("LIMITED"));
  it("unknown wording is UNKNOWN, not a guess", () => expect(readStock("")).toBe("UNKNOWN"));

  it("an out-of-stock card is parsed and flagged, not dropped", () => {
    const p = parseCard(read("card-out-of-stock.html")).product!;
    expect(p.stockStatus).toBe("OUT_OF_STOCK");
    // still has a price — out of stock keeps its last known price for history
    expect(p.price > 0).toBeTruthy();
    expect(p.available).toBeFalsy();
  });

  it("an in-stock card is available", () => {
    const p = parseCard(read("stock-variety.html").split('class="product-thumb')[1] ? 'class="product-thumb' + read("stock-variety.html").split('class="product-thumb')[1] : "").product!;
    expect(p.stockStatus).toBe("IN_STOCK");
    expect(p.available).toBeTruthy();
  });
});

describe("DCNeu — VAT is derived per product, never assumed", () => {
  const products = parseProducts(read("gel-de-dus.html"));

  it("derives 21% for non-food from the card's own two figures", () => {
    expect(products[0].vatRateBp).toBe(2100);
  });
  it("stores BOTH figures so the derivation is auditable", () => {
    expect(products[0].priceWithVatBani).toBe(1363);
    expect(products[0].priceWithoutVatBani).toBe(1126);
  });
  it("the stored price is the WITH-VAT consumer price", () => {
    // the bug this replaces stored 11.26 — about 21% below what a shopper pays
    expect(products[0].price).toBeCloseTo(13.63);
    expect(products[0].price === 11.26).toBeFalsy();
  });
  it("derives 11% for a basic-food price pair", () => {
    const p = parseCard(read("card-food-11pct.html")).product!;
    expect(p.vatRateBp).toBe(1100);
    expect(p.price).toBeCloseTo(11.10);
  });
  it("returns null when the card states only one figure — never a guessed rate", () => {
    const p = parseCard(read("card-no-vat-pair.html")).product!;
    expect(p.vatRateBp).toBe(null);
    expect(p.priceWithoutVatBani).toBe(null);
    expect(p.price > 0).toBeTruthy(); // the consumer price is still known
  });
});

describe("DCNeu — login gating and per-card integrity", () => {
  it("does not falsely flag an ordinary card as login-gated", () => {
    const products = parseProducts(read("gel-de-dus.html"));
    expect(products.length).toBeGreaterThan(4);
  });
  it("parses a login-gated card without losing its price", () => {
    const p = parseCard(read("card-login-gated.html")).product!;
    expect(p.price > 0).toBeTruthy();
  });
  it("every product carries its OWN url", () => {
    const products = parseProducts(read("gel-de-dus.html"));
    expect(new Set(products.map((p) => p.productUrl)).size).toBe(products.length);
  });
  it("a card with no price element is dropped, not given a neighbour's", () => {
    const r = parseCard('<a href="https://comenzi.dcneu.ro/a/b/c" title="X"></a>');
    expect(r.product).toBe(null);
    expect(r.reason).toBe("no-price-element");
  });
  it("brand is captured from the card", () => {
    expect(parseProducts(read("gel-de-dus.html"))[0].brand).toBe("Adidas");
  });
});

describe("DCNeu — detail page (JSON-LD)", () => {
  const d = parseDetail(read("detail-in-stock.html"));

  it("extracts the merchant SKU", () => expect(d.sku).toBe("50586"));
  it("reads schema.org availability", () => expect(d.availability).toBe("IN_STOCK"));
  it("extracts a category path from the breadcrumb", () => expect((d.categoryPath ?? "").length > 0).toBeTruthy());
  // Honest result, not a wish: DCNeu publishes no GTIN in its JSON-LD.
  it("reports EAN as absent rather than inventing one", () => expect(d.ean).toBe(null));
  it("does not falsely report login gating on a normal page", () => expect(d.loginGated).toBeFalsy());
});
