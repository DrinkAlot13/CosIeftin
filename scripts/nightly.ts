// The nightly chain, orchestrated in TypeScript rather than in shell operators.
//
// WHY THIS IS NOT AN npm SCRIPT. The obvious spelling is
//
//     "nightly": "npm run nightly:steps || echo failed && npm run soak:log"
//
// and it is WRONG on Windows in the worst possible way. cmd.exe parses `A || B && C` as
// `A || (B && C)`, not as `(A || B) && C` — so on every night the scrape chain SUCCEEDED, the
// soak log would never have been written. A fortnight of perfect nights would have produced an
// empty directory, and the report would have said "no logs" while everything was fine.
//
// Verified, not assumed: `node -e "process.exit(0)" || echo B && echo C` prints nothing in
// cmd.exe, and prints both with exit 1. bash groups it the other way. A nightly job whose
// behaviour depends on which shell npm picked is not a nightly job.
//
// So: spawn the steps, then spawn soak:log REGARDLESS, and hand the steps' exit code to the
// log. A night when the scrape died is exactly the night whose record matters most.
//
// Run: npm run nightly

import { spawnSync } from "node:child_process";

function run(label: string, script: string, extraEnv: Record<string, string> = {}): number {
  console.log(`\n──── ${label} ────`);
  const r = spawnSync(`npm run ${script}`, {
    cwd: process.cwd(),
    shell: true,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  return r.status ?? 1;
}

const stepsExit = run("nightly steps", "nightly:steps");
if (stepsExit !== 0) {
  console.log(`\n  ⚠ NIGHTLY STEPS FAILED (exit ${stepsExit}) — recording the night anyway.`);
  console.log(`    A missing log and a quiet night look identical in a directory listing.`);
}

// Always. This is the whole point of the file.
const logExit = run("soak log", "soak:log", { SOAK_STEPS_EXIT: String(stepsExit) });

// Always, and only AFTER soak:log — it compares tonight's just-written record against the
// previous one. A check that was passing and is now failing is news; a check that has been red
// for weeks is not (see notify-regression.ts). No destination configured is not a failure of
// this step — it still prints to this same log either way.
run("regression check", "notify:regression");

// The nightly's own exit code reflects the SCRAPE, not the logging: a red audit is information,
// not a failure of the job, and a cron that mails on non-zero should not mail every night just
// because two invariants are red on purpose.
if (logExit !== 0) console.log(`\n  ⚠ soak:log itself exited ${logExit} — the night may not be recorded.`);
process.exit(stepsExit);
