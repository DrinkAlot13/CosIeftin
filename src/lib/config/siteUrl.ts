// The site's canonical origin. ONE accessor, because two were the bug.
//
// `seo.ts` fell back to "http://localhost:3000" and `notify-alerts.ts` to
// "https://cosmic.ro" — the same variable, two different answers, neither of them
// announced. Whichever value is right, having two guarantees one of them is wrong, and the
// failure is silent in both directions: localhost canonicals and sitemap entries get published
// to Google, and alert emails link somewhere the recipient cannot reach.
//
// Both of those are slow to notice and expensive to undo, which is exactly the profile of a
// bug that should fail loudly at startup instead.

/** Development default. Never used outside development — see siteUrl(). */
const DEV_ORIGIN = "http://localhost:3000";

export class MissingSiteUrlError extends Error {
  constructor() {
    super(
      "SITE_URL is not set and NODE_ENV is not development. Refusing to guess the canonical " +
      "origin: a wrong one publishes canonical tags, sitemap entries and email links pointing " +
      "at a host we do not control, and search engines are slow to forgive it.",
    );
    this.name = "MissingSiteUrlError";
  }
}

/**
 * Resolve the origin, or throw.
 *
 * Pure in its inputs so the production-throws case is testable without setting real
 * environment variables in the test process.
 */
export function resolveSiteUrl(env: { SITE_URL?: string; NEXT_PUBLIC_SITE_URL?: string; NODE_ENV?: string }): string {
  const raw = (env.SITE_URL ?? env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  if (raw) return raw.replace(/\/+$/, "");
  if ((env.NODE_ENV ?? "development") !== "development") throw new MissingSiteUrlError();
  return DEV_ORIGIN;
}

/** The canonical origin, without a trailing slash. */
export function siteUrl(): string {
  return resolveSiteUrl(process.env);
}

/** Absolute URL for a path on this site. */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Is this a URL we must never publish?
 *
 * A localhost or 127.0.0.1 origin in a canonical tag, a sitemap or an email is not a broken
 * link the reader can work around — it points at *their* machine.
 */
export function isLocalOrigin(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(url.trim());
}
