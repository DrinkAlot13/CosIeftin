# The soak

Two weeks unattended. The question is not whether the site is correct today — that has been
measured. It is whether it *stays* correct when nobody is looking, and specifically whether the
checks keep checking.

## How to run it

Nothing to start. `npm run nightly` writes one file per night to `logs/soak/YYYY-MM-DD.json`.

Read the fortnight with one command:

```
npm run soak:report
```

That is the only thing you need to do. **Do not read the individual files** — fourteen of them
is what the report exists to spare you.

## What runs each night, in order

`npm run soak:log`, the last step of `npm run nightly`:

| # | check | why it is where it is |
|---|---|---|
| 1 | `audit:liveness` | **First.** A dead source invalidates everything after it. If a shop stopped answering, its prices are still correct, still pass every correctness check, and are still wrong to show. An entry whose liveness is red is stamped `trustworthy: false`. |
| 2 | `audit:db` | 29 data-integrity invariants, counting every row. |
| 3 | `audit:displayed` | 8 user-facing invariants, counting only rows that reach a page. |
| 4 | `audit:cutover` | Postgres-readiness. |
| 5 | `verify:code` | typecheck, hygiene, allowlist, 760 tests. |
| 6 | `audit:comparability` | the **split** metric — comparison sections and price sections separately. |
| 7 | `pool-contract` | the invariant guarding the mistake that cost three merchants their provenance. |
| 8 | `census` | every withheld row attributed to exactly one reason. |

`verify:site` is recorded as the conjunction of 1–5, which is precisely what the npm script is.
It is not invoked separately, so `audit:liveness` and `audit:db` each run once per night rather
than twice. The verdict is identical; only the runtime differs.

**A crashing audit is a result, not an absence.** Every step is wrapped; one that throws is
recorded as `ok: false` with its last 40 lines. `soak:log` exits 0 even when checks are red —
a non-zero exit would abort the rest of the chain and cost tomorrow's data to report today's
fault.

**`npm run nightly` is a TypeScript orchestrator, not a shell chain**, and that is not a
stylistic choice. The obvious spelling is:

```
"nightly": "npm run nightly:steps || echo failed && npm run soak:log"
```

and on Windows it is wrong in the worst possible way. **cmd.exe parses `A || B && C` as
`A || (B && C)`**, so on every night the scrape chain *succeeded*, `soak:log` would never have
run. A fortnight of perfect nights would have produced an empty directory and the report would
have said "no logs" while everything was fine. bash groups it the other way, so the behaviour
would have depended on which shell npm picked.

`scripts/nightly.ts` spawns the steps, then spawns `soak:log` regardless, and hands the steps'
exit code down so the entry records `nightlySteps: {ok, exitCode}`. The report lists nights where
the chain failed but the log was still written — distinct from a missing night, because those
audits *did* run and are accurate about data that did not get refreshed. The nightly's own exit
code reflects the scrape, not the audits: two invariants are red on purpose and a cron that mails
on non-zero should not mail every night because of them.

## What the report looks for

Three things, in this order, because that is their order of importance:

**1. A merchant with no successful write in 48 hours.** The Metro/Mega shape: both returned zero
products for three days while every correctness check passed, because the drop guard preserved
the data and had no opinion about whether the source still answered. Nothing was *wrong*.
Everything was stale, and stale looked exactly like fine. Reported alongside *claims without
writes* — a run that updated `lastScrapeAt` and produced no offer row.

**2. Invariants that changed state, with the date.** A check that is red every night is not news;
a check that went red on the ninth is. A check that **disappears** from the log is also reported,
because an audit that stops running an invariant looks, in a green summary, exactly like an
invariant that is holding.

**3. Merchants whose offers written moved more than 20% day over day.** A redesign, a partial
run, or a cap that started biting. A zero night is reported as the −100% that produced it and
then does not become the baseline for the next comparison, so a recovery does not divide by zero.

Then comparability over time (the split figure only) and withheld rows by reason over time.

**Missing nights are listed first.** If the chain dies, no file is written, and a directory with
nine files in it looks calm rather than broken.

## The one nightly alert

