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

### Changes made during the soak

Logged here per the rule above. None touched the matcher, thresholds, coverage, the merchant
list or any measured input.

**2026-09-10 — SERVICE WORKER v2 → v3. Flagged because the soak rules single this out.**
Precache list gains `/lista/in-magazin` (the new in-shop screen) and the two new PNG icons; the
cache VERSION is bumped so v2's caches are deleted on activate, which is what the versioning was
built for. No change to the fetch strategy, the online/offline distinction, or the five states
`verify:offline` walks — all five re-verified after the change and reported in the session notes.

**2026-09-10 — the public read API (`/api/v1/*`).** Additive: new read-only routes, new named
rate limits, and an index on `Offer.productUrl`. No existing route changed, no scraper touched,
no threshold moved. `docs/API.md` is the spec. The soak's measured inputs are unaffected because
nothing the nightly audits read is written by any of it.

**2026-09-10 — GDPR erasure cascade.** `onDelete: Cascade` on five relations, applied with
`prisma db push`. Schema-only; no offer, product or match row is touched by it.

**2026-09-10 — the browser extension (`extension/`).** Entirely outside the app: a Manifest V3
content script plus its own tests. It reads `/api/v1/lookup` over the network like any other
client and writes nothing. No route, scraper, threshold or migration involved.

**2026-09-10 — `audit:off-hitrate`, the barcode-scanning measurement.** Read-only and additive:
one new script, one new `package.json` entry. It issues 200 outbound requests to Open Food Facts
at 1.1 s intervals and calls `decide()` in-process to score candidates; **it writes nothing to
the database and does not touch the matcher, thresholds, coverage or the merchant list.** It
imports `AUTO_MATCH_THRESHOLD` rather than restating it, per the oracle rule. A soak reader
seeing outbound traffic to `openfoodfacts.org` on this date should attribute it here.

**2026-09-10 — the golden-set baseline lock.** Test-only. `tests/golden/baseline.json` plus
three assertions in `matching.test.ts`, and a shared `tests/golden/evaluate.ts` so the test and
the new `golden:baseline` generator cannot compute different verdicts. **The matcher, the
thresholds, the coverage and the merchant list are untouched** — no scorer, no constant and no
pair label was changed, and the golden set's numbers are identical before and after (95.0%,
228/240, 1 false match). It adds a check that was missing; it changes nothing the soak measures.

**2026-09-10 — `probe:ean` rewritten (EAN ceiling measurement).** Read-only. It fetches product
detail pages with Playwright and writes nothing; the rewrite adds checksum validation via
`parseEan`, samples only products with no EAN, honours robots.txt and reports cost. **No matcher
rule, threshold or merchant-list change.** It issued 45 outbound page loads across 12 merchant
sites on this date — a soak reader seeing that traffic should attribute it here. Findings in
`docs/EAN-COVERAGE.md`.

**2026-09-10 — `propose:class-opportunities` (Phase 1a of the comparability plan).** Read-only
and additive: one new script, one `package.json` entry. It runs Prisma reads only — **no write,
no assignment, no class created** — and touches no matcher rule, threshold, coverage figure or
merchant-list entry. It imports `headNoun` and `normalizeRo` rather than restating either. Output
is a reading aid in `reports/` (gitignored); findings in `docs/PHASE-1A-OPPORTUNITIES.md`. The
soak's measured inputs are unaffected.

**2026-09-10 — the brand backfill: WRITTEN, THEN ROLLED BACK. The only data write this session.**
`backfill:brands --write` set `Product.brand` on 414 grocery products and marked each with
`ProductAttribute(key="brand", source="merchant-feed")`. `audit:brands` — which imports only
PrismaClient — found 75.8% of them named a brand appearing in no name we hold, so
`backfill:brands --clear --write` removed exactly those 414 and their marks. **Verified back at
baseline: 21,262 branded products (66.4%), 0 marks remaining, and `audit:fanout` reports the same
worst group 7 / grocery p95 2 as before.** No matcher rule, threshold or merchant-list change; no
offer, price or match row touched. `audit:brand-gap`, `backfill:brands` and `audit:brands` are new
and read-only apart from the reverted write. Findings in `docs/BRAND-GAP.md` — including that
Carrefour's brand field is wrong ~46% of the time, which is a live defect left unfixed because
fixing a scraper mid-soak is out of scope.

