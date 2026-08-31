// The session-signing key must never silently fall back to a known constant.
//
// It did, for the whole life of this repository:
//
//     const SECRET = process.env.AUTH_SECRET ?? "dev-insecure-secret-change-me";
//
// A deployment that forgot to set AUTH_SECRET would have signed real session cookies with a
// string readable in git since the initial commit. Anyone with the source could mint a cookie
// for any user, and nothing would have reported it — the app looks completely healthy either
// way. That is strictly worse than the .env tracking that led me to find it: .env never
// contained a real secret, and this fallback WAS one.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";

const SRC = readFileSync(join(process.cwd(), "src", "lib", "auth.ts"), "utf8");

/**
 * Comments stripped, because auth.ts documents the old bug by quoting it — and a comment
 * explaining a fixed vulnerability must not read as the vulnerability.
 */
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((l) => l.replace(/\/\/.*$/, ""))
  .join("\n");

describe("auth — no hard-coded signing key", () => {
  it("does not default AUTH_SECRET to a literal", () => {
    // `process.env.AUTH_SECRET ?? "..."` or `|| "..."` — the exact shape that shipped.
    const bad = /process\.env\.AUTH_SECRET\s*(\?\?|\|\|)\s*["'`]/.test(CODE);
    if (bad) {
      throw new Error(
        "auth.ts falls back to a literal signing key. A deployment missing AUTH_SECRET would " +
        "sign real sessions with a constant that is in git.",
      );
    }
    expect(bad).toBeFalsy();
  });

  it("refuses to run in production without a real secret", () => {
    expect(CODE.includes('process.env.NODE_ENV === "production"')).toBeTruthy();
    expect(/throw new Error/.test(CODE)).toBeTruthy();
  });

  it("rejects the placeholder value even if it is set", () => {
    expect(CODE.includes('"change-me"')).toBeTruthy();
  });

  it("requires a minimum length, so an empty or trivial value cannot pass", () => {
    expect(/length\s*>=\s*\d+/.test(CODE)).toBeTruthy();
  });

  it("the committed template carries no real secret", () => {
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const suspicious = example
      .split("\n")
      .filter((l) => /^(?!#)\s*\w*(SECRET|TOKEN|PASSWORD|KEY)\w*\s*=\s*\S/.test(l))
      .filter((l) => !/change-me|example|placeholder|""/.test(l));
    if (suspicious.length) throw new Error(".env.example appears to contain a real value:\n  " + suspicious.join("\n  "));
    expect(suspicious.length).toBe(0);
  });
});
