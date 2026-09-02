// ── SCOPE: RECORDER ───────────────────────────────────────────────────────────
// This script has NO opinion about whether anything is correct. It runs the checks that do,
// records what they said, and writes one file per night. Every verdict in the output belongs
// to the audit that produced it; nothing here re-derives a number an audit already computed,
// because a recorder that recomputes is a second definition, and two definitions of one thing
// is how "47 outliers" and "7 outliers" were both true at once.
//
// ONE NIGHT OF THE SOAK.  Run: npm run soak:log        (wired into `npm run nightly`)
// Output:                     logs/soak/YYYY-MM-DD.json
//
// ORDER MATTERS, and it is the order the brief asked for:
//
//   1. liveness      first, because a dead source invalidates everything after it. If Metro
//                    stopped answering, its offers are still correct, still fresh-looking to
//                    every other check, and completely wrong to show. An entry whose liveness
//                    is red is marked `trustworthy: false` so the fortnight's reader is not
//                    misled by the four green checks that follow it.
//   2. invariants    audit:db — data integrity, counts every row.
//   3. displayed     audit:displayed — user-facing, counts only rows that reach a page.
//   4. cutover       audit:cutover.
//   5. code          verify:code — typecheck, hygiene, allowlist, 742 tests.
//   6. comparability the SPLIT metric, never the blended one.
//   7. census        where every withheld row went, by reason.
//
// `verify:site` is recorded as the conjunction of 1, 2, 3, 4 and 5 — which is exactly what
// the npm script is — rather than by invoking it, so that liveness and audit:db each run once
// per night instead of twice. The composite verdict is identical; only the runtime differs.
//
// A CRASHING AUDIT IS A RESULT, NOT AN ABSENCE. Every step is wrapped, and a step that throws
// is written into the entry as `ok: false` with its last lines of output. The one failure mode
// this file must never have is producing no file at all: a missing night and a quiet night
// look the same in a directory listing, and telling them apart is the whole point.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ROOT = process.cwd();
const LOG_DIR = join(ROOT, "logs", "soak");
const TMP_DIR = join(ROOT, "logs", "soak", ".tmp");

/** Local calendar date, not UTC: the log is read by a person in Romania. */
function todayLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Step = {
  name: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  /** Whatever the audit emitted via --json, verbatim. Null when it emitted nothing. */
  data: unknown;
  /** Last lines of output, kept ONLY on failure — a green night should not carry 400 lines. */
  tail?: string;
};

/**
 * Run one audit, capture its structured result.
 *
 * The audit's exit code is the verdict. We do not inspect its output and decide for ourselves
 * whether it passed — that would be a second opinion built on the shape of a console line, and
 * it would drift the first time somebody edits the line.
 */