**2026-09-10 — `probe:brand` (Sezamo and Carrefour detail pages).** Read-only, network. 65
outbound page loads across two merchant sites; writes nothing. **No scraper, matcher rule,
threshold or merchant-list change** — the Carrefour brand defect it documents is deliberately left
unfixed until after the soak. Findings in `docs/SEZAMO-BRAND.md` and `docs/CARREFOUR-BRAND.md`.

**2026-09-10 — CARREFOUR BRAND VOIDED. This CHANGES WHAT THE NIGHTLY WRITES, and is the only
lasting data change this session.** Two parts:

1. `scrape-carrefour.ts` now passes `brand: ""` instead of `data-brand`. **Not a behaviour change
   to how the page is read** — `data-brand` is still captured in `rawSourceBlob` — it is declining
   to WRITE a field measured at 53.8% agreement against merchants at 98.8% and 97.7%. From this
   date Carrefour contributes no brands. A reader comparing Carrefour brand coverage before and
   after this date should expect it to fall, and that is the intent.
2. `null:carrefour-brands --write` voided **1,266** existing brands: those equal to Carrefour's
   listing value AND absent from Carrefour's own product name AND uncorroborated by another
   merchant's payload. 625 were SPARED by those guards. Previous values are stored in
   `ProductAttribute("brand:pre-carrefour-void")` and `--restore --write` reverses it exactly.

Nothing else touched: no matcher rule, no threshold, no coverage figure, no merchant-list entry,
no price, offer or match row. `audit:fanout` (worst group 7, grocery p95 2) and the golden set
(95.0%, 1 false match) are UNCHANGED — and neither could move, since the golden set carries
literal names and fan-out reads existing offer→product assignments rather than recomputing them.
The measurable effect is latent and estimated by simulation: of 200 sampled voided products, 114
had a plausible partner in the catalog, **0 would match a second merchant with the old brand and
18 without**, so roughly 114 of the 1,266 become newly matchable at the next re-match. Details in
`docs/CARREFOUR-BRAND.md`.

**2026-09-10 — `backfill:detail-brands` committed UNRUN.** Harvests brands from Sezamo and
Carrefour detail pages. **It has not been run and writes nothing until it is**; queued for after
the soak in `docs/BRAND-BACKFILL-QUEUE.md`. The brand reader moved to
`src/lib/brand/from-detail-page.ts` so `probe:brand` and the backfill share ONE implementation —
a probe measuring coverage with a different reader than the backfill uses would be measuring a
rule nobody runs. No scraper, matcher rule, threshold or merchant-list change.

**2026-09-10 — PHASE 1b BATCH 1: 8 new equivalence classes + 2 window corrections. CATALOG
CHANGE.** `seed:batch1 --write` then `propose:equivalence --apply`. 8 new grocery classes
(cidru-mere-033, cidru-pere-033, tofu-natur-300g, busuioc-uscat-30g, bors-acru-1l,
cartofiori-800g, lipie-alba-500g, lipie-graham-500g); `afine-kg` and `zmeura-kg` had
`minUnitSize` corrected 0.15 → 0.10 because the standard fresh punnet is 125 g and the floor
excluded it. One pre-existing false member removed (`Mcvities … PINK Digestives` in `zmeura-kg`).
**No matcher rule, threshold, coverage figure or merchant-list entry touched** — equivalence
classes are a display/substitution layer and do not affect matching. Strict comparability is
UNCHANGED at 3,526; comparable-or-equivalent 4,585 → 4,690. Reversible with
`seed:batch1 --remove --write`. Every class printed in full by
`audit:private-label-classes --slugs=…`.

