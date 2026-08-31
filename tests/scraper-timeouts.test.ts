// Every network call in a scraper must have an upper bound.
//
// This is not hypothetical. Tonight the DCNeu detail pass stopped dead at 5,500 of 6,034
// products, holding a socket that never resolved, consuming zero CPU, for over half an hour.
// `fetch` has no default timeout: it waits forever.
//
// The expensive part is what happens next. `scrape-all` runs stores in SEQUENCE, so that one
// stalled request also meant farmaciatei, kaufland and penny never ran. Nothing crashed, no
// error was logged, and the drop-guard never fired because no run ever completed to be judged.
// A nightly that silently does not finish is worse than one that fails, because failure is at
// least visible.
//
// A timeout turns an unbounded hang into a skipped page, which every scraper here already
// handles — they all treat a null/failed response as "move on".
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";

const SCRIPTS = join(process.cwd(), "scripts");

function scraperFiles(): string[] {
  const out = readdirSync(SCRIPTS)
    .filter((f) => f.startsWith("scrape-") && f.endsWith(".ts"))
    .map((f) => join(SCRIPTS, f));
  out.push(join(SCRIPTS, "adapters", "runner.ts"));
  return out;
}

const FILES = scraperFiles();
const short = (f: string): string => f.split(/[\\/]/).slice(-2).join("/");

describe("scrapers — no network call may hang forever", () => {
  it("finds the scrapers", () => expect(FILES.length > 8).toBeTruthy());

  it("every file that calls fetch() also bounds it", () => {
    const unbounded: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      const fetches = (src.match(/\bfetch\s*\(/g) ?? []).length;
      if (fetches === 0) continue;
      // Two idioms count, because both genuinely bound the call: AbortSignal.timeout(), and
      // the older AbortController + setTimeout(() => ctrl.abort()) pattern that
      // scrape-monitorul uses. Rejecting the second would be a style opinion dressed as a
      // safety check.
      const bounded =
        /AbortSignal\.timeout\s*\(/.test(src) ||
        (/new AbortController\(\)/.test(src) && /\.abort\(\)/.test(src));
      if (!bounded) unbounded.push(short(f));
    }
    if (unbounded.length) {
      throw new Error(
        `${unbounded.length} scraper(s) make unbounded network calls — one stalled socket stops ` +
        `the whole nightly, and the stores queued behind it never run:\n  ` + unbounded.join("\n  "),
      );
    }
    expect(unbounded.length).toBe(0);
  });

  it("the timeout is a real duration, not a placeholder", () => {
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      const m = src.match(/REQUEST_TIMEOUT_MS\s*=\s*([\d_]+)/);
      if (!m) continue;
      const ms = Number(m[1].split("_").join(""));
      // Long enough for a slow Romanian retail page, short enough that a stall is noticed
      // within one run rather than one night.
      expect(ms >= 5000).toBeTruthy();
      expect(ms <= 60000).toBeTruthy();
    }
  });

  // The failure mode a timeout must NOT introduce: a store whose pages all time out looks like
  // a store with no products, and retiring every offer on that basis would wipe real data. So
  // any scraper that can mark offers out of stock must ALSO be able to refuse a collapsed run.
  //
  // This is how scrape-auchan's missing guard was found. It marked all 9,000+ of its offers out
  // of stock BEFORE fetching a single page, and had no guard at all — on the catalog master and
  // the largest merchant, which is the worst place in the system for an unguarded wipe.
  it("a scraper that can retire offers can also refuse a collapsed run", () => {
    const unguarded: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      const retires = /out of stock/.test(src) && /updateMany/.test(src);
      if (!retires) continue;
      const guarded = /matchPoolToCatalog/.test(src) || /previousLive/.test(src) || /lastOfferCount/.test(src);
      if (!guarded) unguarded.push(short(f));
    }
    if (unguarded.length) {
      throw new Error(
        "scraper(s) can mark offers out of stock with no way to refuse a collapsed run:\n  " +
        unguarded.join("\n  "),
      );
    }
    expect(unguarded.length).toBe(0);
  });
});
