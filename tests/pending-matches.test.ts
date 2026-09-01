// The REVIEW band, and the ranking that decides which of thousands to look at first.
//
// These were computed and discarded for the whole life of the matcher: `if (!d.ok) continue`,
// where `ok` is true only for AUTO_MATCH. Persisting them is only half the job — with
// thousands queued, reviewing in database order spends the first evening on the least valuable
// half, so the ordering is as load-bearing as the storage.
import { describe, it, expect } from "./run";
import { rankValue } from "../src/lib/pending-matches";

describe("pending queue — a comparison that does not exist yet outranks everything", () => {
  it("1 -> 2 merchants beats 4 -> 5, even at a lower score", () => {
    const creates = rankValue({ merchantsNow: 1, createsComparison: true, spreadBani: 0, score: 0.45 });
    const adds = rankValue({ merchantsNow: 4, createsComparison: false, spreadBani: 5000, score: 0.95 });
    expect(creates > adds).toBeTruthy();
  });

  it("…and a large price spread cannot buy its way past that", () => {
    const creates = rankValue({ merchantsNow: 1, createsComparison: true, spreadBani: 0, score: 0.42 });
    const huge = rankValue({ merchantsNow: 2, createsComparison: false, spreadBani: 999_999, score: 1 });
    expect(creates > huge).toBeTruthy();
  });

  it("breadth diminishes: the 2nd merchant is worth more than the 6th", () => {
    const second = rankValue({ merchantsNow: 1, createsComparison: false, spreadBani: 0, score: 0.5 });
    const sixth = rankValue({ merchantsNow: 5, createsComparison: false, spreadBani: 0, score: 0.5 });
    expect(second > sixth).toBeTruthy();
  });

  it("a wider price spread ranks higher, all else equal", () => {
    const wide = rankValue({ merchantsNow: 2, createsComparison: false, spreadBani: 2000, score: 0.5 });
    const narrow = rankValue({ merchantsNow: 2, createsComparison: false, spreadBani: 50, score: 0.5 });
    expect(wide > narrow).toBeTruthy();
  });

  it("one outlier price cannot own the whole queue", () => {
    // A mis-parsed price must not push a worthless candidate to the top of the list.
    const absurd = rankValue({ merchantsNow: 4, createsComparison: false, spreadBani: 100_000_000, score: 0.42 });
    const creates = rankValue({ merchantsNow: 1, createsComparison: true, spreadBani: 0, score: 0.42 });
    expect(creates > absurd).toBeTruthy();
  });

  it("confidence breaks ties and nothing more", () => {
    const high = rankValue({ merchantsNow: 3, createsComparison: false, spreadBani: 100, score: 0.9 });
    const low = rankValue({ merchantsNow: 3, createsComparison: false, spreadBani: 100, score: 0.45 });
    expect(high > low).toBeTruthy();
    // …but a better score never beats creating a comparison
    const bestScoreNoComparison = rankValue({ merchantsNow: 3, createsComparison: false, spreadBani: 100, score: 1 });
    const worstScoreComparison = rankValue({ merchantsNow: 1, createsComparison: true, spreadBani: 0, score: 0 });
    expect(worstScoreComparison > bestScoreNoComparison).toBeTruthy();
  });

  it("a missing spread is treated as zero, not NaN", () => {
    expect(Number.isFinite(rankValue({ merchantsNow: 1, createsComparison: true, spreadBani: null, score: 0.5 }))).toBeTruthy();
  });
});

describe("pending matches are not offers", () => {
  it("the model is never joined into an offer query", () => {
    // A PendingMatch must not reach a shopper, the optimizer, or a count. The guard is that
    // nothing outside the admin path and its own library reads the table.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        const rel = full.split(path.sep).join("/");
        if (rel.includes("/lib/pending-matches") || rel.includes("/admin/matches") || rel.includes("/scrape-util")) continue;
        if (fs.readFileSync(full, "utf8").includes("pendingMatch")) offenders.push(rel.split("/src/")[1] ?? rel);
      }
    };
    walk(path.join(process.cwd(), "src"));
    if (offenders.length) {
      throw new Error(
        "PendingMatch is read outside the admin review path — it must never reach a shopper, " +
        "the optimizer, or a count:\n  " + offenders.join("\n  "),
      );
    }
    expect(offenders.length).toBe(0);
  });
});