**2026-09-10 — PHASE 2: price history on product pages. SCHEMA CHANGE + NIGHTLY CHANGE.**
Two nullable columns on `Product` (`observedLowBani`, `atObservedLow`) plus one index, applied
with `prisma db push`; `schema.postgres.prisma` regenerated. `compute:home` now fills them and
CLEARS them to NULL like the other precomputed signals, and its runtime went from ~25 s to
**29.4 s** because it loads 116,827 history rows for the price story — a soak reader seeing the
nightly a few seconds longer from this date should attribute it here. **No matcher rule,
threshold, coverage figure or merchant-list entry touched; no price, offer or match row written.**

Also REPLACES a live over-claim: the product page rendered *"Moment bun de cumpărat — preț la
minimul istoric"* off four observations with no check on the observed span. History began
2026-08-06, so "istoric" described 35 days. `lib/price-story` now states the span it measured and
refuses to speak under 14 days.

**2026-09-10 — PHASE 3: delivery-platform prices are now VISIBLE. USER-FACING CHANGE.**
Platform (Glovo) offers render on product pages, labelled, from this date. They remain
**ineligible** to be "cel mai mic preț", the recommended shop, the `✓ Cel mai mic preț` badge, or
part of the shelf merchant count — `isCurrent` already excluded them and `summarize`/`bestOffer`
are built on it. Structured data (JSON-LD) still excludes them, because Google renders a price
with no room for a label.

**Three live defects were found by making them visible, and all three predate this change:**
`bestOffer`'s `?? offers[0]` fallback reached a platform row; `OfferTable` badged the cheapest
row of any kind as "Cel mai mic preț" and landed it on a Glovo price; and the **optimizer had no
platform exclusion at all** — neither basket route selected `priceSource` and the merchant list
is "every active merchant", so /lista has been recommending "Completează coșul la Profi (Glovo)"
with a marked-up total and no label, which CLAUDE.md describes as already prevented. The basket
now excludes platform prices by default with an explicit opt-in toggle.

**No matcher rule, threshold, coverage figure or merchant-list entry changed.** Strict
comparability is unaffected and still reported on its own (`audit:comparability`: grocery 2,878);
`audit:platform` reports the platform-shown figure separately (3,462). New read-only scripts:
`audit:platform`, `shots`.

**2026-09-10 — PHASE 4: basket-first homepage. USER-FACING CHANGE, no data change.**
The hero now renders `<HomeBasket>` — eight staples pre-filled (derived from `INDEX_BASKET` by
live shop coverage, not a hardcoded slug list), editable, calling `/api/basket` and answering
"coșul tău costă X la Y". Search stays directly above it; the category grid and the stats strip
move below. Comparability is no longer the page's headline claim; the strict count is untouched
and still on /metodologie and /admin/stats. **No query, scraper, matcher rule, threshold or
merchant-list change** — the basket calls the same endpoint /lista already used. `probe:overflow`
at 390px: no element past the viewport.

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

**2026-09-06 — every category page took 9 seconds.** The sidebar's `getCategoryNav` ran one
`product.count()` per category — 85 correlated `offers: { some: … }` subqueries on every page
load. `Promise.all` made them concurrent, not cheap: SQLite still ran 85 scans. The page's own
product query was 93 ms, so 99% of the wait was navigation furniture.

Rewritten as a single pass that fetches the live offers once and groups them in memory, the way
`getComparability` already answered a bigger question in 262 ms. **8.5 s → 0.51 s**, and the
counts were diffed old-against-new before the change was kept: uncategorised 1895 = 1895, total
17919 = 17919, all 74 leaves identical. Speed is worth nothing here if the numbers move, because
the nav's whole promise is that its count equals the list it heads — still 106 = 106 on
`/c/lapte`. Category pages now load in 0.4-0.6 s.

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