No daily mail. One exception: **a merchant with no successful write in 48 hours renders a
full-width red banner above the page title on `/admin/health`**, naming the shop, how long it has
been silent, and how many of its offers are still being shown. It renders only when something is
actually wrong — a banner that is always present is wallpaper within a week, and the next real
one goes unread.

Both states were verified by rendering the page against an isolated copy of the database, not by
reading the source: with a merchant aged five days the banner reads *"SURSĂ MOARTĂ — 1 magazin(e)
nu au mai scris de peste 48 h · Metro (5 zile, 5255 oferte încă afișate)"*, and with the same
merchant revived it is absent.

## Two invariants are red on purpose

They will appear in the report's **red on the last night** list every single night. They are not
failures and they are annotated as historical records in the source, headed *"DO NOT TRY TO MAKE
IT GREEN"*:

- **`no active merchant has 2 consecutive runs that produced nothing`** — Kaufland's two aborts
  genuinely happened on 2 September. Deleting the run rows to clear it would falsify the record
  of an outage in order to green a dashboard.
- **`no day moves >50% on more than 5% of the offers written that day`** — the two mass-move days
  are full re-scrapes doing their job. The invariant cannot tell a correction from a corruption
  and should not try; a human looks at any day it fires, both were looked at, both are
  corrections. Tuning the threshold would disable the check for the next real one.

What matters for these two is not that they are red. It is whether they **change** — which is
why the report separates transitions from steady state.

## Before night one counts

The fortnight does not start when the first log appears. It starts when a run has actually
exercised the paths that were broken, and that is checked rather than assumed.

**First, from an ADMIN PowerShell** — the scheduled task is registered but its Logon Mode reads
`Interactive only`, so it will not fire while nobody is logged in. A fortnight the machine slept
through four nights of is not a fortnight:

```powershell
$p = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
Set-ScheduledTask -TaskName "CosMic Nightly" -Principal $p
```

Confirm `Logon Mode` no longer says `Interactive only`.

**Then, after the 04:00 run, all four:**

1. `npm run confirm:night-one` — the verdict, verbatim.
2. `npm run audit:db` — all invariants. Two are red on purpose; see below.
3. The task fired on **its own trigger**, not by hand: `schtasks /query /TN "CosMic Nightly" /V`
   for the result, and `logs/nightly/<date>.log` for what it did.
4. A soak entry exists for the night in `logs/soak/`.

**INCONCLUSIVE is not a failure.** `confirm:night-one` reports a rejected pairing as tested only
if the merchant's OWN LAST RUN re-observed it. A night that did not touch those merchants proves
nothing either way, and the script says so instead of passing. When that happens, name the night
that would settle it and wait for it — do not count night one early.

Its first version measured against a 20-hour window and called an offer "rewritten AND still
withheld" when something else had touched it earlier that day. A check that answers easily is
worse than one that answers rarely.

### Bug fixes made during the soak

Logged here per the rule above. Neither touched the matcher, thresholds, coverage or any
measured input.

**2026-09-06 — `confirm:night-one` could never pass.** Its criterion demanded that each
rejected pairing be RE-OBSERVED by a run, and all five rows had gone stale: their store items
no longer exist under those names. A gate that cannot open is broken. Rewritten to test what
the mechanism actually guarantees — that a NEW offer landing on a rejected (merchant, product)
pair is withheld — and to report "no offer written on this pair since the reject" as its own
state rather than folding it into a pass.

**2026-09-06 — every page rendered the offline fallback while online.** The v1 service worker
treated "the fetch failed" and "you are offline" as one fact, so a stopped dev server showed
"Ești offline" on every route. Rewritten: navigations are network-first, the offline page is
served ONLY when `navigator.onLine` is false, caches are versioned and old ones deleted on
activate, and the worker is not registered in development.

**2026-09-06 — the same fix, verified against the state it was written for.** v2 had only ever
been checked with DevTools offline mode, which is not a dead server. `verify:offline` now walks
five states, and 4 and 5 are the point: server dead + browser online must render "Serverul nu
răspunde", server dead + browser offline must render "Ești offline". Two findings came out of
building it:

- A service worker's `console.error` goes to the WORKER's context, not the page's, so
  "the worker logs it" was untestable and nearly invisible in DevTools too. The worker now
  stamps `<meta name="sw-diagnostic" content="server-down-while-online">` and an
  `X-SW-Diagnostic` header into the response it returns — observable in the artifact itself.
