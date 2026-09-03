// ── SCOPE: RECORDER ───────────────────────────────────────────────────────────
// Reads the soak logs. Computes nothing about the site, re-checks nothing, has no opinion
// about whether a price is right. Every fact here was recorded by an audit on the night it
// ran; this only puts fourteen of them side by side.
//
// FOURTEEN DAYS AT ONCE.  Run: npm run soak:report
//
// The soak exists to answer one question — does this hold up when nobody is looking — and the
// failure it is hunting has a specific shape. Metro and Mega Image returned zero products for
// three days while every correctness check passed, because the drop guard preserved the data
// and had no opinion about whether the source still answered. Nothing was WRONG. Everything was
// stale, and stale looked exactly like fine.
//
// So this report leads with the three ways that shape shows up in a log:
//
//   · a merchant with no successful write in 48 hours          — the source died
//   · a merchant whose offers written moved more than 20%      — a redesign, a partial run,
//     day over day                                               or a cap that started biting
//   · an invariant that CHANGED STATE                          — something became true or
//                                                                stopped being true, and the
//                                                                date says which night
//
// A check that is red every night is not news; a check that went red on the ninth is. So state
// changes are reported with their dates and steady states are reported once, as a footnote.
// The same reasoning applies to the two invariants that are red on purpose — Kaufland's aborts
// and the mass-move days — which will sit in the steady-state list and should be ignored there.
//
// A MISSING DAY IS A FINDING. If the nightly chain dies, no log is written, and a directory
// with nine files in it looks calm rather than broken. Gaps are listed explicitly.

import { readdirSync, readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { deadSources, invariantTransitions, missingNights, soakVerdict, writeMoves } from "../src/lib/soak-analysis";

const LOG_DIR = join(process.cwd(), "logs", "soak");

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);
const rule = (n = 78) => "─".repeat(n);

type Invariant = { name: string; pass: boolean; count: number };
type MerchantNight = {
  slug: string;
  offersWritten: number;
  nullRate: number | null;
  rawPriceTextCoverage: number | null;
  productUrlCoverage: number | null;
  liveOffers: number;
  abortedRuns: number;
};
type LivenessRow = { slug: string; hoursSinceWrite: number | null; dead: boolean; claimsWithoutWrites: boolean };
type Entry = {
  date: string;
  nightlySteps: { ok: boolean; exitCode: number } | null;
  trustworthy: boolean;
  trustworthyNote: string | null;
  verifySite: { pass: boolean; components: Record<string, boolean> };
  liveness: { merchants?: LivenessRow[]; dead?: string[]; claimsWithoutWrites?: string[] } | null;
  invariants: {
    "audit:db"?: { invariants?: Invariant[] } | null;
    "audit:displayed"?: { invariants?: Invariant[] } | null;
    "audit:cutover"?: { pass: boolean };
    "pool-contract"?: { pass: boolean };
    "verify:code"?: { pass: boolean };
  };
  comparability: {
    comparison?: { products: number; comparable: number; share: number };
    price?: { pricedShare: number; ladderShare: number; products: number };
  } | null;
  census: { total?: number; byBucket?: Record<string, number> } | null;
  merchants: MerchantNight[];
};

function load(): Entry[] {
  if (!existsSync(LOG_DIR)) return [];
  return readdirSync(LOG_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(LOG_DIR, f), "utf8")) as Entry;
      } catch (e) {
        console.log(`  ⚠ ${f} is not readable JSON: ${String(e)}`);
        return null;
      }
    })
    .filter((e): e is Entry => e !== null);
}

/** Every invariant in one night, flattened to name → pass. Prefixed so two audits can share a name. */
function invariantMap(e: Entry): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const inv of e.invariants["audit:db"]?.invariants ?? []) m.set(`db · ${inv.name}`, inv.pass);
  for (const inv of e.invariants["audit:displayed"]?.invariants ?? []) m.set(`displayed · ${inv.name}`, inv.pass);
  if (e.invariants["audit:cutover"]) m.set("cutover", e.invariants["audit:cutover"].pass);
  if (e.invariants["pool-contract"]) m.set("pool-contract", e.invariants["pool-contract"].pass);
  if (e.invariants["verify:code"]) m.set("verify:code", e.invariants["verify:code"].pass);
  return m;
}

