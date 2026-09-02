// Whether DELIVERY_PLATFORM prices are shown at all. ONE definition, read by every surface.
//
// A Glovo price is another shop's stock resold with a platform markup. It is not comparable with
// a shelf price, and CLAUDE.md's ninth invariant forbids letting one silently win a "cheapest"
// comparison. So the default is OFF — not "shown with a badge", OFF — across the optimizer, item
// pages, the deals hub, search, every count and the comparability metric.
//
// OFF IN PRODUCTION UNTIL THE OWNER SAYS OTHERWISE. The legal review is deferred, and ingesting
// privately is a smaller exposure than publishing. The switch exists so the data can be
// inspected, not so it can quietly leak into the site.
//
// Two ways to turn it on, both explicit:
//   SHOW_DELIVERY_PLATFORM=1   environment, for a local inspection session
//   ?dp=1                      per-request, for looking at one page
// Neither is sticky and neither is the default.

import { PRICE_SOURCES, type PriceSource } from "../price-source";

export const DELIVERY_PLATFORM: PriceSource = "DELIVERY_PLATFORM";

/** The environment default. False unless explicitly enabled. */
export function deliveryPlatformEnabledByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.SHOW_DELIVERY_PLATFORM ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Should this request show delivery-platform prices?
 *
 * `?dp=1` opts a single page in; nothing opts the site in permanently except the environment
 * variable, which is not set in production.
 */
export function showDeliveryPlatform(searchParams?: { dp?: string | string[] } | URLSearchParams | null): boolean {
  if (deliveryPlatformEnabledByEnv()) return true;
  if (!searchParams) return false;
  const raw = searchParams instanceof URLSearchParams
    ? searchParams.get("dp")
    : Array.isArray(searchParams.dp) ? searchParams.dp[0] : searchParams.dp;
  return raw === "1" || raw === "true";
}

/**
 * A Prisma filter fragment excluding delivery-platform offers, or `{}` when they are shown.
 *
 * Expressed as a NOT rather than an `in` over the other three values so a fifth price source
 * added later is visible by default rather than silently hidden — the failure mode that let
 * five spellings of this column coexist unnoticed.
 */
export function deliveryPlatformWhere(show: boolean) {
  return show ? {} : ({ NOT: { priceSource: DELIVERY_PLATFORM } } as const);
}

/** The predicate twin of the filter above, for code that has already loaded the rows. */
export function isDeliveryPlatform(o: { priceSource?: string | null }): boolean {
  return (o.priceSource ?? "") === DELIVERY_PLATFORM;
}

/** Romanian label required on every delivery-platform price that is shown. */
export const DELIVERY_PLATFORM_LABEL = "preț prin Glovo — include adaosul platformei";

/** Guard used by tests: the vocabulary must still contain the value this module keys on. */
export function vocabularyStillContainsDeliveryPlatform(): boolean {
  return (PRICE_SOURCES as readonly string[]).includes(DELIVERY_PLATFORM);
}
