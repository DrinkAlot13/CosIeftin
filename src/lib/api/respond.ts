// Response envelope, CORS, caching and rate-limit headers for /api/v1.
//
// One place, because every one of these is a thing a route can silently get wrong: a missing
// CORS header breaks the extension with no server-side symptom, a missing cache header quadruples
// origin load invisibly, and an error shape that varies between routes makes a client's error
// handling a guessing game.

import { NextResponse } from "next/server";
import { rateLimit, clientIp, effectiveMax, type LimitName } from "@/lib/rate-limit";

export type ApiErrorCode = "bad_request" | "not_found" | "rate_limited" | "server_error";

const STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  not_found: 404,
  rate_limited: 429,
  server_error: 500,
};

/**
 * ── CORS. Public catalog GETs are open; the expensive POST is not.
 *
 * Refusing `*` on a product lookup would be theatre: the same data is in the HTML of a page
 * anyone can fetch, so a CORS rule buys nothing and costs the extension. `POST /basket/optimize`
 * is different — it is the expensive call, and an open one is a free compute service.
 *
 * `Access-Control-Allow-Credentials` is NEVER set. No v1 endpoint is user-scoped, and enabling
 * credentials on a wildcard origin is the classic hole.
 */
export function corsHeaders(kind: "public-get" | "restricted"): Record<string, string> {
  if (kind === "public-get") {
    return {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    };
  }
  // The extension's ids are not known until it is packed; ALLOWED_ORIGINS is the deployment's
  // list. Empty means same-origin only, which is the safe default for an unconfigured install.
  const allowed = (process.env.API_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    "access-control-allow-origin": allowed[0] ?? "",
    "vary": "origin",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

/** Cache headers matched to the nightly cadence — see docs/API.md §7. */
export function cacheHeaders(sMaxAge: number, swr: number): Record<string, string> {
  if (sMaxAge === 0) return { "cache-control": "no-store" };
  return { "cache-control": `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}` };
}

export type ApiOptions = {
  cors?: "public-get" | "restricted";
  cache?: { sMaxAge: number; swr: number };
  rateLimit?: { name: LimitName; remaining: number; retryAfter: number; max: number };
};

function withHeaders(res: NextResponse, opts: ApiOptions): NextResponse {
  for (const [k, v] of Object.entries(corsHeaders(opts.cors ?? "public-get"))) res.headers.set(k, v);
  if (opts.cache) for (const [k, v] of Object.entries(cacheHeaders(opts.cache.sMaxAge, opts.cache.swr))) res.headers.set(k, v);
  if (opts.rateLimit) {
    res.headers.set("x-ratelimit-limit", String(opts.rateLimit.max));
    res.headers.set("x-ratelimit-remaining", String(opts.rateLimit.remaining));
    // Seconds until the window resets, which is what `LimitResult` actually carries. A wall-clock
    // reset timestamp would be a second representation of the same fact, derived here and able
    // to disagree with the limiter — the restatement shape this project keeps paying for.
    res.headers.set("x-ratelimit-reset", String(opts.rateLimit.retryAfter));
  }
  return res;
}

export function apiOk(body: unknown, opts: ApiOptions = {}): NextResponse {
  return withHeaders(NextResponse.json(body), opts);
}

/** One error shape, always — see docs/API.md §2.5. Internals never reach the body. */
export function apiError(code: ApiErrorCode, message: string, details: Record<string, unknown> = {}, opts: ApiOptions = {}): NextResponse {
  const res = NextResponse.json({ error: { code, message, details } }, { status: STATUS[code] });
  return withHeaders(res, opts);
}

/**
 * The guard every v1 route starts with. Returns the 429 to return, or the budget state to attach
 * to a successful response.
 *
 * Returned rather than thrown, following `rate-limit.guard`: a limiter that fails open on a
 * forgotten try/catch is a limiter nobody should trust.
 */
export function apiGuard(
  name: LimitName,
  req: { headers: Headers },
  cors: "public-get" | "restricted" = "public-get",
): { limited: NextResponse } | { limited: null; budget: NonNullable<ApiOptions["rateLimit"]> } {
  const ip = clientIp(req.headers);
  const r = rateLimit(name, ip);
  // The ceiling comes from `effectiveMax`, IMPORTED — an unidentified caller gets the larger
  // shared budget, and recomputing that here is exactly the mistake that made audit:rate-limit
  // report "NO LIMIT FIRED" about a limiter that was working.
  const budget = { name, remaining: r.remaining, retryAfter: r.retryAfter, max: effectiveMax(name, ip) };
  if (!r.ok) {
    const res = apiError("rate_limited", "Prea multe cereri. Încearcă din nou în curând.", {}, { cors, rateLimit: budget });
    res.headers.set("retry-after", String(Math.max(1, r.retryAfter)));
    return { limited: res };
  }
  return { limited: null, budget };
}

/** Pre-flight. Same headers, no body. */
export function apiPreflight(cors: "public-get" | "restricted" = "public-get"): NextResponse {
  const res = new NextResponse(null, { status: 204 });
  for (const [k, v] of Object.entries(corsHeaders(cors))) res.headers.set(k, v);
  return res;
}
