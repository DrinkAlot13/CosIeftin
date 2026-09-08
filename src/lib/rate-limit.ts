// RATE LIMITING. There was none anywhere, and `POST /api/list-adds` is an unbounded anonymous
// write that promotes products on the homepage.
//
// ── WHAT THIS IS, STATED BEFORE ANYTHING ELSE, BECAUSE THE LIMITS MATTER MORE THAN THE FEATURE.
//
// This is an IN-MEMORY, SINGLE-PROCESS limiter. It therefore:
//
//   • resets on every restart and every deploy;
//   • counts per process, so two instances behind a load balancer allow twice the budget;
//   • cannot see an attacker who rotates IPs, which is the whole technique behind
//     credential stuffing at any scale.
//
// It raises the cost of casual abuse from one shell loop to something that needs a botnet. It
// is not a substitute for a limiter at the edge, and calling it one would be the same class of
// mistake this project keeps cataloguing: **a value never observed reported as an observation.**
//
// ── AND IT DEPENDS ON SEEING THE CLIENT'S IP, WHICH THIS DEPLOYMENT MAY NOT.
//
// `next start` with no reverse proxy in front receives no `x-forwarded-for` and populates no
// socket address on `NextRequest`. Every caller then looks identical, and a per-IP limiter
// silently becomes a global one — a shared budget that ONE attacker can exhaust for everybody,
// which is a denial-of-service the limiter itself introduced.
//
// So the fallback bucket is separate and far more generous, and `npm run audit:rate-limit`
// reports whether real client addresses are visible at all. A rate limiter that cannot see who
// is calling should say so out loud rather than be believed.
//
// No dependency: CLAUDE.md forbids adding one without asking, and this is ~60 lines.

/** One counted window for one key. */
type Window = { count: number; resetAt: number };

export type Limit = {
  /** Requests allowed per window, per identified caller. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /**
   * Budget for the ONE bucket every unidentified caller shares.
   *
   * Set PER LIMIT rather than as a blanket multiple, because the two endpoints want opposite
   * things. `/api/basket` recomputes on every change to a shopper's list, so a handful of
   * concurrent shoppers legitimately produce hundreds of writes a minute and too tight a
   * shared budget is a self-inflicted outage. A login form is the opposite: real people rarely
   * fail more than a few times, and every extra attempt is worth more to an attacker than to
   * a shopper.
   *
   * A blanket 50x got both wrong — it made the login limit 500 attempts per quarter hour,
   * which is not a limit, and it was chosen without anyone asking what each endpoint needs.
   */
  sharedMax: number;
};

export type LimitResult = {
  ok: boolean;
  remaining: number;
  /** Seconds until the window resets — the value for a `Retry-After` header. */
  retryAfter: number;
  /** True when the caller could not be identified and shared the fallback budget. */
  shared: boolean;
};

/**
 * The named limits, in one place so they can be read and argued about.
 *
 * Login is the strict one: it is the credential-stuffing target, and a real person who cannot
 * remember their password does not need more than a handful of tries in a quarter of an hour.
 */
export const LIMITS = {
  /** Sign-in attempts. Deliberately tight, and the shared budget stays tight too: 50 attempts
   *  per quarter hour across ALL unidentified callers still slows a stuffing script to a crawl,
   *  and no honest shopper is the 51st failed login in fifteen minutes. */
  login: { max: 10, windowMs: 15 * 60_000, sharedMax: 50 },
  /** Account creation. One person needs one; twenty an hour is already generous for a site
   *  with no signups yet, and the cost of being wrong is a table full of junk accounts. */
  register: { max: 5, windowMs: 60 * 60_000, sharedMax: 20 },
  /** Anonymous list-add pings. A real shopper fills a basket in bursts, and the per-caller
   *  cap in `lib/list-adds.ts` is what actually protects the ranking. */
  listAdd: { max: 120, windowMs: 60_000, sharedMax: 2_400 },
  /** Everything else that writes. `/api/basket` recomputes on every list change, so this has
   *  to accommodate roughly ten concurrent shoppers before it starts refusing anyone. */
  write: { max: 60, windowMs: 60_000, sharedMax: 600 },
} as const satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

