// King.ro's category page embeds a full schema.org Product array as one JSON-LD blob in
// `<script type="application/ld+json" id="king-jsonld">` — server-rendered, no JS needed. This
// is the pure extraction, tested against a real captured page (no network).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import { extractItemList } from "../scripts/scrape-king";

const FIX = join(process.cwd(), "tests", "fixtures", "king");

describe("King.ro category-page JSON-LD extraction (fixture)", () => {
  const path = join(FIX, "vinuri-p1.html");
  const html = existsSync(path) ? readFileSync(path, "utf8") : "";
  const list = html ? extractItemList(html) : null;

  it("fixture exists (run: npm run scrape:king to re-capture)", () => expect(html.length).toBeGreaterThan(1000));
  it("finds the ItemList block", () => expect(!!list).toBeTruthy());
  it("reports the category's real total, not just this page's count", () =>
    expect(list!.numberOfItems).toBeGreaterThan(24));
  it("every item carries a name, url and a parseable offer price", () => {
    const items = list!.itemListElement ?? [];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((el) => !!el.item?.name && !!el.item?.url)).toBeTruthy();
    expect(items.every((el) => el.item?.offers?.price != null)).toBeTruthy();
  });

  it("returns null for a page with no king-jsonld script", () => expect(extractItemList("<html></html>")).toBe(null));
  it("returns null for malformed JSON rather than throwing", () =>
    expect(extractItemList('<script type="application/ld+json" id="king-jsonld">{not json</script>')).toBe(null));
  it("returns null when the array has no ItemList entry", () =>
    expect(extractItemList('<script type="application/ld+json" id="king-jsonld">[{"@type":"Organization"}]</script>')).toBe(null));
});
