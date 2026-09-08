// RATE LIMITING — the behaviour, and the two ways it degrades.
//
// A limiter is the kind of code that looks obviously correct and silently does nothing: an
// off-by-one in the window, a key that accidentally collides, a budget that never resets. None
// of that shows up in a typecheck and none of it shows up in production until someone is
// already brute-forcing the login form.
//
// The two degradations are tested as explicitly as the happy path, because both are DELIBERATE
// and both weaken the guarantee:
//
//   • an unidentifiable caller shares one bucket with every other unidentifiable caller;
//   • `x-forwarded-for` is ignored unless TRUST_PROXY says a proxy is rewriting it.

import { describe, it, expect } from "./run";
import {
  rateLimit, clientIp, limitKey, LIMITS, effectiveMax,
  __resetRateLimitsForTest, tooManyRequests,
} from "../src/lib/rate-limit";

const h = (o: Record<string, string> = {}): Headers => new Headers(o);

describe("rate limit — the window", () => {
  it("allows exactly `max` requests and refuses the next", () => {
    __resetRateLimitsForTest();
    const now = 1_000_000;
    const max = LIMITS.login.max;
    for (let i = 0; i < max; i++) {
      expect(rateLimit("login", "1.2.3.4", now).ok).toBe(true);
    }
    expect(rateLimit("login", "1.2.3.4", now).ok).toBe(false);
  });

  it("resets once the window has passed", () => {
    __resetRateLimitsForTest();
    const now = 1_000_000;
    for (let i = 0; i < LIMITS.login.max + 5; i++) rateLimit("login", "1.2.3.4", now);
    expect(rateLimit("login", "1.2.3.4", now).ok).toBe(false);
    expect(rateLimit("login", "1.2.3.4", now + LIMITS.login.windowMs + 1).ok).toBe(true);
  });

  it("counts each caller separately", () => {
    __resetRateLimitsForTest();
    const now = 1_000_000;
    for (let i = 0; i < LIMITS.login.max + 5; i++) rateLimit("login", "1.2.3.4", now);
    expect(rateLimit("login", "1.2.3.4", now).ok).toBe(false);
    // A different address is untouched by the first one's exhaustion.
    expect(rateLimit("login", "5.6.7.8", now).ok).toBe(true);
  });

  it("never lets one named limit spend another's budget", () => {
    __resetRateLimitsForTest();
    const now = 1_000_000;
    for (let i = 0; i < LIMITS.register.max + 5; i++) rateLimit("register", "1.2.3.4", now);
    expect(rateLimit("register", "1.2.3.4", now).ok).toBe(false);
    // Registering too often must not lock the same person out of signing in.
    expect(rateLimit("login", "1.2.3.4", now).ok).toBe(true);
    expect(limitKey("login", "1.2.3.4") === limitKey("register", "1.2.3.4")).toBe(false);
  });

  it("reports a retry-after a client can act on", () => {
    __resetRateLimitsForTest();
    const now = 1_000_000;
    for (let i = 0; i < LIMITS.login.max + 1; i++) rateLimit("login", "9.9.9.9", now);
    const r = rateLimit("login", "9.9.9.9", now);
    expect(r.ok).toBe(false);
    expect(r.retryAfter > 0).toBe(true);
    expect(r.retryAfter <= Math.ceil(LIMITS.login.windowMs / 1000)).toBe(true);
    expect(tooManyRequests(r).status).toBe(429);
  });
});

describe("rate limit — an unidentifiable caller", () => {
  it("shares one bucket, and gets a larger budget so one caller cannot lock everyone out", () => {
    __resetRateLimitsForTest();
    const now = 1_000_000;
    const max = LIMITS.login.max;
    // The per-IP budget is exhausted long before the shared one is.
    for (let i = 0; i < max; i++) expect(rateLimit("login", null, now).ok).toBe(true);
    expect(rateLimit("login", null, now).ok).toBe(true);
    expect(rateLimit("login", null, now).shared).toBe(true);
  });

  it("still refuses eventually — shared is not unlimited", () => {
    __resetRateLimitsForTest();
    const now = 1_000_000;
    const shared = effectiveMax("login", null);
    for (let i = 0; i < shared; i++) rateLimit("login", null, now);
    expect(rateLimit("login", null, now).ok).toBe(false);
  });

  it("the shared budget is set PER LIMIT, and login's stays tight", () => {
    // A blanket multiple got this wrong in both directions: it made login 500 attempts per
    // quarter hour (not a limit) while nobody had asked what each endpoint actually needs.
    // These numbers are a judgement about legitimate concurrency and are meant to be argued
    // with — which requires that they be visible, so they are asserted here rather than
    // buried in a constant.
    expect(effectiveMax("login", null)).toBe(50);
    expect(effectiveMax("register", null)).toBe(20);
    expect(effectiveMax("write", null)).toBe(600);
    expect(effectiveMax("listAdd", null)).toBe(2_400);
  });

  it("a shared budget is never SMALLER than the per-caller one it replaces", () => {
    // Otherwise identifying a caller would make them worse off, which cannot be right.
    for (const name of ["login", "register", "listAdd", "write"] as const) {
      expect(effectiveMax(name, null) >= effectiveMax(name, "1.2.3.4")).toBe(true);
    }
  });
});

describe("rate limit — whose address do we believe", () => {
  it("ignores x-forwarded-for when TRUST_PROXY is not set", () => {
    const before = process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY;
    // An attacker who can set this header at will would otherwise get a fresh budget per
    // request, which is worse than no limiter because it looks like protection.
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4" })) === null).toBe(true);
    if (before !== undefined) process.env.TRUST_PROXY = before;
  });

  it("reads the LEFT-MOST forwarded address when TRUST_PROXY is set", () => {
    const before = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "1";
    // Left-most is the original client; everything after it is a proxy that added itself.
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" }))).toBe("1.2.3.4");
    expect(clientIp(h({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(clientIp(h()) === null).toBe(true);
    if (before === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = before;
  });
});
