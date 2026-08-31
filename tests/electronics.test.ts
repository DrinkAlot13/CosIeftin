// Electronics matching. Deliberately NOT the grocery matcher: identifiers are exact here,
// so the rules are simpler AND stricter.
import { describe, it, expect } from "./run";
import { matchElectronics, normalizeMpn, extractSpecs } from "../src/lib/electronics/match";

const P = (name: string, o: Partial<{ brand: string; ean: string; mpn: string; model: string }> = {}) => ({ name, ...o });

describe("electronics — identifier first", () => {
  it("identical EAN is definitive regardless of name", () => {
    const r = matchElectronics(
      P("Samsung Galaxy S24 128GB Negru", { ean: "8806095299099" }),
      P("SAMSUNG S24 5G 128 GB black", { ean: "8806095299099" }),
    );
    expect(r.ok).toBeTruthy();
    expect(r.reason).toBe("EAN_EXACT");
    expect(r.confidence).toBe(1);
  });

  it("different valid EANs are definitively NOT the same product", () => {
    const r = matchElectronics(
      P("Galaxy S24", { ean: "8806095299099" }),
      P("Galaxy S24", { ean: "3017620425035" }),
    );
    expect(r.ok).toBeFalsy();
  });

  it("MPN matches across vendor punctuation", () => {
    const r = matchElectronics(P("Galaxy S24", { mpn: "SM-S921BZKD" }), P("Samsung S24", { mpn: "sm s921bzkd" }));
    expect(r.ok).toBeTruthy();
    expect(r.reason).toBe("MPN_EXACT");
  });

  it("model number matches when MPN is absent", () => {
    const r = matchElectronics(P("TV LG", { model: "OLED55C4" }), P("LG OLED 55", { model: "oled55c4" }));
    expect(r.reason).toBe("MODEL_EXACT");
  });

  it("a too-short identifier is not an identifier", () => expect(normalizeMpn("A1")).toBe(""));
});

describe("electronics — name is a tiebreaker, never a key", () => {
  // The case that would break a name-overlap matcher: one high-signal extra token.
  it("does NOT merge S24 with S24 Ultra", () => {
    const r = matchElectronics(
      P("Samsung Galaxy S24 128GB", { brand: "Samsung" }),
      P("Samsung Galaxy S24 Ultra 256GB", { brand: "Samsung" }),
    );
    expect(r.ok).toBeFalsy();
  });

  it("refuses to match across brands even on similar names", () => {
    const r = matchElectronics(P("Laptop 15 inch 16GB", { brand: "Asus" }), P("Laptop 15 inch 16GB", { brand: "Acer" }));
    expect(r.ok).toBeFalsy();
  });

  it("accepts a near-identical name when no identifier exists", () => {
    const r = matchElectronics(
      P("Aspirator Philips XC7042", { brand: "Philips" }),
      P("Aspirator Philips XC7042", { brand: "Philips" }),
    );
    expect(r.ok).toBeTruthy();
    expect(r.reason).toBe("NAME_TIEBREAK");
  });

  it("does not guess from a loose name alone", () => {
    const r = matchElectronics(P("Televizor LED 55 inch"), P("Televizor OLED 65 inch"));
    expect(r.ok).toBeFalsy();
    expect(r.reason).toBe("NO_MATCH");
  });
});

describe("electronics — spec extraction for filtering", () => {
  it("screen size", () => {
    const s = extractSpecs('Laptop ASUS 15.6" FHD');
    expect(s.find((x) => x.key === "screenSize")?.value).toBe("15.6");
  });
  it("RAM and storage separately", () => {
    const s = extractSpecs("Laptop 16GB RAM 512GB SSD");
    expect(s.find((x) => x.key === "ram")?.value).toBe("16");
    expect(s.find((x) => x.key === "storage")?.value).toBe("512");
  });
  it("CPU family", () => expect(extractSpecs("Laptop Intel i7 1355U").find((x) => x.key === "cpu")?.value).toBe("i7"));
  it("battery capacity", () => expect(extractSpecs("Telefon 5000mAh").find((x) => x.key === "battery")?.value).toBe("5000"));
  it("returns nothing when the title states nothing", () => expect(extractSpecs("Cablu USB").length).toBe(0));
});