## The soak is closed — 2026-09-15, 14 of 14 nights, no gaps

`npm run soak:report`: 14 nights recorded 2026-09-02 -> 2026-09-15, no gaps in that range, every
withheld row accounted for on every night, no invariant silently disappeared without the report
naming it GONE. Comparability rose from ~2,000 (week one) to a stable ~3,100-3,234 (week two);
the 09-11 Carrefour-brand-void jump held rather than reverting. Full numbers in the session
report, not restated here — this file logs what changed, not the daily reads.

**One live finding from the final night, addressed the same day.** `audit:fanout` went red
(worst group 12, target <= 8) because Kaufland's flyer week doubled its offers and three flyer
lines carry no variant name: "Nivea Gel de duş 500 ml" matched 12 different Nivea gels, "Lay's
Chipsuri 170 g" matched 7 flavours, "Dove Deodorant spray 150 ml" matched 6 scents. All three
were currently live and winning "cel mai mic preț" on every page they touched. Withheld via
`withhold-flyer-fanout.ts` (the reject mechanism — MatchOverride, not a matcher change): 25
offers flagged, 25 reject rows written, one per (merchant, productId) since all offers in a
group share one storeName and therefore one storeKey base — each row's key is suffixed with its
productId to avoid the upserts collapsing onto each other. Verified: `audit:fanout` now reports
Kaufland max=4, worst-anywhere=8 (target met), and the Nivea Power Refresh page now shows
Metro's 16,52 rather than the withheld 14,99.

## 2026-09-16 — the flyer fan-out rule, properly. MATCHER CHANGE.

