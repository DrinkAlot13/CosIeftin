// A cap that bites produces a smaller, entirely valid-looking run.
//
// DCNeu's `MAX_CATS` was 90 and DCNeu publishes 180 leaf categories. `.slice(0, 90)` took the
// first half in page order — not a sample, a truncation — and every run logged
// "Discovered 90 leaf categories", which is true and tells nobody anything: it reads as a
// fact about DCNeu rather than a fact about our cap. Half the shop was invisible for weeks,
// and the product a user pointed at lived in the missing half.
//
// The failure is silent BY CONSTRUCTION. Nothing crashes, nothing looks wrong, the offer
// count is merely lower than it should be — and a lower count is indistinguishable from a
// shop that sells less. So the only defence is to say so at the moment it happens.

export type Truncation = {
  label: string;
  discovered: number;
  scraped: number;
  cap: number;
  truncated: boolean;
};

const seen: Truncation[] = [];

/**
 * Record what a cap did, and shout if it bit.
 *
 * Call this wherever a `.slice(0, CAP)` or a `for (p = 1; p <= CAP; p++)` decides how much of
 * a source gets read. `discovered` is what was available, `scraped` is what was taken.
 */
export function noteCap(label: string, discovered: number, scraped: number, cap: number): Truncation {
  const t: Truncation = { label, discovered, scraped, cap, truncated: scraped < discovered };
  seen.push(t);
  if (t.truncated) {
    console.error(
      `  ⚠ TRUNCATED: ${label} found ${discovered} but read ${scraped} (cap ${cap}). ` +
      `This run is INCOMPLETE and its lower count is not a fact about the shop.`,
    );
  }
  return t;
}

/**
 * A pagination loop that ran to its cap without exiting early.
 *
 * Not proof of truncation — a category can have exactly `cap` pages — but it is the only
 * signal available, and treating "ran to the cap" as suspicious is the right default: the
 * alternative is treating it as complete, which is what cost DCNeu half its catalogue.
 */
export function notePageCap(label: string, pagesRead: number, cap: number): Truncation {
  const t: Truncation = { label, discovered: pagesRead, scraped: pagesRead, cap, truncated: pagesRead >= cap };
  seen.push(t);
  if (t.truncated) {
    console.error(
      `  ⚠ PAGE CAP REACHED: ${label} read all ${pagesRead} allowed pages (cap ${cap}) ` +
      `without running out. There may be more.`,
    );
  }
  return t;
}

/** Everything recorded this run. */
export function truncations(): Truncation[] {
  return [...seen];
}

/** Did anything truncate? Used to fail a run rather than report a short one as complete. */
export function anyTruncated(): boolean {
  return seen.some((t) => t.truncated);
}

export function resetTruncations(): void {
  seen.length = 0;
}
