// ── MAY WE FETCH THIS? One implementation, because there were two and I wrote the second.
//
// `probe:live-prices` had a robots.txt reader; `probe:omnibus` got a copy of it the same day
// `check:concepts` was written to stop exactly that. The register now names this module, so a
// third copy fails the build rather than drifting quietly — which is the failure mode: a stale
// copy keeps answering, and here it would answer "yes, fetch it" about a path a merchant has
// asked us not to touch.
//
// ── DELIBERATELY CONSERVATIVE, AND THE DIRECTION MATTERS.
//
// Any `Disallow` under `User-agent: *` whose prefix matches the path blocks the fetch. `Allow`
// precedence is NOT implemented, so a specific `Allow` nested inside a broader `Disallow` is
// ignored and we skip a path we were in fact permitted. For an audit of a few dozen requests
// that is the right direction to err in: the cost of over-skipping is a smaller sample and a
// line in the report, and the cost of under-skipping is fetching something we were asked not to.
//
// An UNREACHABLE robots.txt is not permission. It is treated as `Disallow: /`.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CosMicPriceCheck/1.0 (+https://cosieftin.ro)";

const cache = new Map<string, string[]>();

/** The `Disallow` prefixes that apply to us, for one origin. Cached per process. */
export async function disallowedPrefixes(origin: string): Promise<string[]> {
  const hit = cache.get(origin);
  if (hit) return hit;
  const rules: string[] = [];
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": UA } });
    if (res.ok) {
      let applies = false;
      for (const raw of (await res.text()).split(/\r?\n/)) {
        const line = raw.split("#")[0].trim();
        if (!line) continue;
        const [k, ...rest] = line.split(":");
        const key = k.trim().toLowerCase();
        const value = rest.join(":").trim();
        if (key === "user-agent") applies = value === "*";
        else if (applies && key === "disallow" && value) rules.push(value);
      }
    }
  } catch {
    rules.push("/");
  }
  cache.set(origin, rules);
  return rules;
}

/** May we fetch this URL? A malformed URL is a no. */
export async function allowedByRobots(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    return !(await disallowedPrefixes(u.origin)).some((r) => u.pathname.startsWith(r));
  } catch {
    return false;
  }
}

/** The user agent these fetches identify themselves with. Exported so callers do not invent one. */
export const PROBE_UA = UA;
