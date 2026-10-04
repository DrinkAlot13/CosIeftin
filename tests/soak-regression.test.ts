import { describe, it, expect } from "./run";
import { findRegressions } from "../src/lib/soak-regression";

describe("soak regression — a check that WAS passing and now fails is news", () => {
  it("flags a check that went from passing to failing", () => {
    const { regressions } = findRegressions(
      [{ name: "audit:db", ok: true }],
      [{ name: "audit:db", ok: false }],
    );
    expect(regressions.length).toBe(1);
    expect(regressions[0].name).toBe("audit:db");
  });

  it("does not flag a check that was already failing — that is a standing state, not news", () => {
    const { regressions } = findRegressions(
      [{ name: "audit:db", ok: false }],
      [{ name: "audit:db", ok: false }],
    );
    expect(regressions.length).toBe(0);
  });

  it("reports a recovery separately from a regression", () => {
    const { regressions, recoveries } = findRegressions(
      [{ name: "audit:db", ok: false }],
      [{ name: "audit:db", ok: true }],
    );
    expect(regressions.length).toBe(0);
    expect(recoveries.length).toBe(1);
  });

  it("ignores a check that did not exist the night before — nothing to compare against", () => {
    const { regressions } = findRegressions(
      [],
      [{ name: "audit:db", ok: false }],
    );
    expect(regressions.length).toBe(0);
  });
});
