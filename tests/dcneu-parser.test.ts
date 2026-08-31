// DCNeu card parser, against an offline fixture. This scraper shipped FABRICATED prices —
// 347 groups where distinct products shared one price+URL, one group of 73 at 7.96 lei —
// because it read a fixed 2600-char HTML window instead of each card's own price element.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import { parseCard, parseProducts } from "../scripts/scrape-dcneu";

const PATH_ = join(process.cwd(), "tests", "fixtures", "dcneu", "gel-de-dus.html");
const html = existsSync(PATH_) ? readFileSync(PATH_, "utf8") : "";
const products = html ? parseProducts(html) : [];

describe("DCNeu card parser (fixture)", () => {
  it("fixture exists", () => expect(html.length).toBeGreaterThan(1000));
  it("parses every card in the fixture", () => expect(products.length).toBeGreaterThan(4));

  it("each product has its OWN url — no two share one", () => {
    const urls = products.map((p) => p.productUrl);
    expect(new Set(urls).size).toBe(products.length);
  });

  it("each product has its own name", () => {
    expect(new Set(products.map((p) => p.name)).size).toBe(products.length);
  });

  // THE regression: the ex-VAT figure sits right beside the real price, and a
  // lowest-number-wins scan took it — making DCNeu look ~19% cheaper than it is.
  it("takes the WITH-VAT price, never the 'Fără TVA' one", () => {
    const first = products[0];
    expect(first.price).toBeCloseTo(13.63);
    expect(first.price === 11.26).toBeFalsy();
  });

  it("rawPriceText is the exact source string", () => {
    expect(products[0].rawPriceText).toBe("13.63 Lei");
  });

  it("prices are plausible and never zero", () => {
    expect(products.every((p) => p.price > 0.1 && p.price < 5000)).toBeTruthy();
  });

  it("priceSource is ONLINE", () => expect(products.every((p) => p.priceSource === "ONLINE")).toBeTruthy());
});

describe("DCNeu card parser — refuses to borrow a neighbour's data", () => {
  it("a card with no price element is DROPPED, not given one", () => {
    const card = '<a href="https://comenzi.dcneu.ro/x/y/z" title="PRODUS FARA PRET"></a>';
    const r = parseCard(card);
    expect(r.product).toBe(null);
    expect(r.reason).toBe("no-price-element");
  });
  it("a card with no link is dropped", () => {
    const r = parseCard('<span class="price-normal">10.00 Lei</span>');
    expect(r.product).toBe(null);
    expect(r.reason).toBe("no-link");
  });
  it("an unparseable price is dropped rather than defaulted to 0", () => {
    const card = '<a href="https://comenzi.dcneu.ro/x/y/z" title="X"></a><span class="price-normal">la cerere</span>';
    const r = parseCard(card);
    expect(r.product).toBe(null);
    expect(r.reason).toBe("unparseable-price");
  });
});
