// Reading a confirm rate, with the thresholds fixed in advance.
//
// The point of instrumenting the queue is that 100 decisions should produce a MEASUREMENT, not
// 100 cleared rows. And the reading has to be agreed before the number arrives, or it gets
// rationalised after: above ~40% the `mutually-distinct` rule is rejecting real matches and the
// fix belongs in the matcher; below ~15% the rule is doing its job and the queue is mostly
// genuine rejections.
import { describe, it, expect } from "./run";
import { verdictFor, TOO_AGGRESSIVE_ABOVE, WORKING_BELOW } from "../src/lib/match-stats";

describe("confirm rate — the reading is fixed before the data arrives", () => {
  it("a high confirm rate means the rule is too aggressive", () => {
    expect(verdictFor(0.55, 100)).toBe("too aggressive");
    expect(verdictFor(TOO_AGGRESSIVE_ABOVE + 0.01, 100)).toBe("too aggressive");
  });

  it("a low confirm rate means the rule is working", () => {
    expect(verdictFor(0.05, 100)).toBe("working");
    expect(verdictFor(WORKING_BELOW - 0.01, 100)).toBe("working");
  });

  it("the middle is explicitly NOT a verdict", () => {
    expect(verdictFor(0.25, 100)).toBe("not enough signal");
  });

  it("a small sample is never a verdict, however extreme the rate", () => {
    // Three confirms out of three is 100% and means nothing at all.
    expect(verdictFor(1, 3)).toBe("not enough signal");
    expect(verdictFor(0, 5)).toBe("not enough signal");
    expect(verdictFor(0.9, 29)).toBe("not enough signal");
    expect(verdictFor(0.9, 30)).toBe("too aggressive");
  });

  it("the boundaries are exclusive, so a rate exactly on one is not a verdict", () => {
    expect(verdictFor(TOO_AGGRESSIVE_ABOVE, 100)).toBe("not enough signal");
    expect(verdictFor(WORKING_BELOW, 100)).toBe("not enough signal");
  });

  it("zero decisions cannot produce a verdict", () => {
    expect(verdictFor(0, 0)).toBe("not enough signal");
  });
});
