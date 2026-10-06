// lib/email.ts's "unconfigured = safe no-op" posture — the same contract lib/telegram.ts's
// telegramConfigured() already has, tested the same way.
import { describe, it, expect } from "./run";
import { emailConfigured, sendEmail } from "../src/lib/email";

describe("email — unconfigured means a safe no-op, never a throw", () => {
  const restore = process.env.SMTP_HOST;

  it("reports not configured with no SMTP_HOST", () => {
    delete process.env.SMTP_HOST;
    expect(emailConfigured()).toBeFalsy();
  });

  it("sendEmail resolves false rather than throwing or sending", async () => {
    delete process.env.SMTP_HOST;
    const ok = await sendEmail({ to: "nobody@example.com", subject: "x", html: "<p>x</p>", text: "x" });
    expect(ok).toBeFalsy();
    if (restore === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = restore;
  });
});
