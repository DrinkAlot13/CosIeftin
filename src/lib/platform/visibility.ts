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

/**
 * Romanian label required on every delivery-platform price that is shown.
 *
 * ── IT DOES NOT SAY "include adaosul platformei", AND THAT WAS MEASURED.
 *
 * The brief specified that wording and it is false often enough to matter. `audit:platform`
 * compared every in-stock platform offer against the same product's cheapest in-stock SHELF
 * price, 782 pairs:
 *
 *     glovo-kaufland  345 compared   median +11.8%   36 exactly at shelf    99 CHEAPER
 *     glovo-profi     296 compared   median +23.8%   15 exactly at shelf    65 CHEAPER
 *     glovo-penny     141 compared   median  −1.0%   10 exactly at shelf    72 CHEAPER
 *
 * 297 of 782 — **38%** — are at or below the shelf price, and Penny's median is NEGATIVE. A label
 * asserting a markup on those rows states as fact something we measured to be untrue, which is
 * the same defect as a wrong price with a friendlier face.
 *
 * What is true of every row without exception is that it is not a shelf price: it is what the
 * platform charges, and it carries delivery terms the shelf price does not. So the label says
 * that, and the panel beside it gives the measured distribution instead of a blanket claim.
 */
export const DELIVERY_PLATFORM_LABEL = "preț prin Glovo — nu este prețul de la raft";

/** The longer sentence, for surfaces with room for it. */
export const DELIVERY_PLATFORM_NOTE =
  "Preț prin Glovo. Poate fi mai mare decât la raft (adaosul platformei), dar nu întotdeauna — " +
  "l-am măsurat și la același preț, uneori mai mic. Nu intră niciodată în „cel mai mic preț”.";

/** Guard used by tests: the vocabulary must still contain the value this module keys on. */
export function vocabularyStillContainsDeliveryPlatform(): boolean {
  return (PRICE_SOURCES as readonly string[]).includes(DELIVERY_PLATFORM);
}
