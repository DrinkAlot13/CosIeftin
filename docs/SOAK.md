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

## Rules while it runs

- Do not touch the matcher.
- Do not add merchants.
- Do not chase backlog items.
- No thresholds, no features.
- Bug fixes ONLY if something is actively broken for a user — and logged here, in this file,
  with the date and what changed.

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
