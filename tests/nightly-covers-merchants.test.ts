// EVERY SCRAPER THAT EXISTS IS EITHER SCHEDULED OR DELIBERATELY NOT.
//
// The Glovo adapter was built, verified against the live site, committed, and never added to
// `scrape-all`'s list. It ran once by hand on 2 September and then nothing. Five days later the
// stats page showed it with 0 live offers beside an old abort reason, which read as "the
// fabrication guard is blocking it" — a plausible, wrong, and expensive-to-check story. The
// truth was that nothing had asked it to run.
//
// `audit:liveness` did notice the silence; what it could not say was WHY. "Dead because blocked"
// and "dead because unscheduled" are two different facts that arrived as one, which is this
// project's recurring shape at the level of the schedule rather than a column.
//
// So the schedule is checked against the scripts that exist. A new scraper must be listed in
// `scrape-all` or named in UNSCHEDULED with a reason — silence is no longer an option.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";

/**
 * Scrapers deliberately NOT in the nightly, each with the reason.
 *
 * Adding a name here is a decision that has to be written down; leaving one out of both this
 * list and `scrape-all` is the bug.
 */
const UNSCHEDULED: Record<string, string> = {
  selgros: "adapter exists, has not been through acceptance",
  monitorul: "a price index source, not a merchant catalog — no offers to write",
  store: "the generic adapter entry point, invoked by name from the others",
  "dcneu-tiers": "runs after scrape:all as its own nightly step",
  alcohol: "an alias that runs finestore + lemanoir + carrefour-alcohol, all listed",
  all: "this list itself",
};

describe("the nightly covers every scraper that exists", () => {
  it("every scrape:* script is scheduled or explicitly excused", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
    const scrapeScripts = Object.keys(pkg.scripts)
      .filter((k) => k.startsWith("scrape:"))
      .map((k) => k.slice("scrape:".length));

    const all = readFileSync(join(process.cwd(), "scripts/scrape-all.ts"), "utf8");
    const listed = new Set<string>();
    // Auchan is run first, on its own, as the catalog master.
    if (all.includes('runWithRetry("scrape:auchan")')) listed.add("auchan");
    const m = /const AFTER_AUCHAN = \[([^\]]*)\]/.exec(all);
    if (m) for (const q of m[1].split(",")) {
      const name = q.trim().replace(/^["']|["']$/g, "");
      if (name) listed.add(name);
    }

    const orphans = scrapeScripts.filter((s) => !listed.has(s) && !(s in UNSCHEDULED));
    if (orphans.length > 0) {
      throw new Error(
        `scraper(s) neither scheduled in scrape-all nor excused in UNSCHEDULED: ${orphans.join(", ")}. ` +
        `A scraper nothing runs is not a data source, and nothing else in the codebase says so.`,
      );
    }
    expect(orphans.length).toBe(0);
  });

  it("nothing is excused that is also scheduled — the two lists cannot both be right", () => {
    const all = readFileSync(join(process.cwd(), "scripts/scrape-all.ts"), "utf8");
    const both = Object.keys(UNSCHEDULED).filter((k) => new RegExp(`"${k}"`).test(all.split("const AFTER_AUCHAN")[1]?.split("]")[0] ?? ""));
    expect(both.length).toBe(0);
  });

  it("every adapter file is reachable from some entry point", () => {
    // NOT "has an npm script of its own" — that was this test's first version and it was wrong.
    // `adapters/glovo.ts` has no script named after it: it is reached through
    // `scripts/scrape-platform.ts`, which is the correct shape for a platform with several
    // stores behind one entry point. The property that matters is that SOMETHING imports it.
    const files = readdirSync(join(process.cwd(), "scripts"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => readFileSync(join(process.cwd(), "scripts", f), "utf8"))
      .join(" ");
    const runner = readFileSync(join(process.cwd(), "scripts/adapters/runner.ts"), "utf8");
    const haystack = `${files} ${runner}`;
    const adapters = readdirSync(join(process.cwd(), "scripts/adapters"))
      .filter((f) => f.endsWith(".ts") && !["runner.ts", "types.ts"].includes(f))
      .map((f) => f.replace(/\.ts$/, ""));
    const unreachable = adapters.filter((a) => !haystack.includes(a));
    if (unreachable.length > 0) {
      throw new Error(`adapter(s) nothing imports or names: ${unreachable.join(", ")}`);
    }
    expect(unreachable.length).toBe(0);
  });
});
