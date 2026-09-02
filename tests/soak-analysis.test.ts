// The soak runs unattended for two weeks. The one failure it cannot survive is a reader that
// quietly stops reading: "no invariant changed state" is what a working reader prints on a calm
// fortnight AND what a broken one prints on a catastrophic one. Those two outputs are
// identical, so the detection is tested against fabricated histories that each contain a
// specific defect on purpose.
//
// This is the same lesson as `doseTokens`, which had never matched anything, and as the DCNeu
// log line that truthfully said "Discovered 90 leaf categories" every night while hiding half
// the shop: a check nobody has ever seen fire is not known to work.

import { describe, it, expect } from "./run";
import {
  deadSources,
  invariantTransitions,
  missingNights,
  writeMoves,
  type NightInvariants,
} from "../src/lib/soak-analysis";

const inv = (pairs: [string, boolean][]): NightInvariants => new Map(pairs);

describe("soak: invariant transitions", () => {
  it("reports nothing when every night agrees", () => {
    const t = invariantTransitions([
      { date: "2026-09-01", invariants: inv([["a", true], ["b", false]]) },
      { date: "2026-09-02", invariants: inv([["a", true], ["b", false]]) },
      { date: "2026-09-03", invariants: inv([["a", true], ["b", false]]) },
    ]);
    expect(t.length).toBe(0);
  });

  it("dates the night a green check went red", () => {
    const t = invariantTransitions([
      { date: "2026-09-01", invariants: inv([["a", true]]) },
      { date: "2026-09-02", invariants: inv([["a", true]]) },
      { date: "2026-09-03", invariants: inv([["a", false]]) },
    ]);
    expect(t.length).toBe(1);
    expect(t[0].date).toBe("2026-09-03");
    expect(t[0].to).toBe(false);
  });

  it("reports a recovery as well as a break", () => {
    const t = invariantTransitions([
      { date: "2026-09-01", invariants: inv([["a", true]]) },
      { date: "2026-09-02", invariants: inv([["a", false]]) },
      { date: "2026-09-03", invariants: inv([["a", true]]) },
    ]);
    expect(t.length).toBe(2);
    expect(t[0].to).toBe(false);
    expect(t[1].to).toBe(true);
  });

  it("a check that DISAPPEARS is a transition, not a silence", () => {
    // An audit that stops reporting an invariant looks, in a green summary, exactly like an
    // invariant that is holding. That is the whole class of bug this project keeps finding.
    const t = invariantTransitions([
      { date: "2026-09-01", invariants: inv([["a", true], ["b", true]]) },
      { date: "2026-09-02", invariants: inv([["a", true]]) },
    ]);
    expect(t.length).toBe(1);
    expect(t[0].name).toBe("b");
    expect(t[0].to).toBe(null);
  });

  it("a check appearing for the first time is not a transition", () => {
    const t = invariantTransitions([
      { date: "2026-09-01", invariants: inv([["a", true]]) },
      { date: "2026-09-02", invariants: inv([["a", true], ["new", false]]) },
    ]);
    expect(t.length).toBe(0);
  });
});

describe("soak: offers-written moves", () => {
  const night = (date: string, n: number) => ({ date, merchants: [{ slug: "metro", offersWritten: n }] });

  it("ignores a move inside the threshold", () => {
    expect(writeMoves([night("2026-09-01", 1000), night("2026-09-02", 1100)]).length).toBe(0);
  });

  it("catches a collapse and reports the day it came from", () => {
    const m = writeMoves([night("2026-09-01", 1000), night("2026-09-02", 400)]);
    expect(m.length).toBe(1);
    expect(m[0].date).toBe("2026-09-02");
    expect(m[0].fromDate).toBe("2026-09-01");
    expect(Math.round(m[0].pct)).toBe(-60);
  });

  it("catches a jump upward too — a merchant doubling overnight is also news", () => {
    const m = writeMoves([night("2026-09-01", 1000), night("2026-09-02", 2500)]);
    expect(m.length).toBe(1);
    expect(Math.round(m[0].pct)).toBe(150);
  });

  it("does not make a zero night the baseline for the next comparison", () => {
    // Otherwise every recovery from a dead source divides by zero. The -100% is reported once;
    // the return is then measured against the last night that actually wrote something.
    const m = writeMoves([night("2026-09-01", 1000), night("2026-09-02", 0), night("2026-09-03", 1000)]);
    expect(m.length).toBe(1);
    expect(Math.round(m[0].pct)).toBe(-100);
  });

  it("says nothing about a merchant that has never written", () => {
    const m = writeMoves([night("2026-09-01", 0), night("2026-09-02", 0)]);
    expect(m.length).toBe(0);
  });
});

describe("soak: dead sources", () => {
  const n = (date: string, hours: number | null, claims: string[] = []) => ({
    date,
    liveness: { merchants: [{ slug: "metro", hoursSinceWrite: hours }], claimsWithoutWrites: claims },
  });

  it("is silent while a merchant keeps writing", () => {
    expect(deadSources([n("2026-09-01", 12), n("2026-09-02", 20)]).length).toBe(0);
  });

  it("fires at 48 hours", () => {
    const d = deadSources([n("2026-09-01", 47.9), n("2026-09-02", 48)]);
    expect(d.length).toBe(1);
    expect(d[0].date).toBe("2026-09-02");
    expect(d[0].kind).toBe("silent");
  });

  it("reports a run that claimed success and wrote nothing", () => {
    // The Metro/Mega shape exactly: lastScrapeAt updated, no offer row carrying the date.
    const d = deadSources([n("2026-09-01", 10, ["megaimage"])]);
    expect(d.length).toBe(1);
    expect(d[0].kind).toBe("claims-without-writes");
    expect(d[0].slug).toBe("megaimage");
  });

  it("treats an unknown last-write as unknown, not as dead", () => {
    // A merchant with no observation date at all has never written; inventing a silence for it
    // would put a brand-new merchant in the alarm on its first night.
    expect(deadSources([n("2026-09-01", null)]).length).toBe(0);
  });
});

describe("soak: missing nights", () => {
  it("finds the hole in the middle", () => {
    expect(missingNights(["2026-09-01", "2026-09-02", "2026-09-04"])).toEqual(["2026-09-03"]);
  });

  it("reports nothing for a continuous run", () => {
    expect(missingNights(["2026-09-01", "2026-09-02", "2026-09-03"]).length).toBe(0);
  });

  it("reports nothing when there is nothing to compare", () => {
    expect(missingNights([]).length).toBe(0);
    expect(missingNights(["2026-09-01"]).length).toBe(0);
  });

  it("spans a month boundary", () => {
    expect(missingNights(["2026-08-30", "2026-09-02"])).toEqual(["2026-08-31", "2026-09-01"]);
  });
});
