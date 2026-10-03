// THE v2 BASKET DEFINITION.
//
// v1 is tested next door and is unchanged: forty pinned product slugs, and any edit to it breaks
// the series on purpose. This is its successor — forty EQUIVALENCE CLASSES — and the properties
// that matter are different.
//
// The one that matters most: every line must name a class that ACTUALLY EXISTS in the seeder. A
// basket line pointing at a slug nobody defined resolves to nothing, and a line that resolves to
// nothing is silently dropped from the total. That is how a basket gets cheaper without any
// price moving, which is the failure this whole design is arranged around.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";
import { INDEX_BASKET_V2, BASKET_V2_VERSION, BASKET_V2_GROUPS } from "../src/lib/index-basket-v2";
import { INDEX_BASKET } from "../src/lib/index-basket";

/** Slugs the seeder defines, read from source — not from the database, which a test must not need. */
function seededSlugs(): Set<string> {
  const seed = readFileSync(join(process.cwd(), "scripts/seed-equivalence.ts"), "utf8");
  const produce = readFileSync(join(process.cwd(), "src/data/produce-classes.ts"), "utf8");
  const out = new Set<string>();
  for (const src of [seed, produce]) {
    for (const m of src.matchAll(/slug: "([a-z0-9-]+)"/g)) out.add(m[1]);
    // produce-classes builds its slugs through helpers: fresh("banane-kg", …)
    for (const m of src.matchAll(/(?:fresh|freshBio|herb)\("([a-z0-9-]+)"/g)) out.add(m[1]);
  }
  return out;
}

describe("Indexul CosIeftin — basket v2 definition", () => {
  it("is version 2", () => {
    expect(BASKET_V2_VERSION).toBe(2);
  });

  it("has 40 lines", () => {
    expect(INDEX_BASKET_V2.length).toBe(40);
  });

  it("every key is unique, so no need can be counted twice", () => {
    expect(new Set(INDEX_BASKET_V2.map((i) => i.key)).size).toBe(40);
  });

  it("every class slug is unique, so two lines cannot share one class", () => {
    // Two lines resolving to the same class would price the same product twice and call it a
    // basket of forty things.
    expect(new Set(INDEX_BASKET_V2.map((i) => i.classSlug)).size).toBe(40);
  });

  it("EVERY class slug is one the seeder actually defines", () => {
    const known = seededSlugs();
    const orphans = INDEX_BASKET_V2.filter((i) => !known.has(i.classSlug)).map((i) => `${i.key} → ${i.classSlug}`);
    if (orphans.length > 0) {
      throw new Error(
        `basket line(s) naming a class that no seeder defines: ${orphans.join(", ")}. ` +
        `Such a line resolves to nothing and vanishes from the total without anything failing.`,
      );
    }
    expect(orphans.length).toBe(0);
  });

  it("every line is filed under a group, so the page can show what is in the basket", () => {
    expect(INDEX_BASKET_V2.every((i) => i.group.trim().length > 0)).toBeTruthy();
    expect(BASKET_V2_GROUPS.length > 0).toBeTruthy();
  });

  it("keeps v1's keys for the needs that carried over, so the two can be read side by side", () => {
    // Side by side for a READER. Not comparable as numbers — that is the version boundary's job,
    // and the chart refuses to join them.
    const v1keys = new Set(INDEX_BASKET.map((i) => i.key));
    const shared = INDEX_BASKET_V2.filter((i) => v1keys.has(i.key)).length;
    // Both baskets cover the same forty needs; the definition of a line changed, not the need.
    expect(shared).toBe(40);
  });

  it("v1 is untouched — its history must stay meaningful", () => {
    expect(INDEX_BASKET.length).toBe(40);
    expect(INDEX_BASKET.every((i) => typeof i.slug === "string" && i.slug.length > 0)).toBeTruthy();
  });
});
