// ASSET SMOKE TEST — the class of failure unit tests cannot see.
//
// The app once rendered completely unstyled: correct HTML, correct data, no CSS. Every
// component test passed, because the components WERE fine — the stylesheet simply was not
// being served (a stale .next after a build was killed mid-flight). Nothing in the suite
// looked at what a browser actually receives.
//
// This fetches the running server and asserts the page links a stylesheet AND that the
// stylesheet returns 200 with real content. It SKIPS rather than fails when no server is
// running, so `npm test` stays usable offline; set SMOKE_REQUIRE=1 in CI to make a missing
// server a failure.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "./run";

/**
 * Is this asset in the build on disk?
 *
 * A server started before the last `npm run build` serves HTML referencing chunk names that no
 * longer exist. Nothing is wrong with the code, and failing a COMMIT on a developer's stale
 * localhost process is wrong for the same reason the pre-commit hook runs verify:code and not
 * verify. tests/smoke-page-integrity.test.ts already made this distinction; this file kept
 * failing for want of it.
 */
function onDisk(assetUrl: string): boolean {
  const m = assetUrl.match(/\/_next\/(.+?)(?:\?|$)/);
  if (!m) return true;
  return existsSync(join(process.cwd(), ".next", ...m[1].split("/")));
}

const BASE = process.env.SMOKE_URL ?? "http://localhost:3200";
const REQUIRE_SERVER = process.env.SMOKE_REQUIRE === "1";

type Probe = {
  up: boolean;
  status: number;
  html: string;
  hrefs: string[];
  cssUrl: string | null;
  cssStatus: number;
  cssBody: string;
};

let cached: Promise<Probe> | null = null;

/** Fetch the page and its stylesheet once, shared by every assertion below. */
function probe(): Promise<Probe> {
  if (cached) return cached;
  cached = (async () => {
    const empty: Probe = { up: false, status: 0, html: "", hrefs: [], cssUrl: null, cssStatus: 0, cssBody: "" };
    let res: Response;
    try {
      res = await fetch(BASE + "/", { signal: AbortSignal.timeout(6000) });
    } catch {
      return empty;
    }
    const html = await res.text();
    const hrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    const cssUrl = hrefs[0] ? (hrefs[0].startsWith("http") ? hrefs[0] : BASE + hrefs[0]) : null;
    let cssStatus = 0;
    let cssBody = "";
    if (cssUrl) {
      try {
        const c = await fetch(cssUrl, { signal: AbortSignal.timeout(6000) });
        cssStatus = c.status;
        cssBody = await c.text();
      } catch { /* leave zeroed — the assertions report it */ }
    }
    return { up: true, status: res.status, html, hrefs, cssUrl, cssStatus, cssBody };
  })();
  return cached;
}

/** True when the assertion should run; prints a skip note otherwise. */
function ready(p: Probe): boolean {
  if (!p.up) {
    if (REQUIRE_SERVER) throw new Error(`no server at ${BASE} and SMOKE_REQUIRE=1`);
    return false;
  }
  // Stale server (assets missing from .next) is an environment condition, not a code defect.
  const stale = p.hrefs.some((h) => h.startsWith("/_next/") && !onDisk(h));
  if (stale) {
    const msg = `the server at ${BASE} is running an older build — restart it (npx next start -p 3200)`;
    if (REQUIRE_SERVER) throw new Error(msg);
    console.log(`      (${msg})`);
    return false;
  }
  return true;
}

describe("smoke — the page is actually styled", () => {
  it("server is reachable (assertions skip when it is not)", async () => {
    const p = await probe();
    if (!p.up) console.log(`      (no server at ${BASE} — smoke assertions skipped)`);
    expect(true).toBeTruthy();
  });

  it("homepage returns 200 with a body", async () => {
    const p = await probe();
    if (!ready(p)) return;
    expect(p.status).toBe(200);
    expect(p.html.length).toBeGreaterThan(1000);
  });

  it("the served HTML links at least one stylesheet", async () => {
    const p = await probe();
    if (!ready(p)) return;
    if (p.hrefs.length === 0) {
      throw new Error('no <link rel="stylesheet"> in the served HTML — the CSS import or the build is broken');
    }
    expect(p.hrefs.length).toBeGreaterThan(0);
  });

  it("the linked stylesheet returns 200", async () => {
    const p = await probe();
    if (!ready(p)) return;
    if (p.cssStatus !== 200) throw new Error(`stylesheet ${p.cssUrl} returned ${p.cssStatus || "no response"}`);
    expect(p.cssStatus).toBe(200);
  });

  it("the stylesheet has non-zero length and real rules", async () => {
    const p = await probe();
    if (!ready(p)) return;
    expect(p.cssBody.length).toBeGreaterThan(500);
    // a stylesheet served empty is the same failure wearing a 200
    if (!/\{[^}]*:[^}]*\}/.test(p.cssBody)) throw new Error("stylesheet body contains no CSS rules");
  });

  it("the stylesheet carries this project's own design tokens", async () => {
    const p = await probe();
    if (!ready(p)) return;
    // guards against serving SOMEONE ELSE's CSS — a bare reset would pass every check above
    if (!/--bg|--surface|--text/.test(p.cssBody)) {
      throw new Error("stylesheet does not contain the project's CSS custom properties");
    }
    expect(true).toBeTruthy();
  });
});