function runStep(name: string, script: string, wantsJson = true): Step {
  const out = join(TMP_DIR, `${name.replace(/[^a-z0-9-]/gi, "-")}.json`);
  const args = wantsJson ? ` --json "${out}"` : "";
  const started = Date.now();
  const r = spawnSync(`npx tsx ${script}${args}`, {
    cwd: ROOT,
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const durationMs = Date.now() - started;
  const combined = `${r.stdout ?? ""}${r.stderr ?? ""}`;

  let data: unknown = null;
  if (wantsJson && existsSync(out)) {
    try {
      data = JSON.parse(readFileSync(out, "utf8"));
    } catch (e) {
      data = { parseError: String(e) };
    }
  }

  const ok = r.status === 0;
  const step: Step = { name, ok, exitCode: r.status, durationMs, data };
  if (!ok) step.tail = combined.split(/\r?\n/).slice(-40).join("\n");
  console.log(`  ${ok ? "✓" : "✗"} ${name}  (${(durationMs / 1000).toFixed(1)}s)`);
  return step;
}

/** An npm script rather than a tsx entry point — verify:code is a chain of four. */
function runNpm(name: string, script: string): Step {
  const started = Date.now();
  const r = spawnSync(`npm run --silent ${script}`, {
    cwd: ROOT,
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
  const durationMs = Date.now() - started;
  const ok = r.status === 0;
  const step: Step = { name, ok, exitCode: r.status, durationMs, data: null };
  if (!ok) step.tail = `${r.stdout ?? ""}${r.stderr ?? ""}`.split(/\r?\n/).slice(-40).join("\n");
  console.log(`  ${ok ? "✓" : "✗"} ${name}  (${(durationMs / 1000).toFixed(1)}s)`);
  return step;
}

type MerchantNight = {
  slug: string;
  /** Offer ROWS written by today's runs — counted at the write, never reported by the scraper. */
  offersWritten: number;
  offersAttempted: number;
  offersNull: number;
  /** offersNull / offersAttempted. Null when nothing was attempted — not zero. */
  nullRate: number | null;
  runs: number;
  abortedRuns: number;
  lastAbortReason: string | null;
  /** Share of this merchant's live offers carrying the fields CLAUDE.md requires on every write. */
  rawPriceTextCoverage: number | null;
  productUrlCoverage: number | null;
  liveOffers: number;
};

/**
 * The per-merchant facts. Counts, not judgements.
 *
 * Provenance coverage is measured over LIVE offers rather than over today's writes, because
 * that is the population a parser change would have to be verified against later. productUrl is
 * reported for information and not scored: flyer sources legitimately have none, which is why
 * the column is nullable in the first place.
 */
async function merchantNight(dayStart: Date): Promise<MerchantNight[]> {
  const merchants = await prisma.merchant.findMany({
    where: { active: true },
    select: { id: true, slug: true },
    orderBy: { slug: "asc" },
  });

  const out: MerchantNight[] = [];
  for (const m of merchants) {
    const runs = await prisma.scraperRun.findMany({
      where: { merchantId: m.id, startedAt: { gte: dayStart } },
      orderBy: { startedAt: "desc" },
      select: {
        offersWritten: true, offersAttempted: true, offersNull: true,
        aborted: true, abortReason: true,
      },
    });
    const sum = (f: (r: (typeof runs)[number]) => number) => runs.reduce((s, r) => s + f(r), 0);
    const attempted = sum((r) => r.offersAttempted);

    const live = await prisma.offer.count({
      where: { merchantId: m.id, isStale: false, flagged: false },
    });
    const withRaw = await prisma.offer.count({
      where: { merchantId: m.id, isStale: false, flagged: false, rawPriceText: { not: null } },
    });
    const withUrl = await prisma.offer.count({
      where: { merchantId: m.id, isStale: false, flagged: false, productUrl: { not: null } },
    });

    out.push({
      slug: m.slug,
      offersWritten: sum((r) => r.offersWritten),
      offersAttempted: attempted,
      offersNull: sum((r) => r.offersNull),
      nullRate: attempted === 0 ? null : Number((sum((r) => r.offersNull) / attempted).toFixed(4)),
      runs: runs.length,
      abortedRuns: runs.filter((r) => r.aborted).length,
      lastAbortReason: runs.find((r) => r.abortReason)?.abortReason ?? null,
      rawPriceTextCoverage: live === 0 ? null : Number((withRaw / live).toFixed(4)),
      productUrlCoverage: live === 0 ? null : Number((withUrl / live).toFixed(4)),
      liveOffers: live,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const date = todayLocal(startedAt);
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  console.log(`\n════ SOAK — ${date} ═════════════════════════════════════════════════════════`);
  console.log(`  Running the checks in order. Liveness first: a dead source invalidates`);
  console.log(`  everything after it.\n`);

  // 1 — liveness FIRST.
  const liveness = runStep("audit:liveness", "scripts/audit-liveness.ts");
  // 2..5 — the rest of what verify:site is made of.
  const db = runStep("audit:db", "scripts/audit-db.ts");
  const displayed = runStep("audit:displayed", "scripts/audit-displayed.ts");
  const cutover = runStep("audit:cutover", "scripts/audit-cutover.ts", false);
  const code = runNpm("verify:code", "verify:code");
  // 6 — the split metric.
  const comparability = runStep("audit:comparability", "scripts/audit-comparability.ts");
  // 7 — the pool contract, and the census of withheld rows.
  // The pool contract is inside `npm test` and therefore inside verify:code already. It gets
  // its own line anyway, because it is the invariant that guards the single mistake which cost
  // Metro, Mega Image and Carrefour their provenance on EVERY offer they wrote — and a named
  // red line in a fortnight's summary is worth more than one failure among 742.
  const poolContract = runStep("pool-contract", "tests/run.ts pool-contract", false);
  const census = runStep("census", "scripts/offer-census.ts");

  const merchants = await merchantNight(new Date(`${date}T00:00:00`));

  // `verify:site` IS these five, so record the conjunction rather than running it again.
  const verifySiteParts = [liveness, db, displayed, cutover, code];
  const verifySite = {
    pass: verifySiteParts.every((s) => s.ok),
    note: "conjunction of audit:liveness, audit:db, audit:displayed, audit:cutover, verify:code — the definition of the npm script, evaluated without running liveness and audit:db twice",
    components: Object.fromEntries(verifySiteParts.map((s) => [s.name, s.ok])),
  };

  const livenessData = liveness.data as { dead?: string[]; claimsWithoutWrites?: string[] } | null;
  const dead = livenessData?.dead ?? [];

  // Did the scrape chain itself survive tonight? Handed down by scripts/nightly.ts, which runs
  // this log whether the steps succeeded or not. Absent when soak:log was run by hand.
  const stepsExitRaw = process.env.SOAK_STEPS_EXIT;
  const nightlySteps = stepsExitRaw === undefined
    ? null
    : { ok: stepsExitRaw === "0", exitCode: Number(stepsExitRaw) };

  const entry = {
    date,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    nightlySteps,
    // A red liveness does not make the other checks wrong — it makes them irrelevant. Say so
    // in the entry rather than leaving the fortnight's reader to notice on their own.
    trustworthy: liveness.ok,
    trustworthyNote: liveness.ok
      ? null
      : `liveness FAILED (${dead.join(", ") || "see step"}); the checks after it describe data whose source is not answering`,
    verifySite,
    steps: [liveness, db, displayed, cutover, code, comparability, poolContract, census].map((s) => ({
      name: s.name, ok: s.ok, exitCode: s.exitCode, durationMs: s.durationMs, ...(s.tail ? { tail: s.tail } : {}),
    })),
    liveness: liveness.data,
    invariants: {
      "audit:db": db.data,
      "audit:displayed": displayed.data,
      "audit:cutover": { pass: cutover.ok },
      "pool-contract": { pass: poolContract.ok },
      "verify:code": { pass: code.ok },
    },
    comparability: comparability.data,
    census: census.data,
    merchants,
  };

  const file = join(LOG_DIR, `${date}.json`);
  writeFileSync(file, JSON.stringify(entry, null, 2), "utf8");
  rmSync(TMP_DIR, { recursive: true, force: true });

  console.log(`\n  wrote ${file}`);
  console.log(`  verify:site ${verifySite.pass ? "GREEN" : "RED"} · liveness ${liveness.ok ? "green" : "RED"}` +
    `${dead.length ? ` · DEAD: ${dead.join(", ")}` : ""}`);
  console.log(`\n  Read the fortnight with:  npm run soak:report\n`);

  await prisma.$disconnect();
  // Exit 0 even when a check is red. This script's job is to RECORD the night; a non-zero exit
  // would abort the rest of the nightly chain and cost tomorrow's data to report today's fault.
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
