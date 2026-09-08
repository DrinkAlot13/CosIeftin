// TWO LISTS, ONE QUESTION — never again.
//
// `DESCRIPTORS` says a word does not distinguish two products. `VARIANT_MARKERS` says it does.
// A word in both makes the matcher's behaviour depend on which rule happens to run first, and
// that is how `feliat` briefly ended up meaning two things at once: the descriptor exemption
// cleared mutual distinction and `variant-mismatch` blocked it two lines later.
//
// The same shape as CLAUDE.md's "one vocabulary per column" rule, in the matcher rather than the
// schema. Whichever list a word belongs in, it belongs in exactly one.
import { describe, it, expect } from "./run";
import { DESCRIPTORS } from "../src/lib/matching/descriptors";
import { variantTokens } from "../src/lib/scrape-util";

describe("descriptors and variant markers are disjoint", () => {
  it("no descriptor is also a variant marker", () => {
    const overlap = Object.keys(DESCRIPTORS).filter((t) => variantTokens(new Set([t])).size > 0);
    expect(overlap.join(",")).toBe("");
  });

  it("no descriptor is also an ALCOHOL variant marker", () => {
    const overlap = Object.keys(DESCRIPTORS).filter((t) => variantTokens(new Set([t]), "alcohol").size > 0);
    expect(overlap.join(",")).toBe("");
  });
});
