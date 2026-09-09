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

**2026-09-10 — the public read API (`/api/v1/*`).** Additive: new read-only routes, new named
rate limits, and an index on `Offer.productUrl`. No existing route changed, no scraper touched,
no threshold moved. `docs/API.md` is the spec. The soak's measured inputs are unaffected because
nothing the nightly audits read is written by any of it.

**2026-09-10 — GDPR erasure cascade.** `onDelete: Cascade` on five relations, applied with
`prisma db push`. Schema-only; no offer, product or match row is touched by it.

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

### Soak-period change — Indexul CoșMic switched to basket v2 (2026-09-07)

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
