// ── SCOPE: EXTERNAL ORACLE — DOES THE RATE LIMITER ACTUALLY FIRE? ─────────────
//
// Rate limiting is the easiest thing in this codebase to *believe* without having. The unit
// tests prove the arithmetic; they cannot prove that a request arriving over HTTP reaches the
// limiter, that the deployment can see who sent it, or that a 429 ever comes back. Those are
// facts about the running system, and CLAUDE.md is explicit that facts about the outside world
// need a source that does not share our assumptions.
//
// ── THE TWO THINGS IT ESTABLISHES.
//
//   1. DOES A LIMIT FIRE AT ALL? It sends more requests than the budget allows and looks for a
//      429. No 429 means the guard is not on that route, however good the library is.
//
//   2. CAN THE DEPLOYMENT TELL CALLERS APART? A per-IP limiter that cannot see an IP is a
//      GLOBAL limiter wearing a per-IP name — one caller then exhausts everyone's budget. The
//      probe sends a second burst under a different `x-forwarded-for` and sees whether it gets
//      a fresh budget. Which answer is CORRECT depends on TRUST_PROXY, and the script says so
//      rather than scoring it: with TRUST_PROXY unset, refusing to distinguish is the RIGHT
//      behaviour, because trusting a client-supplied header would let an attacker mint budgets.
//
// ── WHY IT IS ALLOWED TO BE NOISY. It deliberately exhausts a budget on a real endpoint, so
// run it against a server you own. It picks `/api/alternatives`, which computes nothing
// expensive for an empty body and writes nothing at all.
//
//   npm run audit:rate-limit
//   npm run audit:rate-limit -- --base=http://localhost:3000
//   npm run audit:rate-limit -- --json logs/rate-limit.json

import { LIMITS, effectiveMax } from "../src/lib/rate-limit";
import { emitJson } from "../src/lib/audit-json";

const PATH = "/api/alternatives";
const UA = "CosMicRateLimitCheck/1.0 (+https://cosmic.ro)";

type Burst = { sent: number; ok: number; limited: number; other: number; firstLimitedAt: number | null };

