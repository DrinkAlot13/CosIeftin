// Let an audit hand its results to a machine as well as to a person.
//
// The soak log needs, every night, the pass/fail of every invariant and a handful of counts.
// The obvious way to get them is to run each audit and parse its console output — and that is
// the wrong way, for the reason this project keeps rediscovering: a reader that reconstructs a
// number by scraping the shape of a line agrees with the writer only until somebody edits the
// line. It then fails SILENTLY, reporting a green fortnight because a regex stopped matching.
// `doseTokens` had never matched anything for weeks. `Discovered 90 leaf categories` was true
// and told nobody anything. A soak whose reader can quietly stop reading is worse than no soak,
// because it produces a confident answer.
//
// So the audit states its own result structurally, and the log records what it was given. The
// audit remains the only authority on whether it passed; this adds no second opinion and no
// second definition. It is transport, not verification.
//
// Usage, at the end of an audit's main():   emitJson({ … });
// The audit is unchanged unless `--json <path>` is on the command line, so every one of these
// still behaves exactly as before when a human runs it.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** The path given by `--json <path>`, or null when the flag is absent. */
export function jsonOutPath(argv: string[] = process.argv): string | null {
  const i = argv.indexOf("--json");
  if (i < 0) return null;
  const p = argv[i + 1];
  return p && !p.startsWith("--") ? p : null;
}

/**
 * Write `payload` to the path named by `--json`, or do nothing.
 *
 * Deliberately NOT wrapped in a try/catch. If the soak asked for a file and the file cannot be
 * written, the run must fail loudly — a soak that silently skips a night looks identical to a
 * soak with nothing to report, and telling those two apart is the entire point of the exercise.
 */
export function emitJson(payload: unknown, argv: string[] = process.argv): void {
  const out = jsonOutPath(argv);
  if (!out) return;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
}