/** Buckets, bounded so an IP-rotating caller cannot turn this into a memory leak. */
const MAX_KEYS = 50_000;
const buckets = new Map<string, Window>();

/** Drop every expired window; if still over the cap, drop the oldest resets first. */
function evict(now: number): void {
  for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k);
  if (buckets.size <= MAX_KEYS) return;
  const byReset = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (let i = 0; i < byReset.length - MAX_KEYS; i++) buckets.delete(byReset[i][0]);
}

/**
 * The caller's address, or null when this deployment cannot see one.
 *
 * `x-forwarded-for` is CLIENT-SUPPLIED and trivially spoofed unless a proxy we control
 * overwrites it. It is trusted only when `TRUST_PROXY` is set, which is the operator asserting
 * that something in front is rewriting it. Without that, an attacker sets the header themselves
 * and gets a fresh budget per request — a limiter that is worse than none, because it looks
 * like protection.
 */
export function clientIp(headers: Headers): string | null {
  if (process.env.TRUST_PROXY === "1") {
    const xff = headers.get("x-forwarded-for");
    // The left-most entry is the original client; the rest are proxies.
    const first = xff?.split(",")[0]?.trim();
    if (first) return first;
    const real = headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  return null;
}

/**
 * The key a request counts against. Named limits never share a budget with each other.
 *
 * The unidentified bucket is a sentinel containing characters no IP literal can hold, so a
 * caller can neither land in it nor escape it by presenting a crafted address.
 */
export const SHARED_KEY = "__unidentified__";

export function limitKey(name: LimitName, ip: string | null): string {
  return `${name}:${ip ?? SHARED_KEY}`;
}

/**
 * The budget this caller counts against: their own when we know who they are, the shared one
 * when we do not.
 *
 * Exported so `audit:rate-limit` DERIVES its expectation from the same source rather than
 * recomputing it. The first version of that audit multiplied the nominal budget itself, sent 65
 * requests against a real threshold of 3,000, and reported "NO LIMIT FIRED" — a claim about the
 * system that was actually a bug in the check.
 */
export function effectiveMax(name: LimitName, ip: string | null): number {
  const limit = LIMITS[name];
  return ip === null ? limit.sharedMax : limit.max;
}

/**
 * Count one request against `name` for this caller.
 *
 * When the caller cannot be identified, the shared budget applies so that an unidentifiable
 * population is not locked out by one noisy member. That is a deliberate trade of protection
 * for availability, and it is why `audit:rate-limit` exists to tell you which mode you are in.
 */
export function rateLimit(name: LimitName, ip: string | null, now = Date.now()): LimitResult {
  const limit = LIMITS[name];
  const shared = ip === null;
  const max = effectiveMax(name, ip);
  const key = limitKey(name, ip);

  evict(now);
  const w = buckets.get(key);
  if (!w || w.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return { ok: true, remaining: max - 1, retryAfter: 0, shared };
  }
  w.count++;
  const retryAfter = Math.max(1, Math.ceil((w.resetAt - now) / 1000));
  if (w.count > max) return { ok: false, remaining: 0, retryAfter, shared };
  return { ok: true, remaining: max - w.count, retryAfter: 0, shared };
}

/** A 429 with the header a well-behaved client honours. */
export function tooManyRequests(r: LimitResult): Response {
  return new Response("Too many requests", {
    status: 429,
    headers: { "retry-after": String(r.retryAfter), "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * The one-liner every write route starts with.
 *
 *     const limited = guard("write", req);
 *     if (limited) return limited;
 *
 * Returns null when the request may proceed, or the 429 to return when it may not. Written as a
 * returned value rather than a thrown error so a route cannot forget to catch it — a limiter
 * that fails open on a typo is a limiter nobody should trust.
 */
export function guard(name: LimitName, req: { headers: Headers }): Response | null {
  const r = rateLimit(name, clientIp(req.headers));
  return r.ok ? null : tooManyRequests(r);
}

/** Tests only: forget every window. Never called from application code. */
export function __resetRateLimitsForTest(): void {
  buckets.clear();
}

/** Diagnostics for `audit:rate-limit`. */
export function bucketCount(): number {
  return buckets.size;
}