async function burst(base: string, n: number, xff?: string): Promise<Burst> {
  const out: Burst = { sent: 0, ok: 0, limited: 0, other: 0, firstLimitedAt: null };
  for (let i = 0; i < n; i++) {
    const headers: Record<string, string> = { "user-agent": UA, "content-type": "application/json" };
    if (xff) headers["x-forwarded-for"] = xff;
    const res = await fetch(`${base}${PATH}`, { method: "POST", headers, body: JSON.stringify({ slugs: [] }) })
      .catch(() => null);
    out.sent++;
    if (!res) { out.other++; continue; }
    if (res.status === 429) {
      out.limited++;
      if (out.firstLimitedAt === null) out.firstLimitedAt = out.sent;
    } else if (res.ok) out.ok++;
    else out.other++;
    // Drain the body so the connection is reused rather than left half-open.
    await res.text().catch(() => "");
  }
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let base = process.env.SITE_BASE ?? "http://localhost:3000";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--base=")) { base = a.slice(7); continue; }
    if (a.startsWith("--max-requests=")) continue;
    if (a === "--json") { i++; continue; }
    if (a.startsWith("--json=")) continue;
    console.error(`audit:rate-limit — unrecognised argument ${JSON.stringify(a)}. Refusing to run.`);
    process.exit(2);
  }
  base = base.replace(/\/+$/, "");

  const trustProxy = process.env.TRUST_PROXY === "1";

  // ── THE EFFECTIVE BUDGET, NOT THE NOMINAL ONE.
  //
  // The first version of this script sent `LIMITS.write.max + 5` requests, saw no 429, and
  // reported "NO LIMIT FIRED" — a confident claim about the system that was actually a bug in
  // the check. With no trusted proxy every caller is unidentified and shares ONE bucket with
  // its own larger budget, so the real threshold was thousands and the probe stopped at 65.
  //
  // That is this project's most-repeated defect wearing a new hat: a number that was never
  // observed, reported as an observation. The expectation is now DERIVED from the same
  // constants the limiter uses, so the two cannot drift apart.
  const nominal = LIMITS.write.max;
  // DERIVED from the limiter itself, never recomputed here: an audit that models the thing
  // it audits will eventually model it wrongly, and report that as a finding about the system.
  const effective = effectiveMax("write", trustProxy ? "probe" : null);

  const capArg = process.argv.find((a) => a.startsWith("--max-requests="));
  const cap = capArg ? Number(capArg.split("=")[1]) : 4000;
  const n = Math.min(effective + 5, cap);
  const reachable = n > effective;

  console.log("═".repeat(96));
  console.log("RATE LIMIT — does it fire, and can it tell callers apart?");
  console.log(`base ${base}   endpoint ${PATH}`);
  console.log(`nominal budget ${nominal}/${LIMITS.write.windowMs / 1000}s   EFFECTIVE ${effective} (${trustProxy ? "per caller" : "shared"})`);
  console.log("═".repeat(96));

  const alive = await fetch(base, { headers: { "user-agent": UA } }).then((r) => r.ok).catch(() => false);
  if (!alive) {
    console.error(`\n  CANNOT REACH ${base}. That is a FAILURE, not a pass: a check that quietly`);
    console.error(`  does nothing is worse than no check. Start the server and run this again.`);
    emitJson({ base, pass: false, reason: "server-unreachable" });
    process.exit(1);
  }

  console.log(`\n  BURST 1 — ${n} requests, no forwarded address`);
  const first = await burst(base, n);
  console.log(`    ok ${first.ok}   429 ${first.limited}   other ${first.other}` +
    `   first 429 at request ${first.firstLimitedAt ?? "-"}`);

  console.log(`\n  BURST 2 — ${n} more, claiming a different address via x-forwarded-for`);
  const second = await burst(base, n, "203.0.113.7");
  console.log(`    ok ${second.ok}   429 ${second.limited}   other ${second.other}` +
    `   first 429 at request ${second.firstLimitedAt ?? "-"}`);

  console.log(`\n${"─".repeat(96)}`);
  console.log("VERDICT");
  console.log("─".repeat(96));

  const fires = first.limited > 0;
  if (fires) {
    console.log(`  ✓ the limit fires: first 429 at request ${first.firstLimitedAt} of an effective ${effective}.`);
  } else if (!reachable) {
    console.log(`  ? INCONCLUSIVE — the effective budget is ${effective} and this run was capped at ${n}.`);
    console.log(`    Not a pass and not a failure: the threshold was never approached. Raise it with`);
    console.log(`    --max-requests=${effective + 5}, or set TRUST_PROXY=1 so callers are counted separately.`);
  } else {
    console.log(`  ✗ NO LIMIT FIRED across ${first.sent} requests against an effective budget of ${effective}.`);
    console.log(`    Either the guard is not on ${PATH}, or the process restarted mid-run — the`);
    console.log(`    limiter is in memory, so a rebuild resets every window.`);
  }

  // ── THE SECOND QUESTION IS ONLY ANSWERABLE ONCE THE FIRST BUDGET IS SPENT.
  //
  // "A different address got a fresh budget" only means anything if the ORIGINAL budget was
  // exhausted. While burst 1 is still under the limit, burst 2 succeeds because nothing is
  // limiting anyone yet — and reading that as "callers are told apart" is how the first run of
  // this script reported a HOLE that did not exist.
  const distinguishes = second.ok > 0;
  console.log("");
  if (!fires) {
    console.log(`  CALLER SEPARATION: UNTESTED. Burst 1 never hit its limit, so burst 2 succeeding`);
    console.log(`  says nothing about whether callers are told apart — only that nobody was being`);
    console.log(`  limited yet. Re-run with a burst that reaches ${effective + 5}.`);
  } else if (trustProxy) {
    console.log(`  TRUST_PROXY=1 — forwarded addresses are believed.`);
    console.log(distinguishes
      ? `  ✓ a different x-forwarded-for got a fresh budget, so callers ARE told apart.`
      : `  ✗ a different x-forwarded-for did NOT get a fresh budget. Either nothing is`);
    if (!distinguishes) console.log(`    forwarding the header, or the limiter is not reading it.`);
  } else {
    console.log(`  TRUST_PROXY is NOT set — forwarded addresses are deliberately ignored.`);
    console.log(distinguishes
      ? `  ✗ a client-supplied header still bought a fresh budget. That is a HOLE: an attacker\n    mints a new budget per request.`
      : `  ✓ a client-supplied header bought nothing, which is correct while nothing in front\n    of this server rewrites it.`);
    console.log(`\n  THE COST OF THAT CHOICE, STATED PLAINLY: with no trusted proxy, no caller can be`);
    console.log(`  identified, so EVERY caller shares ONE bucket of ${effective}. That bounds`);
    console.log(`  a runaway script; it does NOT stop a determined attacker, and it means one`);
    console.log(`  attacker can spend everybody's budget. Put a reverse proxy in front that`);
    console.log(`  overwrites x-forwarded-for, then set TRUST_PROXY=1.`);
  }

  // An unreachable threshold is INCONCLUSIVE, and inconclusive is not success.
  // Separation is only scored when the limit actually fired; otherwise it is untested,
  // and untested is neither a pass nor a failure.
  const separationOk = !fires ? null : (trustProxy ? distinguishes : !distinguishes);
  const pass = (fires || !reachable) && separationOk !== false;
  emitJson({
    base, trustProxy, nominalBudget: nominal, effectiveBudget: effective, requestsSent: n, thresholdReachable: reachable,
    firstBurst: first, secondBurst: second,
    limitFires: fires, distinguishesCallers: distinguishes, separationOk,
    pass,
  });
  if (!pass) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