- **`fail()` calls `process.exit`, which skips `finally`**, so every failed run leaked a
  `next start` holding the port. The next run then spawned a server that could not bind, talked
  to the LEAKED one, and "killed the server" by killing a process that never owned the port —
  so state 4 tested a live server and reported the v1 bug had returned. The script now owns its
  server, kills it from `fail()`, and REFUSES to start if the port already answers.

  That is the sixth time a stale dev server has produced a false diagnosis here — the
  ChunkLoadError, two "old copy still rendering" confusions, the smoke-test noise, the report
  that prompted the worker rewrite, and now inside the script written to prevent it.

## Rules while it runs

- Do not touch the matcher.
- Do not add merchants.
- Do not chase backlog items.
- No thresholds, no features.
- Bug fixes ONLY if something is actively broken for a user — and logged here, in this file,
  with the date and what changed.

### Bug fixes during this soak

**2026-09-06 — confirm:night-one had an unsatisfiable criterion.** It demanded the five
rejected rows be re-observed, but all five are stale rows whose store items no longer exist
under those names (Freshful's mici renamed, Sezamo's gelatine gained "foi") — they would never
be re-observed, so the gate on counting night one could never open. It now tests what the
mechanism guarantees: any offer WRITTEN on a rejected (merchant, product) pair since the reject
must be withheld; a pair nothing has landed on reads "nothing to test", never pass, never fail.
Verdict after the fix: NIGHT ONE COUNTS — 2 of 5 pairs took an offer since the reject (the two
renamed items, i.e. the original bug's own pairs) and both were withheld; 3 pairs untested in
production, proven by tests/standing-decisions.test.ts.

**2026-09-06 — every page rendered "Ești offline" to an online browser.** The service worker
treated "this fetch failed" and "we are offline" as one fact: a dead or moved dev server, or a
failed cache.put (which sat inside the same try as the fetch), all rendered the offline page —
and registration ran in development too, so a stale worker kept the trap armed through every
rebuild. Fifteenth instance of the pattern, and visible to a user on every page. sw.js v2:
navigations stay network-first, the offline fallback appears ONLY when `navigator.onLine` is
false, an online fetch failure renders "Serverul nu răspunde" (502) and logs itself as a bug,
cache.put is fire-and-forget, caches are versioned (v1 deleted on activate). Dev never
registers and actively unregisters + drops cosmic-* caches, so recovery needs no DevTools.
Verified by rendered output in a real browser: 5 pages online (no fallback), offline (fallback
+ "Deschide lista" works), back online (recovers, no manual unregistration). `verify:offline`
now runs as part of verify:site — it boots its own `next start` and FAILS on a missing build
rather than skipping.

The point is to find out what breaks when nobody is looking, and changing things underneath the
measurement destroys it. Anything found goes to `docs/BACKLOG.md`, not into the working tree.

### Two things that do NOT disturb the measurement

- **Use the site to shop.** `GroceryList` was empty: the basket flow, the per-shop cart and the
  substitution notices have never met a real user. That is where the next class of problem is,
  and using them changes no measured input.
- **The vocabulary afternoon.** `npm run report:altele` holds the token lists for the catch-all
  leaves. Data edits, not rules — watch for the `purcel de lapte` shape, where a word means
  something else in context, as `crema` and `matura` did.

## Day seven, day fourteen

Day seven: `npm run soak:report`, to confirm the reader works on seven nights rather than on
one. Day fourteen: read it properly.

## Check on day two

That `logs/soak/` has **two** files in it. The third failure mode — the nightly chain failing so
that nothing runs at all — produces no log, no error and no alert, and a soak that never started
looks from the outside exactly like a soak with nothing to report.

## Why the detection logic is tested

`src/lib/soak-analysis.ts` holds the four detectors as pure functions, and
`tests/soak-analysis.test.ts` runs them against fabricated histories that each contain a specific
defect. This is not ceremony. *"No invariant changed state"* is what a working reader prints on a
calm fortnight **and** what a broken one prints on a catastrophic one; the two outputs are
identical. A check nobody has ever seen fire is not known to work — `doseTokens` had never
matched anything, and *"Discovered 90 leaf categories"* was true every night while hiding half
the shop.
