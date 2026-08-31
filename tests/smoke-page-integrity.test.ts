// Every asset and internal link a page references must actually resolve.
//
// This exists because of a real outage that looked like an application bug and was not. The
// DCNeu category page threw "Application error: a client-side exception has occurred" on most
// loads, clearing after a few refreshes. Two plausible data explanations were proposed — a null
// priceBani sorting first under price-asc, and a hydration mismatch on time-derived state.
// Both were wrong. The browser console said:
//
//     ChunkLoadError: Loading chunk 954 failed.
//     (error: /_next/static/chunks/app/dcneu/page-f460d9d75c49c945.js)   -> 404
//     Error: Minified React error #423
//
// React #423 is the SYMPTOM — "recovered by re-rendering the root synchronously". The cause was
// that the running server had booted from a build which a later `npm run build` replaced, so it
// served HTML referencing assets its build id no longer matched. Intermittent because Next
// retries a failed chunk; self-clearing because a retry sometimes wins.
//
// The old smoke test could not catch it: it fetched only the FIRST stylesheet. So this one walks
// EVERY script, stylesheet and preload the served HTML references, plus every internal link, and
// demands each return 200. It would also have caught the /cookies link that had never existed —
// Next prefetches every visible Link, so a cookie banner on every page 404'd on every page load.
import { describe, it, expect } from "./run";

const BASE = process.env.SMOKE_URL ?? "http://localhost:3200";
const REQUIRE_SERVER = process.env.SMOKE_REQUIRE === "1";

/** Pages worth checking: the homepage, a category page, and the URL that actually broke. */
const PAGES = [
  "/",
  "/dcneu?cat=dcneu-anticalcar-pudra&sort=price-asc",
  "/despre",
];

type Page = { up: boolean; status: number; html: string; url: string };

const cache = new Map<string, Promise<Page>>();
function load(path: string): Promise<Page> {
  let p = cache.get(path);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(BASE + path, { signal: AbortSignal.timeout(20000) });
        return { up: true, status: res.status, html: await res.text(), url: BASE + path };
      } catch {
        return { up: false, status: 0, html: "", url: BASE + path };
      }
    })();
    cache.set(path, p);
  }
  return p;
}

function ready(p: Page): boolean {
  if (p.up) return true;
  if (REQUIRE_SERVER) throw new Error(`no server at ${BASE} and SMOKE_REQUIRE=1`);
  return false;
}

/** Every asset the document tells the browser to fetch. */
function assetUrls(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) out.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"[^>]*rel="(?:stylesheet|preload)"/g)) out.add(m[1]);
  for (const m of html.matchAll(/<link[^>]+rel="(?:stylesheet|preload)"[^>]*href="([^"]+)"/g)) out.add(m[1]);
  return [...out].filter((u) => u.startsWith("/") || u.startsWith(BASE));
}

/** Internal hrefs the page links to — Next prefetches these, so a 404 fires on every load. */
function internalLinks(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="(\/[^"#?]*)"/g)) {
    const href = m[1];
    if (href.startsWith("/_next") || href.startsWith("/api")) continue;
    out.add(href);
  }
  return [...out];
}

async function statusOf(u: string): Promise<number> {
  const url = u.startsWith("http") ? u : BASE + u;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return r.status;
  } catch {
    return 0;
  }
}

describe("page integrity — every referenced asset resolves", () => {
  it("server is reachable (assertions skip when it is not)", async () => {
    const p = await load("/");
    if (!p.up) console.log(`      (no server at ${BASE} — page-integrity assertions skipped)`);
    expect(true).toBeTruthy();
  });

  for (const path of PAGES) {
    it(`${path} — returns 200`, async () => {
      const p = await load(path);
      if (!ready(p)) return;
      expect(p.status).toBe(200);
    });

    it(`${path} — no "Application error" in the served HTML`, async () => {
      const p = await load(path);
      if (!ready(p)) return;
      expect(/Application error|client-side exception/i.test(p.html)).toBeFalsy();
    });

    it(`${path} — every script and stylesheet it references returns 200`, async () => {
      const p = await load(path);
      if (!ready(p)) return;
      const assets = assetUrls(p.html);
      expect(assets.length > 0).toBeTruthy();
      const broken: string[] = [];
      for (const a of assets) {
        const s = await statusOf(a);
        if (s !== 200) broken.push(`${s || "unreachable"}  ${a}`);
      }
      if (broken.length) {
        throw new Error(
          `${broken.length}/${assets.length} assets referenced by ${path} do not resolve — the ` +
          `browser will throw ChunkLoadError and React will blank the page:\n  ` + broken.join("\n  "),
        );
      }
      expect(broken.length).toBe(0);
    });
  }

  it("no page links to a route that does not exist", async () => {
    const p = await load("/");
    if (!ready(p)) return;
    const links = internalLinks(p.html);
    expect(links.length > 3).toBeTruthy();
    const broken: string[] = [];
    for (const l of links) {
      const s = await statusOf(l);
      // 404 is the failure. Redirects and auth-gated pages are fine.
      if (s === 404 || s === 0) broken.push(`${s || "unreachable"}  ${l}`);
    }
    if (broken.length) {
      throw new Error(
        `${broken.length} internal link(s) 404. Next prefetches every visible Link, so a broken ` +
        `one in a global component fires on EVERY page load:\n  ` + broken.join("\n  "),
      );
    }
    expect(broken.length).toBe(0);
  });
});