Generalizes the manual 25-offer withhold from the soak's last night into a real rule in
`matchPoolToCatalog` (scrape-util.ts, PASS 2): when one physical store item clears `decide()`
for 2+ different catalog products, none are confirmed — all are recorded refused (PendingMatch,
reason "flyer-fanout") rather than one being picked arbitrarily. Golden-set-graded first
(`tests/flyer-fanout.test.ts`, real Nivea/Lay's/Dove names, written before the fix landed);
existing 240-pair golden set is UNCHANGED (95.0%, false matches 1) because the veto lives in the
multi-candidate arbitration layer, not in `decide()` itself, which the pairwise golden set grades.

**Scoped to `storeType === "physical"` (today: Kaufland, Penny), not catalog-wide — measured,
not assumed.** `audit:flyer-fanout` found that applying the veto to every merchant hits 3,298
groups / 7,155 offers and would take grocery comparability from 11.4% to 5.8% (-1,852 products).
A large share of that is not the flyer defect at all but PRE-EXISTING CATALOG DUPLICATE ROWS
(same product, two ids — e.g. "Suc de mere Ana Are, 3 l" as both #1906 and #38584), which this
rule cannot distinguish from genuine ambiguity: both look identical to `decide()`. Scoped to
physical-only merchants (the two with no online catalog to check against, i.e. literally "a
flyer offer" — a property of the merchant, not a hand-picked slug list), the real numbers are
25 groups / 61 offers / comparability -32 (3,789 -> 3,757) — the "falls slightly" originally
expected. The catalog-wide number is reported as a separate, real finding requiring its own
decision, not folded into this one.

One genuine root cause found along the way: pure numeric variant codes (L'Oreal hair-dye shade
"613", Metro shrimp count "30/40") are swallowed by the SIZE_TOKEN regex as size noise, so
`decide()` cannot see them as distinguishing content — a pre-existing defect this rule catches
defensively (refuses rather than smears) but does not fix at the root. Flagged, not touched.

## 2026-09-16 — compute:home widened past grocery. NIGHTLY SCOPE CHANGE.

`compute:home` computed the price story (`observedLowBani`/`atObservedLow`) and the shelf signals
(`dropPct`/`spreadPct`/`dealScore`/`liveOfferCount`) for `section: "grocery"` only, so dcneu's
products with 14+ days of price history got no price story — not because their history was too
short, but because nothing asked the question for them. Widened to all 5 sections. Verified safe
before widening: `getDeals()` and `getHomeSections()`'s drop query both filter `section:
"grocery"` independently in their OWN queries, so no page changes what it shows — grep found no
reader of these four columns that does not also filter by section itself.

Measured result, same run: grocery 32,893 products / 10,467 with a story; **dcneu 10,828 / 5,537
with a story** (matches the ~5,530 estimate); alcohol 1,530 / 442 with a story. Alcohol was
measured at 0-with-14-days on 2026-09-10-11; six days later the history table has grown from ~35
to 40 days, so some alcohol products have now crossed the 14-day threshold on their own — nothing
was special-cased for it, the same gate just now has more calendar to work with. `audit:db`'s
existing precomputed-signal invariants (already section-agnostic) pass unchanged.

The soak's own rule — do not touch the matcher, thresholds, coverage or merchant list — held
throughout it. Everything below this line is dated after 2026-09-15 and is deliberately no
longer bound by it; each entry says which invariant that section's own rule now answers to.

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

### Soak-period fix 5 — the whole site was uncacheable, and nothing said so (2026-09-07)

`revalidate = 3600` was declared on seven routes and had **never once taken effect**. `next
build` prerendered nothing but `robots.txt` and `sitemap.xml`; all 32 routes were `ƒ (Dynamic)`.

Bisected across five builds, because guessing would have been cheaper and wrong:

1. a page containing literally `<p>probe</p>` with `revalidate = 3600` → dynamic
2. the layout's `getMenuCategories()` replaced with `[]` → still dynamic
3. layout stripped to bare `<html><body>` → **10 routes prerender**
4. metadata and scripts restored, components removed → still 10
5. `<Header>` + `<Footer>` restored → back to 2

`Header` awaited `getCurrentUser()`, which reads a cookie. In Next 14 a `cookies()` call anywhere
in the tree opts the WHOLE route out of static generation — and the Header is in the root
layout, so it opted out every page in the site. The session moved to `/api/me` and a client
`<AccountMenu>`.

This is the same shape as the earlier `force-dynamic` layout bug: the fix corrected the layout's
own segment config, the real bailout was one component deeper, and the comment left behind
described caching that still never happened. `tests/route-config.test.ts` checks the
DECLARATIONS agree; it cannot see whether anything is cached.

**Does not touch the matcher, thresholds, or coverage.** Query SHAPES changed (fewer columns,
bounded queries, precomputed `spreadPct`/`dealScore`/`liveOfferCount`) but every filter still
reduces to `currentOfferWhere()` / `isCurrent`. `verify:counters` compares the numbers on the
rendered page against the database and passes on all five.

Also fixed here: `liveOffer` was a module-level `const`, so the homepage counters' 14-day window
was pinned to server boot and drifted wider the longer the process stayed up. Now a function.

Measured, production build, warm: `/oferte` 6.43 s → 0.10 s, `/search` 4.80 s → 0.77 s,
`/necategorisate` 1.60 s → 0.44 s, `/` 0.56 s → 0.008 s, `/c/lapte` 0.65 s → 0.10 s.
New gate: `npm run verify:perf` fails any route over 1 s.

### Soak-period fix 6 — images: the renderer was throwing away pictures it had (2026-09-07)

**Changes what scrapers write.** Logged here so day fourteen can be read against it.

Diagnosed in two layers, and the second contradicted the first:

- **Database:** 97.1% of live products carry a usable image URL. Only Carrefour (851 of 2,165,
  39.3%) and DCNeu (67) hold placeholders. One product has no URL at all.
- **Browser:** `/c/branzeturi` rendered 494 cards and **421 of them showed initials**, while
  ZERO image requests failed. The catalog had the URLs; the page was discarding them.

`ProductImage` started a 3-second timer on MOUNT for every card, and swapped in the placeholder
if the image had not finished. Combined with `loading="lazy"` — correct, and kept — that
measures the wrong thing: an image below the fold has not started loading, so three seconds
later it is not late, it was never asked for. The more cards on a page, the more got blanked.
This project's recurring defect, in the renderer this time. The timer now starts when the image
enters the viewport, and runs for 8 s.

Scraper changes (these alter what is written):

- `pickImageUrl` (`lib/image-src`) decides which `<img>` attribute is the photograph.
  `scrape-carrefour`, `scrape-carrefour-alcohol` and `scrape-finestore` read `src` FIRST and
  `data-src` second, so on a lazy-loading site they stored the spinner and the fallback never
  ran. The scrapers now collect raw attributes; the choice is made once, in Node, under test.
- `imageUrlToStore` is the write gate: refuses spinners, data: URIs, data: URIs glued onto an
  origin (`https://www.penny.ro/data:image/jpeg;base64,…`, observed live), non-http schemes and
  bare origins. `usableImageUrl` now delegates to it, so the renderer refuses exactly what the
  writer refuses.
- A catalog image that is itself a placeholder now counts as no image, so a later merchant's
  real photograph replaces it. Previously whichever shop was scraped first owned the picture.
- `poolCompleteness` reports `withUsableImage` alongside `withImage`, so a merchant that starts
  serving placeholders is loud in the run line.

Verified against the live site, one page, no crawl: `verify:carrefour-images` on
`bacanie-carrefour/alimente/lapte-si-derivate-lapte-uht` — old read 12 usable of 24, new read
24 of 24, **12 recovered**.

Verified in a browser after the fix: initials 421 → **0** on `/c/branzeturi`, 59 → 1 on
`/c/lapte`, and **zero failed image requests on every host**.

Measured and NOT built: of the 918 live products holding a placeholder, **0** are priced by any
other shop. Cross-merchant image borrowing would fix none of them today, so `Offer.image` was
not added. Those 918 are fixed only by re-scraping Carrefour and DCNeu, which the nightly does.

### Soak-period fix 7 — Glovo was never scheduled, and "dead" did not say why (2026-09-07)

**Changes what the nightly runs.** Read day fourteen against it: `glovo-kaufland` contributes
offers again from this date, all `DELIVERY_PLATFORM` and excluded from every user-facing surface
by default, so no shown number moves.

`audit:liveness` had `glovo-kaufland` red with 0 live offers, and the last thing in its run
history was an abort on the fabrication guard. That reads as "the guard is blocking it". It was
not: the guard fired once on 2 September at 18:57, the adapter was corrected in the same session
(`productUrl: null`, because Glovo publishes no per-product permalink), and the three runs after
it wrote 2,217 offers each. Then nothing for five days — because **`platform` was never added to
`scrape-all`'s list**. The ingest was built, verified and committed, and nothing ever ran it.

Verified by running it: 2,209 pooled, 2,224 written, 77.2% matched, no abort.

"Dead because blocked" and "dead because unscheduled" arrived as one fact. New guard:
`tests/nightly-covers-merchants.test.ts` fails if any `scrape:*` script is neither in
`scrape-all` nor named in an `UNSCHEDULED` map with a reason. `selgros` and `monitorul` are now
excused there in writing rather than by silence.

The fabrication guard was NOT touched. It was right on the input it was given — the adapter had
been claiming a per-product URL it did not have, which is the schema's stated failure mode
("an absent link must be visibly null rather than silently pointing at a generic page").

### Soak-period change — Indexul CosIeftin switched to basket v2 (2026-09-07)

**Changes what a headline number means.** Day fourteen must not read the v1 and v2 totals as one
series; they measure different baskets. The chart breaks at the boundary and the page says so.

v1: 40 pinned product slugs. v2: 40 equivalence classes, so each shop prices each line with its
own equivalent. v1's 7 stored days are kept and were NOT recomputed; `IndexSnapshot` gained
`version` (backfilled explicitly to 1, not by default) and its unique key moved from `day` to
`(day, version)` so the switch-over day holds both without either overwriting the other.

Also changed here, and each was found by the audit rather than reasoned about:

- **`propose:equivalence` was write-only.** Tightening a class did nothing — "Ceapa granulata
  Kamis 20g" stayed in `ceapa-galbena-kg` after `granulat` was excluded and a 150 g floor added,
  because the product was already assigned and nothing re-checked it. `assign-categories` has
  carried this exact fix for months. Now clears assignments the class no longer accepts.
- **Four meat/potato classes held ZERO products** because they lacked `anySize`: fresh meat comes
  as 0,63 / 2,5 / 4,5 kg and a 1 kg class with ±26% matched none of it. `piept-pui-1kg` 0 → 15,
  `cartofi-1kg` 0 → 24, `carne-porc-1kg` 6 → 56.
- **Weight-sold lines are priced per kilo, not per pack.** Summing pack prices compared a 200 g
  banana at Sezamo against a 1 kg bag at Auchan and read Sezamo as three times cheaper.
- **`propose:equivalence` only ever looked at the grocery section**, so two classes could never
  be filled — reported as a catalog gap when it was a tooling one. Widened, with same-section
  membership now enforced explicitly so classes cannot silently span sections.

Result: 40/40 lines fillable by at least one shop, 0 classes with disagreeing pack sizes, 4 lines
only one shop can fill (oua, margarina, sare, crenvursti). Per shop: Sezamo 30/40, Auchan 26/40,
Metro 22/40, Mega Image 21/40, Freshful 19/40, Carrefour 14/40, Kaufland 2/40.

---

## Fix nine and ten — the search index, and 30 equivalence classes (2026-09-08)

Both change what a reader of day fourteen is looking at, so both are logged here.

**Nine — the search index is cached, and the nightly now pays for the rebuild.** The catalog
vocabulary, head-noun frequency table and brand set were rebuilt on every request; they are
pure functions of a catalog that changes once a night. `/search?q=lapte` went 880-919 ms →
254 ms. **This changes the nightly's shape:** `/api/revalidate` now drops the index AND
rebuilds it, awaited, adding ~880 ms to the revalidate step. A nightly that appears ~1 s
slower from 2026-09-08 is this, not a regression.

**Ten — 30 private-label equivalence classes, and the assigner was re-run.** This one alters
what the nightly WRITES only indirectly, but it changes catalog state substantially:

- `propose:equivalence --apply` had not been run since the classes were last edited. Re-running
  it took products in a class from 820 to 1,399. **944 of the 1,148 newly-equivalent products
  belong to classes that already existed** — re-running a stale assigner, not the new work.
  The 30 new classes account for 204.
- **Five classes were deleted from the database**, with their assignments cleared first:
  `mazare-kg` and `porumb-kg` (every live member was a tin or a bag of popcorn — the catalog
  has no fresh peas and no corn on the cob at all), and `busuioc-kg`, `marar-kg`,
  `patrunjel-kg`, which had been deleted from the CODE months ago and whose database rows
  survived with products still attached. 52 products unassigned in total.
- `faina-alba-1kg` no longer swallows tip 650; `cafea-macinata-250g` no longer swallows the
  decafs. Both were merging two different products under one price line.

A day-fourteen reader comparing basket fill should know that the Index basket's per-shop fill
jumped on this date (mega-image 21→33 lines, freshful 19→29) and that **this is the re-run
assigner, not a change in what any scraper wrote.**

**Also on this date, and not a soak fix but it moves the numbers:** Sezamo's stored product
links were all 404 (the path carries the product id and the scraper omitted it). Re-scraping to
repair them added 39 products and moved comparable-in-2+ from 2,449 to 2,702. That is a
catalog change on a soak day and is attributable to the re-scrape, not to overnight drift.
