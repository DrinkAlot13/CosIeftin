// Password-reset tokens: never store the raw value, hash must be deterministic and
// collision-resistant enough in practice, and the raw token must be high-entropy.
import { describe, it, expect } from "./run";
import { createResetToken, hashResetToken } from "../src/lib/auth";

describe("password reset tokens", () => {
  it("the stored hash can be re-derived from the raw token alone", () => {
    const { raw, hash } = createResetToken();
    expect(hashResetToken(raw)).toBe(hash);
  });

  it("two tokens are never the same raw value", () => {
    const a = createResetToken();
    const b = createResetToken();
    expect(a.raw === b.raw).toBeFalsy();
    expect(a.hash === b.hash).toBeFalsy();
  });

  it("the raw token is url-safe (base64url), so it survives unescaped in a query string", () => {
    const { raw } = createResetToken();
    expect(/^[A-Za-z0-9_-]+$/.test(raw)).toBeTruthy();
  });

  it("the raw token is never literally the hash (hashing actually changes the value)", () => {
    const { raw, hash } = createResetToken();
    expect(raw === hash).toBeFalsy();
  });
});
