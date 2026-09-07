// PICKING THE PHOTOGRAPH OUT OF AN <img> TAG.
//
// Three scrapers read `src` first and `data-src` second. On a lazy-loading site `src` is the
// site's own spinner until JavaScript swaps the real URL in — so the fallback never ran, and
// 851 of Carrefour's 2,165 live products stored
//
//     https://cdn-media.carrefour.ro/media/Carrefour/lazyload/default/AjaxLoader_1.gif
//
// which returns HTTP 200 and animates forever. `onError` cannot fire on it, no liveness check
// can see it, and every audit that counts non-null images called those rows complete.
//
// The other half was the URL join: `x.startsWith("http") ? x : BASE + x` produced
// `https://www.penny.ro/data:image/jpeg;base64,…` — a data URI glued onto an origin, which the
// browser refuses outright (ERR_BLOCKED_BY_ORB). Observed live, twice, on /oferte.
//
// Both are now one decision in one place, and this is what it must do.

import { describe, it, expect } from "./run";
import { pickImageUrl, pickFromSrcset, resolveImageUrl } from "../src/lib/image-src";
import { imageUrlToStore } from "../src/lib/placeholder-image";

const BASE = "https://carrefour.ro";
const SPINNER = "https://cdn-media.carrefour.ro/media/Carrefour/lazyload/default/AjaxLoader_1.gif";
const REAL = "https://cdn-media.carrefour.ro/media/produs/12345.jpg";

describe("image source — the lazy-load trap", () => {
  it("prefers data-src over a src that is the site's spinner", () => {
    expect(pickImageUrl({ src: SPINNER, "data-src": REAL }, BASE)).toBe(REAL);
  });

  it("still uses src when the site does not lazy-load", () => {
    expect(pickImageUrl({ src: REAL }, BASE)).toBe(REAL);
  });

  it("returns null rather than storing a spinner when that is all there is", () => {
    expect(pickImageUrl({ src: SPINNER }, BASE)).toBe(null);
  });

  it("skips a lazy attribute that itself holds a placeholder", () => {
    expect(pickImageUrl({ "data-src": SPINNER, src: REAL }, BASE)).toBe(REAL);
  });

  it("resolves a root-relative URL against the site", () => {
    expect(pickImageUrl({ "data-src": "/media/p/9.jpg" }, BASE)).toBe("https://carrefour.ro/media/p/9.jpg");
  });

  it("resolves a protocol-relative URL", () => {
    expect(pickImageUrl({ "data-src": "//cdn.example.com/p.jpg" }, BASE)).toBe("https://cdn.example.com/p.jpg");
  });

  it("returns null for an empty tag", () => {
    expect(pickImageUrl({}, BASE)).toBe(null);
    expect(pickImageUrl({ src: "", "data-src": null }, BASE)).toBe(null);
  });
});

describe("image source — srcset", () => {
  it("takes the widest candidate, not the last", () => {
    const ss = "https://x.ro/small.jpg 320w, https://x.ro/huge.jpg 1280w, https://x.ro/mid.jpg 640w";
    expect(pickFromSrcset(ss)).toBe("https://x.ro/huge.jpg");
  });

  it("handles pixel-density descriptors", () => {
    expect(pickFromSrcset("https://x.ro/1x.jpg 1x, https://x.ro/2x.jpg 2x")).toBe("https://x.ro/2x.jpg");
  });

  it("accepts a single entry with no descriptor", () => {
    expect(pickFromSrcset("https://x.ro/only.jpg")).toBe("https://x.ro/only.jpg");
  });

  it("is null for empty input", () => {
    expect(pickFromSrcset("")).toBe(null);
    expect(pickFromSrcset(null)).toBe(null);
  });

  it("is used when it is the best attribute available", () => {
    expect(pickImageUrl({ src: SPINNER, srcset: "https://x.ro/a.jpg 300w, https://x.ro/b.jpg 900w" }, BASE))
      .toBe("https://x.ro/b.jpg");
  });
});

describe("image source — the data: URI glued onto an origin", () => {
  it("never joins a data URI onto the site base", () => {
    expect(resolveImageUrl("data:image/jpeg;base64,iVBORw0KGgo=", "https://www.penny.ro")).toBe(null);
  });

  it("refuses a URL that already has one glued on", () => {
    expect(imageUrlToStore("https://www.penny.ro/data:image/jpeg;base64,iVBORw0KGgo=")).toBe(null);
  });

  it("refuses a bare data URI at the write gate", () => {
    expect(imageUrlToStore("data:image/gif;base64,R0lGOD")).toBe(null);
  });

  it("picks nothing at all rather than a data URI", () => {
    expect(pickImageUrl({ src: "data:image/gif;base64,R0lGOD" }, "https://www.penny.ro")).toBe(null);
  });
});

describe("the write gate — a placeholder stored is worse than null", () => {
  it("refuses a spinner", () => {
    expect(imageUrlToStore(SPINNER)).toBe(null);
  });

  it("refuses a bare origin with no file", () => {
    expect(imageUrlToStore("https://carrefour.ro/")).toBe(null);
    expect(imageUrlToStore("https://carrefour.ro")).toBe(null);
  });

  it("refuses a non-http scheme", () => {
    expect(imageUrlToStore("ftp://example.com/p.jpg")).toBe(null);
    expect(imageUrlToStore("javascript:alert(1)")).toBe(null);
  });

  it("refuses unparseable input", () => {
    expect(imageUrlToStore("not a url at all")).toBe(null);
  });

  it("keeps a self-hosted path", () => {
    expect(imageUrlToStore("/product-images/abc.jpg")).toBe("/product-images/abc.jpg");
  });

  it("keeps a real remote photograph", () => {
    expect(imageUrlToStore(REAL)).toBe(REAL);
  });

  it("treats null and empty as null, not as a value", () => {
    expect(imageUrlToStore(null)).toBe(null);
    expect(imageUrlToStore("")).toBe(null);
    expect(imageUrlToStore("   ")).toBe(null);
  });
});
