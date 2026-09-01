// The check that would have caught Metro and Mega Image on 1 September instead of 3 September.
//
// The scenario is reconstructed exactly: a merchant whose stored offers are all correct, all
// carry prices, and are all presented as live — whose source has answered nothing for three
// days, and whose every run was refused by the drop guard doing its job.
import { describe, it, expect } from "./run";
import { computeLiveness, MAX_SILENCE_HOURS, formatSilence } from "../src/lib/liveness";

const HOUR = 3_600_000;
const NOW = new Date("2026-09-03T12:00:00Z");
const ago = (h: number): Date => new Date(NOW.getTime() - h * HOUR);

type Fixture = {
  id: number; slug: string; name: string;
  lastScrapeAt: Date | null;
  newestObserved: Date | null;
  live: number;
  runs: { aborted: boolean; offersParsed: number; abortReason: string | null }[];
};

function deps(rows: Fixture[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    merchants: async () => rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, lastScrapeAt: r.lastScrapeAt })),
    newestObservedAt: async (id: number) => byId.get(id)!.newestObserved,
    liveOfferCount: async (id: number) => byId.get(id)!.live,
    recentRuns: async (id: number, take: number) => byId.get(id)!.runs.slice(0, take),
  };
}

const HEALTHY: Fixture = {
  id: 1, slug: "carrefour", name: "Carrefour",
  lastScrapeAt: ago(6), newestObserved: ago(6), live: 2124,
  runs: [{ aborted: false, offersParsed: 3961, abortReason: null }],
};

// Metro as it actually stood on 3 September: correct data, live-looking offers, dead source.
const METRO_AS_IT_WAS: Fixture = {
  id: 2, slug: "metro", name: "Metro",
  lastScrapeAt: ago(72), newestObserved: ago(72), live: 5296,
  runs: [
    { aborted: true, offersParsed: 0, abortReason: "run refused: 0 offers < 60% of last 5296" },
    { aborted: true, offersParsed: 0, abortReason: "run refused: 0 offers < 60% of last 5296" },
    { aborted: true, offersParsed: 0, abortReason: "run refused: 0 offers < 60% of last 5296" },
    { aborted: false, offersParsed: 5245, abortReason: null },
  ],
};

describe("liveness — correct data is not evidence of a live source", () => {
  it("flags a merchant whose source has been dead for three days", async () => {
    const rows = await computeLiveness(deps([HEALTHY, METRO_AS_IT_WAS]), NOW);
    const metro = rows.find((r) => r.slug === "metro")!;
    expect(metro.dead).toBe(true);
    expect(Math.round(metro.hoursSinceWrite)).toBe(72);
  });

  it("does not flag the healthy merchant beside it", async () => {
    const rows = await computeLiveness(deps([HEALTHY, METRO_AS_IT_WAS]), NOW);
    expect(rows.find((r) => r.slug === "carrefour")!.dead).toBe(false);
  });

  it("counts the aborted runs as dead, because an abort is not a success", async () => {
    // The drop guard refusing an empty run IS the system working. It is also the system
    // producing nothing. Only the second fact matters to liveness.
    const rows = await computeLiveness(deps([METRO_AS_IT_WAS]), NOW);
    expect(rows[0].deadRunStreak).toBe(3);
    expect(rows[0].lastAbortReason).toContain("run refused");
  });

  it("the dead merchant's offers still LOOK completely healthy", async () => {
    // This is the whole point. 5,296 offers presented as live, all with correct prices.
    // Every correctness check in the project passes on this state.
    const rows = await computeLiveness(deps([METRO_AS_IT_WAS]), NOW);
    expect(rows[0].liveOffers).toBe(5296);
  });

  it("catches a scraper that claims to have run but wrote nothing", async () => {
    // lastScrapeAt is a claim the scraper makes about itself; an offer row is evidence.
    // A merchant that updates the claim and writes no row is the same silent absence in a
    // form the run record alone cannot show.
    const liar: Fixture = {
      id: 3, slug: "ghost", name: "Ghost",
      lastScrapeAt: ago(2), newestObserved: ago(96), live: 100,
      runs: [{ aborted: false, offersParsed: 0, abortReason: null }],
    };
    const rows = await computeLiveness(deps([liar]), NOW);
    expect(rows[0].claimsWithoutWrites).toBe(true);
    expect(rows[0].dead).toBe(true);
  });

  it("a merchant that has never written is dead, not unknown", async () => {
    const never: Fixture = {
      id: 4, slug: "new", name: "New", lastScrapeAt: null, newestObserved: null, live: 0, runs: [],
    };
    const rows = await computeLiveness(deps([never]), NOW);
    expect(rows[0].dead).toBe(true);
    expect(formatSilence(rows[0].hoursSinceWrite)).toBe("niciodată");
  });

  it("sorts oldest first, so the broken thing is the first thing seen", async () => {
    const rows = await computeLiveness(deps([HEALTHY, METRO_AS_IT_WAS]), NOW);
    expect(rows[0].slug).toBe("metro");
  });

  it("the alarm is the shorter of 48h and twice the cadence", () => {
    expect(MAX_SILENCE_HOURS).toBe(48);
  });
});
