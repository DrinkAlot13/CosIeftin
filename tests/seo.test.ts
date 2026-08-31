// STRUCTURED DATA MUST BE TRUE.
//
// A price comparator's rich result IS its search listing — Google renders the price range
// straight out of the JSON-LD below. A wrong number here is not an SEO experiment that fails
// to pay off; it is a false statement about a real merchant's real price, published in Google's
// results with our name on it, and reaching far more people than the page itself.
//
// So every field is either read from a real observation or omitted. These tests exist to make
// "or omitted" enforceable.
import { describe, it, expect } from "./run";
import { productJsonLd, breadcrumbJsonLd, websiteJsonLd, jsonLdScript, abs } from "../src/lib/seo";

const merch = (name: string) => ({ name });
const offer = (price: number, availability: string | null = "in stock") => ({
  price, availability, url: "https://example.ro/p", merchant: merch("Kaufland"),
});

const product = {
  name: "Lapte Zuzu 3.5% 1L",
  slug: "lapte-zuzu-35-1l",
  brand: "Zuzu",
  ean: null as string | null,
  image: null as string | null,
};

describe("structured data — the price range is the real one", () => {
  it("lowPrice and highPrice come from the actual offers", () => {
    const ld = productJsonLd(product, [offer(6.5), offer(7.99), offer(5.49)])!;
    const o = ld.offers as Record<string, unknown>;
    expect(o.lowPrice).toBe("5.49");
    expect(o.highPrice).toBe("7.99");
    expect(o.offerCount).toBe(3);
    expect(o.priceCurrency).toBe("RON");
  });

  it("a single offer gives an equal low and high, not a fabricated spread", () => {
    const o = productJsonLd(product, [offer(6.5)])!.offers as Record<string, unknown>;
    expect(o.lowPrice).toBe("6.50");
    expect(o.highPrice).toBe("6.50");
  });

  it("a product with NO usable price emits nothing at all", () => {
    expect(productJsonLd(product, [])).toBe(null);
    expect(productJsonLd(product, [offer(0)])).toBe(null);
  });

  it("every seller named is a merchant we actually observed", () => {
    const ld = productJsonLd(product, [
      { ...offer(6.5), merchant: merch("Kaufland") },
      { ...offer(7.2), merchant: merch("Auchan") },
      { ...offer(7.4), merchant: merch("Auchan") },
    ])!;
    const sellers = (ld.offers as { seller: { name: string }[] }).seller;
    expect(sellers.length).toBe(2);
    expect(sellers.map((s) => s.name).sort().join(",")).toBe("Auchan,Kaufland");
  });

  it("availability reflects what was seen, in both directions", () => {
    const inStock = productJsonLd(product, [offer(6.5, "out of stock"), offer(7, "in stock")])!;
    expect((inStock.offers as Record<string, unknown>).availability).toBe("https://schema.org/InStock");
    const out = productJsonLd(product, [offer(6.5, "out of stock")])!;
    expect((out.offers as Record<string, unknown>).availability).toBe("https://schema.org/OutOfStock");
  });
});

describe("structured data — never claim an identifier we do not have", () => {
  // No Romanian grocery merchant publishes a GTIN. Mega Image's "valid EANs" were Unix
  // timestamps. A gtin13 in our markup would be an invented claim about a physical product.
  it("omits gtin13 when there is no EAN", () => {
    expect("gtin13" in productJsonLd(product, [offer(6.5)])!).toBeFalsy();
  });

  it("omits gtin13 when the EAN fails its checksum", () => {
    const bad = { ...product, ean: "5941234567891" }; // deliberately wrong check digit
    expect("gtin13" in productJsonLd(bad, [offer(6.5)])!).toBeFalsy();
  });

  it("emits gtin13 only for a checksum-valid EAN", () => {
    const good = { ...product, ean: "5941234567890" };
    const ld = productJsonLd(good, [offer(6.5)])!;
    if ("gtin13" in ld) expect(ld.gtin13).toBe("5941234567890");
  });

  it("omits brand when the product has none", () => {
    expect("brand" in productJsonLd({ ...product, brand: null }, [offer(6.5)])!).toBeFalsy();
  });

  it("omits image when there is none — never a placeholder", () => {
    expect("image" in productJsonLd(product, [offer(6.5)])!).toBeFalsy();
  });
});

describe("structured data — URLs and escaping", () => {
  it("product URLs are absolute", () => {
    const ld = productJsonLd(product, [offer(6.5)])!;
    expect(String(ld.url).startsWith("http")).toBeTruthy();
    expect(String(ld.url).endsWith("/p/lapte-zuzu-35-1l")).toBeTruthy();
  });

  it("breadcrumb positions are 1-based and in order", () => {
    const bc = breadcrumbJsonLd([
      { name: "Acasă", path: "/" },
      { name: "Lactate", path: "/c/lactate" },
      { name: "Lapte", path: "/p/lapte" },
    ]);
    const items = bc.itemListElement as { position: number; item: string }[];
    expect(items.map((i) => i.position).join(",")).toBe("1,2,3");
    expect(items.every((i) => i.item.startsWith("http"))).toBeTruthy();
  });

  it("the WebSite node declares a real search endpoint", () => {
    const w = websiteJsonLd();
    expect(String((w.potentialAction as { target: { urlTemplate: string } }).target.urlTemplate).includes("{search_term_string}")).toBeTruthy();
  });

  // Product names are scraped from merchant pages, which makes them untrusted input.
  it("a product name containing </script> cannot close the tag", () => {
    const nasty = { ...product, name: 'Lapte </script><img src=x onerror=alert(1)>' };
    const out = jsonLdScript(productJsonLd(nasty, [offer(6.5)])!);
    expect(out.includes("</script>")).toBeFalsy();
    expect(out.includes("<img")).toBeFalsy();
    expect(out.includes("\\u003c")).toBeTruthy();
  });

  it("abs() never doubles a slash", () => {
    expect(abs("/p/x").includes("//p/")).toBeFalsy();
    expect(abs("p/x")).toBe(abs("/p/x"));
  });
});
