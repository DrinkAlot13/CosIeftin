// lib/push.ts's "unconfigured = safe no-op" posture — the same contract lib/telegram.ts and
// lib/email.ts already have, tested the same way.
import { describe, it, expect } from "./run";
import { pushConfigured, vapidPublicKey, sendPush } from "../src/lib/push";

describe("push — unconfigured means a safe no-op, never a throw", () => {
  it("reports not configured with no VAPID keys", () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    expect(pushConfigured()).toBeFalsy();
  });

  it("vapidPublicKey is null when unconfigured", () => {
    expect(vapidPublicKey()).toBe(null);
  });

  it("sendPush resolves false rather than throwing or sending", async () => {
    const ok = await sendPush({ id: 1, endpoint: "https://example.com/x", p256dh: "x", auth: "y" }, { title: "t", body: "b", url: "/" });
    expect(ok).toBeFalsy();
  });
});