/** Calendar days between two YYYY-MM-DD strings, so a gap in the directory is visible. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function main(): void {
  const entries = load();

  console.log(`\n════ SOAK REPORT ═══════════════════════════════════════════════════════════`);
  if (entries.length === 0) {
    console.log(`\n  No logs in ${LOG_DIR}.`);
    console.log(`  If the nightly has run since the soak was set up, that is itself the finding:`);
    console.log(`  the chain is not reaching \`npm run soak:log\`.\n`);
    return;
  }
  const first = entries[0].date;
  const last = entries[entries.length - 1].date;
  const span = daysBetween(first, last) + 1;
  console.log(`  ${entries.length} night(s) recorded, ${first} → ${last} (${span} calendar days)\n`);

  // ── DID THE FORTNIGHT HAPPEN AT ALL? ─────────────────────────────────────────
  // FIRST, and before any analysis, because every number below is drawn only from nights that
  // were recorded. A fortnight with three holes does not support the conclusions of a fortnight
  // without, and the difference has to be impossible to skim past.
  const expected = Number(process.env.SOAK_NIGHTS ?? 14);
  const verdict = soakVerdict(entries.map((e) => e.date), expected, new Date().toISOString().slice(0, 10));
  console.log(rule());
  if (verdict.complete) {
    console.log(`  ✓ ${verdict.headline}`);
  } else {
    console.log(`  ✗✗ ${verdict.headline}`);
    console.log(`     nights with no log, in the last ${expected} days:`);
    console.log(`     ${verdict.missing.join("  ")}`);
    console.log(`     A night with no log is not a quiet night — nothing ran, or it died before`);
    console.log(`     reaching soak:log. Read everything below as covering ${verdict.recorded} nights.`);
  }
  console.log(`${rule()}
`);

  // ── GAPS INSIDE THE RECORDED RANGE ────────────────────────────────────────────
  // A DIFFERENT QUESTION FROM THE VERDICT ABOVE, and the wording now says so. This finds holes
  // BETWEEN the first and last recorded night; it cannot see nights that were never attempted
  // at all. Worded as "no missing nights" it printed directly under a verdict reporting 13
  // absent — one directory, two checks, and the whole difference was the window each looked at.
  const gaps = missingNights(entries.map((e) => e.date));
  if (gaps.length > 0) {
    console.log(`  ⚠ ${gaps.length} GAP(S) INSIDE THE RECORDED RANGE ${first} → ${last} — the chain`);
    console.log(`    did not run, or died before reaching soak:log.`);
    console.log(`    ${gaps.join("  ")}\n`);
  } else {
    console.log(`  ✓ no gaps between ${first} and ${last} (this says nothing about nights outside that range)\n`);
  }

  // A night the log EXISTS for but the scrape chain died on. Distinct from a missing night: the
  // audits below ran, they are accurate, and they describe yesterday's data.
  const brokenChain = entries.filter((e) => e.nightlySteps && !e.nightlySteps.ok);
  if (brokenChain.length > 0) {
    console.log(`  ⚠ ${brokenChain.length} NIGHT(S) WHERE THE SCRAPE CHAIN FAILED but the night was`);
    console.log(`    still recorded. The audits below ran and are accurate — about data that did`);
    console.log(`    not get refreshed.`);
    console.log(`    ${brokenChain.map((e) => `${e.date} (exit ${e.nightlySteps!.exitCode})`).join("  ")}\n`);
  }

  // ── 1. A MERCHANT WITH NO SUCCESSFUL WRITE IN 48 HOURS ───────────────────────
  // The Metro/Mega shape, and the one thing the brief said must be impossible to miss.
  console.log(rule());
  console.log(`  DEAD SOURCES — no successful write in 48 hours`);
  console.log(rule());
  const deadEvents = deadSources(entries);
  if (deadEvents.length === 0) console.log(`  ✓ none. Every active merchant wrote within 48h on every recorded night.`);
  else for (const d of deadEvents) {
    console.log(d.kind === "silent"
      ? `  ${d.date}  ${pad(d.slug, 14)} ${lp((d.hours ?? 0).toFixed(1), 6)}h since last write`
      : `  ${d.date}  ${pad(d.slug, 14)} CLAIMS WITHOUT WRITES — ran, updated lastScrapeAt, produced nothing`);
  }

  // ── 2. INVARIANTS THAT CHANGED STATE ──────────────────────────────────────────
  console.log(`\n${rule()}`);
  console.log(`  INVARIANTS THAT CHANGED STATE`);
  console.log(rule());
  const transitions = invariantTransitions(entries.map((e) => ({ date: e.date, invariants: invariantMap(e) })));
  if (transitions.length === 0) console.log(`  ✓ no invariant changed state across the recorded nights.`);
  else for (const t of transitions) {
    const label = t.to === null ? "GONE  " : t.to ? "green ←" : "RED   ←";
    const suffix = t.to === null ? "  (the audit no longer reports this check)" : "";
    console.log(`  ${t.date}  ${label} ${t.name}${suffix}`);
  }

  // Steady states, as a footnote. The two deliberate reds live here.
  const lastMap = invariantMap(entries[entries.length - 1]);
  const steadyRed = [...lastMap.entries()].filter(([, p]) => !p).map(([n]) => n);
  if (steadyRed.length > 0) {
    console.log(`\n  RED ON THE LAST NIGHT (${entries[entries.length - 1].date}) — check the list above for`);
    console.log(`  whether each one CHANGED, which is the part that is news:`);
    steadyRed.forEach((n) => console.log(`    ✗ ${n}`));
    console.log(`\n  Two of these are red on purpose and documented in the source as historical`);
    console.log(`  records: Kaufland's two aborts genuinely happened, and the mass-move days are`);
    console.log(`  full re-scrapes doing their job. Do not tune either one green.`);
  }

  // ── 3. OFFERS WRITTEN, DAY OVER DAY ───────────────────────────────────────────
  console.log(`\n${rule()}`);
  console.log(`  OFFERS WRITTEN — day-over-day moves greater than 20%`);
  console.log(rule());
  const moves = writeMoves(entries);
  if (moves.length === 0) console.log(`  ✓ no merchant moved more than 20% between recorded nights.`);
  else for (const m of moves) {
    console.log(
      `  ${m.date}  ${pad(m.slug, 14)}${lp(m.from, 8)} → ${lp(m.to, 6)}  ` +
      `${lp((m.pct > 0 ? "+" : "") + m.pct.toFixed(0) + "%", 7)}   (from ${m.fromDate})`,
    );
  }

  // ── 4. COMPARABILITY OVER TIME ────────────────────────────────────────────────
  console.log(`\n${rule()}`);
  console.log(`  COMPARABILITY OVER TIME  (comparison sections only — grocery + alcool)`);
  console.log(rule());
  console.log(`  ${pad("date", 12)}${lp("comparable", 12)}${lp("of", 9)}${lp("share", 8)}` +
    `${lp("priced%", 10)}${lp("ladder%", 9)}   site`);
  for (const e of entries) {
    const c = e.comparability?.comparison;
    const p = e.comparability?.price;
    console.log(
      `  ${pad(e.date, 12)}${lp(c?.comparable ?? "—", 12)}${lp(c?.products ?? "—", 9)}` +
      `${lp(c ? c.share.toFixed(1) + "%" : "—", 8)}${lp(p ? p.pricedShare.toFixed(1) + "%" : "—", 10)}` +
      `${lp(p ? p.ladderShare.toFixed(1) + "%" : "—", 9)}   ${e.verifySite.pass ? "green" : "RED"}` +
      `${e.trustworthy ? "" : "  ⚠ liveness red — figures describe a dead source"}`,
    );
  }
  console.log(`\n  The blended figure is deliberately absent. It moves when the catalog's`);
  console.log(`  composition changes, so a fortnight of it would record DCNeu's growth as a`);
  console.log(`  decline in matching quality.`);

  // ── 5. WITHHELD ROWS BY REASON, OVER TIME ─────────────────────────────────────
  console.log(`\n${rule()}`);
  console.log(`  WITHHELD ROWS BY REASON`);
  console.log(rule());
  const buckets = new Set<string>();
  for (const e of entries) for (const k of Object.keys(e.census?.byBucket ?? {})) buckets.add(k);
  // Only buckets that are non-zero somewhere, plus the one that must always be zero.
  const shown = [...buckets].filter(
    (b) => b === "no reason found" || entries.some((e) => (e.census?.byBucket?.[b] ?? 0) > 0),
  );
  // Abbreviations are explicit rather than a truncation of the bucket name: slicing to eight
  // characters turned "quarantined" and "out of stock" into "quaranti" and "out of s".
  const SHORT: Record<string, string> = {
    "live": "live",
    "stale (not seen in a feed)": "stale",
    "out of stock": "oos",
    "expired (past promoValidTo)": "expired",
    "merchant not scraped in last run": "notrun",
    "flagged by a sanity gate": "flagged",
    "quarantined (unresolved PriceAnomaly)": "quarant",
    "merchant inactive": "inactive",
    "no reason found": "NOREASON",
  };
  const short = (b: string) => SHORT[b] ?? b.slice(0, 9);
  console.log(`  ${pad("date", 12)}${lp("total", 8)}${shown.map((b) => lp(short(b), 10)).join("")}`);
  for (const e of entries) {
    console.log(
      `  ${pad(e.date, 12)}${lp(e.census?.total ?? "—", 8)}` +
      shown.map((b) => lp(e.census?.byBucket?.[b] ?? "—", 10)).join(""),
    );
  }
  const noReasonNights = entries.filter((e) => (e.census?.byBucket?.["no reason found"] ?? 0) > 0);
  console.log(noReasonNights.length > 0
    ? `\n  ✗ "no reason found" is NON-ZERO on ${noReasonNights.length} night(s): ` +
      `${noReasonNights.map((e) => `${e.date} (${e.census?.byBucket?.["no reason found"]})`).join(", ")}\n` +
      `    That bucket exists to catch a data loss hiding inside a legitimate one. It must be zero.`
    : `\n  ✓ "no reason found" is zero on every recorded night — every withheld row is accounted for.`);

  // ── 6. PROVENANCE AND NULL RATE, LAST NIGHT ───────────────────────────────────
  const lastEntry = entries[entries.length - 1];
  console.log(`\n${rule()}`);
  console.log(`  LAST NIGHT (${lastEntry.date}) — per merchant`);
  console.log(rule());
  console.log(`  ${pad("merchant", 14)}${lp("written", 9)}${lp("live", 9)}${lp("null%", 8)}` +
    `${lp("rawText", 9)}${lp("prodUrl", 9)}${lp("aborts", 8)}`);
  for (const m of lastEntry.merchants) {
    const p = (v: number | null) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
    console.log(
      `  ${pad(m.slug, 14)}${lp(m.offersWritten, 9)}${lp(m.liveOffers, 9)}${lp(p(m.nullRate), 8)}` +
      `${lp(p(m.rawPriceTextCoverage), 9)}${lp(p(m.productUrlCoverage), 9)}${lp(m.abortedRuns || "—", 8)}`,
    );
  }
  console.log(`\n  productUrl is reported, not scored: flyer sources genuinely have none, which is`);
  console.log(`  why the column is nullable rather than defaulted to a generic page.\n`);
}

main();
