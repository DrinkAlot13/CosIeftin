// Feature flags. Server-side only, and every one of them defaults to OFF.
//
// Defaulting off is not caution for its own sake. Two of these features publish a claim ABOUT
// A NAMED COMPANY — that a pack shrank while its price per kilo rose, or that an advertised
// discount is not a real discount. Both are defensible when the evidence is good and
// indefensible when it is not, and the difference is invisible from inside the code that
// produces them. A flag that defaults on means a bad detection reaches the public the moment
// it is written; a flag that defaults off means somebody looked first.
//
// So the default is not "off until we trust the code". It is "off until a human decided to
// publish", which is a different and permanent standard.

/**
 * Only an explicit, affirmative value turns a flag on.
 *
 * Anything else — unset, empty, "false", "0", a typo, a variable that got set to the string
 * "undefined" by a deployment script — is off. An accidental enable is exactly the failure
 * these flags exist to prevent, so ambiguity resolves to off, never to on.
 */
export function flagEnabled(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "true" || v === "1" || v === "on" || v === "yes";
}

/**
 * Shrinkflation detections and the "is this discount real?" verdict.
 *
 * Both name a company and make a factual claim about its behaviour. Off unless
 * FEATURE_TRUST=true, whatever the data looks like.
 */
export function trustFeaturesEnabled(): boolean {
  return flagEnabled(process.env.FEATURE_TRUST);
}

/** Everything the app can be told to switch on, in one place, for the admin panel to show. */
export function allFlags(): { name: string; env: string; enabled: boolean; note: string }[] {
  return [
    {
      name: "Trust features",
      env: "FEATURE_TRUST",
      enabled: trustFeaturesEnabled(),
      note: "Shrinkflation page and discount verification. Both publish a claim about a named company.",
    },
  ];
}
