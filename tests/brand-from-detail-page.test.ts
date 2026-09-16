// isNotABrand's own-domain guard — the 2026-09-16 regression.
//
// A produce item with no real manufacturer brand links to the site's own "toate produsele"
// page instead of a real brand's, and the link-text rule read that as a brand: 405 Sezamo
// products (loose produce — mangoes, lettuce, herbs) got brand="sezamo.ro". That is worse than
// no brand: a brand-less product clears decide()'s brand gate by default, but an exclusive
// brand naming the merchant's own domain can never appear in any OTHER merchant's raw text, so
// it blocks a cross-merchant match permanently.
import { describe, it, expect } from "./run";
import { isNotABrand } from "../src/lib/brand/from-detail-page";

describe("isNotABrand — own-domain guard", () => {
  it("REGRESSION: rejects the merchant's own domain as a brand", () => {
    expect(isNotABrand("sezamo.ro", "sezamo.ro")).toBe(true);
  });
  it("rejects the domain regardless of case", () => {
    expect(isNotABrand("Sezamo.RO", "sezamo.ro")).toBe(true);
  });
  it("rejects with a www. prefix on either side", () => {
    expect(isNotABrand("www.sezamo.ro", "sezamo.ro")).toBe(true);
    expect(isNotABrand("sezamo.ro", "www.sezamo.ro")).toBe(true);
  });
  it("does not reject a real brand just because SOME merchant's domain was checked", () => {
    expect(isNotABrand("Nivea", "sezamo.ro")).toBe(false);
  });
  it("does not reject a private-label brand that merely contains the merchant's name", () => {
    // Carrefour Classic/Sensation are real, legitimate store-brand lines — an exact-domain
    // check must not widen into a substring check that would block these too.
    expect(isNotABrand("Carrefour Classic", "carrefour.ro")).toBe(false);
  });
  it("with no ownDomain given, behaves exactly as before", () => {
    expect(isNotABrand("sezamo.ro")).toBe(false);
    expect(isNotABrand("Nivea")).toBe(false);
  });
});
