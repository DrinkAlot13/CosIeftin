// WineMag's tile markup splits the current price and the struck "was" price into two
// separate elements (`.product__info--price-gross` / `.product__info--old-price-gross`), so the
// adapter config is what keeps them from being read as one blob — same reasoning as
// adapter-selgros.test.ts, just without a split-across-spans price (WineMag's price text is a
// normal "24,65 Lei" string, not digits in separate nodes).
import { describe, it, expect } from "./run";
import { winemag } from "../scripts/adapters/winemag";

describe("WineMag — the adapter config", () => {
  it("reads the current price from its own node, not the wrapper", () => {
    expect(winemag.dom?.price).toEqual([".product__info--price-gross"]);
  });

  it("reads the struck 'was' price as a reference, never as the current price", () => {
    expect(winemag.dom?.reference).toEqual([".product__info--old-price-gross"]);
  });

  it("respects the site's own robots.txt crawl-delay (5s)", () => {
    expect(winemag.delayMs).toBe(5000);
  });

  it("covers wine by colour plus every spirit category, never a brand or accessory page", () => {
    const slugs = winemag.routes.map((r) => r.url);
    expect(slugs.some((u) => u.includes("/vinuri-albe/"))).toBeTruthy();
    expect(slugs.some((u) => u.includes("/rom/"))).toBeTruthy();
    // Accessory/brand pages would double-count products already reachable from a colour or
    // spirit category — see winemag.ts's header for the measured ~7,550/~9,576 coverage.
    expect(slugs.some((u) => u.includes("/pahare/"))).toBeFalsy();
    expect(slugs.some((u) => u.includes("/jidvei/"))).toBeFalsy();
  });

  it("every route carries a {page} token, so pagination is never silently page 1 only", () => {
    expect(winemag.routes.every((r) => r.url.includes("{page}"))).toBeTruthy();
  });

  it("every route names its own category for categoryPath", () => {
    expect(winemag.routes.every((r) => typeof r.cat === "string" && r.cat.length > 0)).toBeTruthy();
  });
});
