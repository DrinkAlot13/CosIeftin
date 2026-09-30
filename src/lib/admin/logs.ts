// ── THE NIGHTLY LOG FILES, READ SAFELY. ONE PLACE THAT KNOWS THE SHAPE.
//
// `scripts/nightly.sh` (the container's cron wrapper — see docker-compose.yml's `logs` volume
// comment) writes one file per night: `logs/nightly/YYYY-MM-DD.log`. Without a mounted volume
// these vanish on every redeploy, which was the actual gap this whole feature exists to close —
// "download the logs from the site" is only possible if something outlives the container that
// wrote them.
//
// The filename is untrusted input the moment it comes from a URL (`/api/admin/logs?file=...`),
// so this module is the ONE place that decides which filenames are real log files and resolves
// them to a path — `../../etc/passwd`-shaped input never reaches `readFile`. The page and the
// API route both call this rather than building their own path, for the same reason `duplicateKey`
// and `exactDuplicateKey` live in one file: two readers of "what counts as a log file" is how one
// of them quietly starts accepting something the other would have refused.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const LOG_DIR = join(process.cwd(), "logs", "nightly");

/** Exactly what `scripts/nightly.sh` names a log file. Nothing else is ever served. */
const LOG_FILENAME_RE = /^\d{4}-\d{2}-\d{2}\.log$/;

export type NightlyLogEntry = { filename: string; date: string; bytes: number; mtime: Date };

/** Every nightly log on disk, newest first. Empty (not thrown) if the directory doesn't exist
 *  yet — no nightly has run since this feature shipped, which is a fact, not a failure. */
export function listNightlyLogs(): NightlyLogEntry[] {
  let names: string[];
  try {
    names = readdirSync(LOG_DIR);
  } catch {
    return [];
  }
  return names
    .filter((n) => LOG_FILENAME_RE.test(n))
    .map((filename) => {
      const st = statSync(join(LOG_DIR, filename));
      return { filename, date: filename.replace(/\.log$/, ""), bytes: st.size, mtime: st.mtime };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Read one log's content by filename, or null if the name isn't a real log file — never a
 * caller-built path. `LOG_FILENAME_RE` alone (no `..`, no `/`, fixed shape) already makes
 * traversal impossible, but the directory is re-verified anyway: this function is the one
 * place a mistake here would matter, so it does not trust its own regex alone.
 */
export function readNightlyLog(filename: string): string | null {
  if (!LOG_FILENAME_RE.test(filename)) return null;
  const path = join(LOG_DIR, filename);
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
