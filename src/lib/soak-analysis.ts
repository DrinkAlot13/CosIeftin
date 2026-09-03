// What the soak report LOOKS FOR, as pure functions over the recorded nights.
//
// These live here rather than inside scripts/soak-report.ts for one reason: the soak runs
// unattended for two weeks, and the failure it hunts is a check that quietly stops checking.
// A reader whose detection logic is buried in a console script has exactly that failure mode —
// it prints "no changes" whether nothing changed or nothing was examined, and those two
// outputs are identical. So the detection is separated from the printing and tested against
// fabricated histories that contain each defect on purpose.
//
// Nothing here re-derives a verdict. Every input was recorded on the night it happened by the
// audit that owns it; these functions only compare nights to each other.

export type NightInvariants = Map<string, boolean>;

export type Transition = {
  date: string;
  name: string;
  /** true = became green, false = became red, null = the check vanished from the log. */
  to: boolean | null;
};

/**
 * Invariants that CHANGED STATE, with the date of the change.
 *
 * A check that is red every night is not news; a check that went red on the ninth is. The two
 * deliberate reds in this project — Kaufland's aborts and the mass-move days — are steady
 * state and will never appear here, which is the point.
 *
 * A check that DISAPPEARS is also a transition. An audit that stops reporting an invariant
 * looks, in a green summary, exactly like an invariant that is holding.
 */
export function invariantTransitions(nights: { date: string; invariants: NightInvariants }[]): Transition[] {
  const seen = new Map<string, boolean>();
  const out: Transition[] = [];
  for (const n of nights) {
    for (const [name, pass] of n.invariants) {
      const before = seen.get(name);
      if (before === undefined) { seen.set(name, pass); continue; }
      if (before !== pass) { out.push({ date: n.date, name, to: pass }); seen.set(name, pass); }
    }
    for (const name of [...seen.keys()]) {
      if (!n.invariants.has(name)) { out.push({ date: n.date, name, to: null }); seen.delete(name); }
    }
  }
  return out;
}

export type Move = { date: string; slug: string; from: number; to: number; fromDate: string; pct: number };

/**
 * Merchants whose offers written moved more than `threshold` percent day over day.
 *
 * A merchant that wrote nothing on two consecutive nights has not moved, it has STOPPED, and
 * that belongs in the dead-source list where it cannot be buried among percentage noise. So a
 * zero night is reported as the -100% that produced it and then does not become the baseline
 * for the next comparison — otherwise every recovery divides by zero.
 */
export function writeMoves(
  nights: { date: string; merchants: { slug: string; offersWritten: number }[] }[],
  threshold = 20,
): Move[] {
  const prev = new Map<string, { date: string; n: number }>();
  const out: Move[] = [];
  for (const n of nights) {
    for (const m of n.merchants) {
      const p = prev.get(m.slug);
      if (p && p.n > 0) {
        const pct = ((m.offersWritten - p.n) / p.n) * 100;
        if (Math.abs(pct) > threshold) {
          out.push({ date: n.date, slug: m.slug, from: p.n, to: m.offersWritten, fromDate: p.date, pct });
        }
      }
      if (m.offersWritten > 0 || p === undefined) prev.set(m.slug, { date: n.date, n: m.offersWritten });
    }
  }
  return out;
}

export type DeadEvent = { date: string; slug: string; hours: number | null; kind: "silent" | "claims-without-writes" };

/**
 * Merchants with no successful write in `maxHours`, plus the ones that ran and produced nothing.
 *
 * This is the Metro/Mega shape and the only thing in the whole soak that is allowed to
 * interrupt somebody: correct data, dead source, every other check green.
 */
export function deadSources(
  nights: { date: string; liveness: { merchants?: { slug: string; hoursSinceWrite: number | null }[]; claimsWithoutWrites?: string[] } | null }[],
  maxHours = 48,
): DeadEvent[] {
  const out: DeadEvent[] = [];
  for (const n of nights) {
    for (const r of n.liveness?.merchants ?? []) {
      if (r.hoursSinceWrite != null && r.hoursSinceWrite >= maxHours) {
        out.push({ date: n.date, slug: r.slug, hours: r.hoursSinceWrite, kind: "silent" });
      }
    }
    for (const slug of n.liveness?.claimsWithoutWrites ?? []) {
      out.push({ date: n.date, slug, hours: null, kind: "claims-without-writes" });
    }
  }
  return out;
}

/**
 * Calendar dates between the first and last recorded night that have no log.
 *
 * A directory with nine files in it looks calm rather than broken, and the third failure mode
 * the brief named is the nightly chain dying so that nothing runs at all.
 */
export function missingNights(dates: string[]): string[] {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const have = new Set(sorted);
  const start = Date.parse(`${sorted[0]}T00:00:00Z`);
  const end = Date.parse(`${sorted[sorted.length - 1]}T00:00:00Z`);
  const out: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    const s = new Date(t).toISOString().slice(0, 10);
    if (!have.has(s)) out.push(s);
  }
  return out;
}

/**
 * Is this actually an N-night soak?
 *
 * `missingNights` only sees gaps BETWEEN the first and last recorded night, which means five
 * consecutive nights out of an intended fourteen report "no missing nights" — the check cannot
 * see the nights that were never attempted, only the holes between the ones that were. That is
 * the same blind spot as counting a column's default as an observation: absence looks like
 * agreement.
 *
 * So the window is stated rather than inferred. Nights are counted against the LAST `expected`
 * calendar days ending today, and the verdict says plainly whether the fortnight happened.
 */
export type SoakVerdict = {
  expected: number;
  recorded: number;
  missing: string[];
  /** True only when every night in the window has a log. */
  complete: boolean;
  headline: string;
};

export function soakVerdict(dates: string[], expected: number, today: string): SoakVerdict {
  const have = new Set(dates);
  const end = Date.parse(`${today}T00:00:00Z`);
  const window: string[] = [];
  for (let i = expected - 1; i >= 0; i--) {
    window.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));
  }
  const missing = window.filter((d) => !have.has(d));
  const recorded = window.length - missing.length;
  const complete = missing.length === 0;
  const headline = complete
    ? `${recorded} of ${expected} nights recorded — this IS a ${expected}-night soak.`
    : `${recorded} of ${expected} nights recorded, ${missing.length} MISSING — ` +
      `this is NOT a ${expected}-night soak and must not be read as one.`;
  return { expected, recorded, missing, complete, headline };
}
