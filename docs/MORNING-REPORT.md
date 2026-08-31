# Morning report — 31 August 2026

Branch `overnight/2026-08-31`. Nothing merged to `main`. Every phase is its own commit, so any
of it can be reverted independently.

---

## Read this first

**Only 7.9% of the catalog can be compared at all.**

```
products with a live offer   30,735
COMPARABLE (2+ merchants)     2,418   7.9%
mean merchants per product     1.10
```

92.1% of products are backed by exactly one merchant. By section:

| section | products | comparable | share |
|---|---|---|---|
| grocery | 21,353 | 2,418 | **11.3%** |
| dcneu | 6,068 | 0 | 0.0% |
| farmacie | 1,351 | 0 | 0.0% |
| cosmetice | 1,042 | 0 | 0.0% |
| alcohol | 921 | 0 | 0.0% |

The four non-grocery sections have exactly one merchant each, so **nothing in them can ever be
compared** — they are catalogues, not comparisons, and no amount of matcher work changes that.

This reframes what matters. The instinct is to add products; the constraint is **overlap**.
Adding a thirteenth merchant that stocks products nobody else stocks moves this number by
nothing. Adding a merchant whose range overlaps Auchan's moves it a lot.

**Decision for you:** whether the next coverage work targets breadth (more merchants) or
depth (merchants that overlap the ones we have). I have not assumed an answer.

---

## What I found that nobody was looking for

Seven things, none of them on the brief, all of them live:

1. **`.env` was tracked in git**, since the initial commit. Nothing sensitive was in it yet —
   which is exactly why it was easy to miss. The first person to set a real `AUTH_SECRET` or a
   production `DATABASE_URL` would have committed it, and a secret in git history outlives the
   commit that removes it. Now gitignored, `.env.example` is the template. **You should still
   treat the current `AUTH_SECRET` placeholder as burned and generate a fresh one for
   production.**

2. **Carrefour was writing every offer with no source string and no reference price.** Metro
   and Mega Image had this bug, it was called fixed twice, and Carrefour had the identical line
   at its matcher call — `pool.map(...)` listing six fields and silently dropping four. Nobody
   had looked. Fixed, and now structurally impossible (see Phase 1b).

3. **33,868 of 34,430 product images are hotlinked from 13 retailer CDNs.** Every visitor's
   browser connects to all thirteen, handing each an IP address and a Referer naming the page
   being read. That is an undeclared third-party disclosure on a site that already shows a
   cookie banner. Also: `download-images` converts 600 per night, so the backlog is **57 nights
   even if the catalog stopped growing**, and it does not. One `IMG_LIMIT=all` run clears it
   (~1.3 GB).

4. **The prepared Postgres schema had drifted 11 models and 45 fields behind**, including
   `Offer.priceBani` — the column every piece of integer-money work depends on. It would have
   been discovered on cutover night.

5. **Nothing in the app is cached.** The product page comment says prices are served from cache
   and regenerated hourly. They never have been, and the homepage takes 2.9 seconds per
   request. See "still open" below.

6. **9 of 11 scrapers made unbounded network calls**, and one of them proved it tonight: the
   DCNeu detail pass stalled at 5,500 of 6,034 products holding a socket that never resolved,
   for over half an hour, using zero CPU. Because `scrape-all` runs stores in sequence, the
   three stores queued behind it never ran. Nothing crashed, so nothing reported it. All now
   bounded at 20 seconds.

7. **`scrape-auchan` had no drop guard**, and marked all 9,112 of its offers "out of stock"
   before fetching a single page. On the catalog master and the largest merchant. Mega Image
   was blocked tonight and *its* guard saved it; Auchan would have had nothing. Now guarded.
   Separately, the guard the other scrapers share compared against a per-merchant counter that
   a second scraper on the same merchant could overwrite — Carrefour's read 550 against 2,742
   real offers. It now counts the live offers it is about to overwrite instead.

---

## What shipped, by phase

| phase | what | state |
|---|---|---|
| 0 | Backup + restore-proof + CSV export of price history | done |
| 1a | Promo-pack parsing; one size parser instead of two | done |
| 1b | `StoreProduct` contract; no inline remaps; pool-contract guard | done |
| 1c | unitSize backfill (643 products); full re-scrape; audit | see below |
| 1d | Demo-data banner removed; counters made honest | done |
| 2 | EAN + three-band audits | done — findings, no code change |
| 3 | Postgres schema generated, parity enforced | done — **no cutover** |
| 4 | Search quality: 40-query fixture, +2 top-1 accuracy | done |
| 5 | Structured data, sitemap, robots | done |
| 6 | Offline basket with labelled staleness | done |
| 7 | Trust features behind `FEATURE_TRUST`, default off | done |
| 8 | Legal/methodology drafts + image audit | drafts, need a lawyer |
| 9 | Close-out, this report | done |

**Tests: 154 → 529.** Golden set unchanged at **97.3%, 2 false matches** throughout — the
CLAUDE.md invariant held on every commit, including the two that changed the matcher's inputs.

---

## Data corrections applied

Two writes to the database, both backed up first and both verified afterwards.

**`backfill:unitsize` — 643 products, 1,411 offers, 0 verification mismatches.** A re-scrape
could not have done this: the catalog master upserts existing products with `update: { image }`
only, so a product created a month ago keeps forever whatever size the parser of the day gave
it. Sizes were recomputed from each product's own name — the same input the stored value came
from — and every `pricePerUnit` derived from them was recomputed. A name the parser cannot read
was **left alone**: an unreadable name is not evidence the old size was wrong.

**The full re-scrape**, which applies the promo-pack parsing to live offers.

Nothing was deleted.

---

## Bugs found by measuring rather than assuming

The pattern that produced all of these: run the new code and the old code over the whole
catalog and diff them, instead of trusting that a passing test means a correct result.

| bug | blast radius | how it was found |
|---|---|---|
| `(7+1) x 125 g` read as one 125 g pot | 73 products, lei/kg wrong by 6–8× | DB audit's cross-store median |
| `24 plicuri x 15 g` read as **360 pieces**, grams discarded | every instant coffee and tea box | old-vs-new diff over 34,263 names |
| `Albrau,0.5 l` → **unitSize 0** (division by zero in every per-unit price) | 2 products, one silent class | same diff |
| `Nurofen 400 mg, 24 drajeuri` stored as **0.0004 kg** | 37 farmacie products | backfill dry run |
| `32BUC+20BUC` stored as one half of the bundle | DCNeu absorbents | backfill dry run |
| `3 mg/ml` read as a pack size → **8,650,000,000** into a 32-bit INT | crashed the backfill mid-write | backfill dry run |
| `parseSize` vs `parseQuantity` disagreement | **611 of 34,263 names (1.78%)** | direct comparison |

That last one is the important one. Two parsers answering one question means one of them is
wrong and nothing tells you which. `parseSize` is now a thin adapter over `parseQuantity`, and a
test fails if a second implementation ever grows back.

---

## Where thresholds were involved, here is the curve

Per your instruction not to tune a threshold and ship it as final.

**Matcher bands (`npm run audit:bands`, 223 golden pairs):**

| AUTO threshold | published | false MATCH | false miss | to review |
|---|---|---|---|---|
| 0.50 – 0.70 | 44 | 2 | 4 | 0 |
| 0.74 | 42 | 2 | 6 | 2 |
| 0.78 | 38 | 1 | 9 | 6 |

Flat from 0.50 to 0.70 — the shipped 0.62 could move ±0.08 with **no effect at all**. The REVIEW
sweep is flat across its entire range because the review band holds **zero** pairs. A three-band
system whose middle band never fires is a two-band system with extra code. Both are flat because
the structural guards (size, head noun, brand, mutual distinction) do all the rejecting.

**Left at 0.62 / 0.42, unchanged, now with evidence instead of nothing. Still provisional.**

**Search threshold (`npm run audit:search-curve`, live catalog):** raising it from 0.35 cost
recall and bought nothing, so it was not raised. The defect was in the logic, not the number —
see Phase 4.

**Pool-contract threshold (95% `rawPriceText`):** provisional, not tuned against a curve. It is
loose enough for a scraper with a few genuinely price-less cards and tight enough to catch a
systematic loss.

---

---

## Phase 1c — the re-scrape, and the audit that did NOT reach 15/15

The brief asked for 15/15. It is **10/15**, and pretending otherwise would defeat the purpose of
having an audit. Here is what moved, what did not, and which is a live bug.

### What the re-scrape fixed

| invariant | before | after |
|---|---|---|
| offers with **no deep link** (non-flyer) | **8,502** | **319** |
| offers with **no `rawPriceText`** (seen in last 2 days) | **33,139** | **11,849** |

Per merchant, deep links: Auchan 1,116 → **12**, Metro 5,260 → **48**, Sezamo 7,807 → **157**,
Carrefour 938 → **52**, Freshful 346 → **15**. That is the Phase 1b contract working on live
scrapes, and every merchant now reports `rawPriceText 100%` at the pool-contract check.

The residue is almost entirely **DCNeu's 8,133 offers**, which never re-scraped — see below.

### What did not move, and why

**1. `no live offer written without a confidence score` — 100 violations. LEGACY.**
All Auchan, all `matchedBy=scraper score=null`, all from before scored matching existed. Auchan
now writes `matchedBy="catalog-master", score=1`. These are rows the re-scrape did not touch
because their products were not re-seen. Not a live bug.

**2. `no missing deep link` — 319 offers across 6 merchants. LEGACY.**
Down 96%. The remainder are stale offers from products no longer listed, so no run re-writes
them. Not a live bug.

**3. `every recently-seen offer carries its raw source string` — 11,849. MOSTLY BLOCKED, NOT
BROKEN.** 8,133 are DCNeu, which never completed. The rest are Mega Image (refused, correctly)
and stale rows. Coverage went from 21% to **72.8%** in one night, and every scraper that ran
reported 100%.

**4. `no unflagged offer deviates >70% from its cross-store median` — 155. THE INVARIANT IS
PARTLY WRONG.** Sampling them:

```
 4.35 vs median 18.59  [auchan]   Bere blonda Timisoreana, 0.5 l
16.99 vs median  9.99  [kaufland] Ketchup dulce Tomi, 500 g
14.29 vs median  8.04  [sezamo]   Physalis caserola 100 g
17.29 vs median  7.24  [sezamo]   Usturoi Solo 250 g
```

Ketchup at 16.99 against a 9.99 median is not corruption — it is two shops pricing ketchup
differently. Fresh produce (physalis, garlic) legitimately varies by more than 70% between a
discounter and a delivery platform. **A flat 70% band is too tight for fresh and promotional
goods**, and it is currently reporting real price differences as data defects — which is the
worst kind of false positive, because it trains you to ignore the check. It needs to be
per-category, or to compare unit prices rather than pack prices. **I did not change it**:
retuning a data-quality threshold on the strength of one night's sample is exactly the move the
brief said not to make.

**5. `fan-out within limits` — 1 violation, NEW: Carrefour max fan-out 9 > 8.** One catalog
product is backed by nine Carrefour pool items. Worth a look, but it is one product out of
34,688 and the unique `(productId, merchantId)` constraint means only one offer is actually
published, so nothing wrong is on a page.

### The night's real operational failure

**DCNeu hung at 5,500 of 6,034 products and stalled the whole pipeline.** `fetch` has no default
timeout, and `scrape-all` runs stores in sequence — so farmaciatei, kaufland and penny never
ran. Nothing crashed and nothing was logged. I stopped it, added a 20-second bound to all 9
unbounded scrapers, and ran the three stranded stores by hand (farmaciatei 2,026 offers,
kaufland 314, penny 30).

Finding that led to a worse one: **`scrape-auchan` marked all 9,112 of its offers "out of stock"
before fetching a single page and had no drop guard at all** — on the catalog master and the
largest merchant. Mega Image was blocked tonight and its guard saved it; Auchan had nothing.
Now guarded.

### Final state

```
Offer 43,591 · PriceHistory 79,268 · Product 34,688
live (not stale)   33,476
rawPriceText       31,730  (72.8%, was ~21%)
productUrl         42,899  (98.4%)
```

Backed up: `2026-08-31T12-41-27-309Z.db.gz`, 33.1 MB → 8.0 MB, integrity-checked.

### What it takes to reach 15/15

1. A completed DCNeu run (now that it cannot hang) — clears most of #3.
2. Unblocking Mega Image — it has been failing since ~04:00, cause unknown.
3. A decision on the cross-store median band (#4). It is not a code fix; it is a question about
   what counts as an implausible price for fresh produce.
4. A pass to retire or re-match the legacy Auchan rows in #1 and #2.

Items 1, 2 and 4 are mechanical. Item 3 is yours.

---

## Still open — decisions I did not make

1. **Nothing is cached. The cause is now known, and the fix is a product decision.**

   Measured against a production build: every page returns
   `cache-control: private, no-cache, no-store, max-age=0`, and **the homepage takes 2.9
   seconds on both a cold and a warm request.**

   The cause is `Header`, a Server Component in the root layout, which calls
   `getCurrentUser()` → `cookies()`. In Next 14, reading cookies anywhere in the tree makes
   **every route** dynamic. Removing `force-dynamic` from the layout was necessary and safe,
   but it was never the cause.

   And the 2.9 seconds is not the rendering — the individual queries total ~136 ms.
   It is **`getHomeSections()`, which loads all 21,353 grocery products together with their
   full price history on every homepage request, to display 8 featured items and 6 price
   drops.**

   Three ways out, and the choice is yours because it is about what the header shows:
   - move the logged-in part of the header to the client (fetch after hydration) — restores
     static rendering everywhere;
   - upgrade to Next 15 and use Partial Prerendering — keeps the header server-side;
   - keep dynamic rendering and wrap the expensive queries in `unstable_cache` — fixes the
     2.9 seconds without touching auth, and is the smallest change.

   I would do the third first: it is reversible, touches no authentication, and buys most of
   the win. `getHomeSections` needs rewriting either way — loading a price history for
   twenty-one thousand products to show fourteen of them is not a caching problem.

2. **DCNeu still has not completed a run**, and Mega Image has been blocked since about 04:00
   (cause unknown, unrelated to this session's changes — its guard correctly refused the write
   and kept the old data). Both need a look before the audit can reach 15/15.

2. **Off-machine backups.** `npm run backup` is proven end-to-end — restored, row-compared and
   money-checksummed against the live DB — but every copy is on this machine. The one dataset
   that cannot be regenerated is 78,258 price-history rows. Off-machine is your call.

3. **Search ignores `Category` entirely.** `"lpate"` now correctly returns milk, but the first
   hit is *Lapte de corp* — body lotion, whose head noun genuinely is "lapte". No string signal
   separates it from drinking milk. The next step is a precision@10 measurement by category, not
   more weight-fiddling.

4. **The legal pages are drafts.** `/despre`, `/termeni`, `/confidentialitate` are accurate about
   what the software does and are marked DRAFT on the page itself. A site publishing prices about
   named retailers should have a lawyer read them before launch.

5. **Gift sets have no single size.** `NIVEA CASETA CADOU (CR MAINI100ML+CR100ML+BL250ML…)` —
   about 10 products. Last-declared-size wins, which is arbitrary but consistent. A real fix
   needs a multi-component quantity type.

6. **One corrupt source string**: `Pulpe de pui … Family Pack, +/- 1 .3 kg`. Old read 0.3 kg, new
   reads 3 kg, truth is presumably 1.3 kg. Deciding what `1 .3` means is guessing, so it is
   flagged rather than special-cased.

---

## Dependencies added

**None.** Not one, across all ten phases.

---

## New commands

| command | what |
|---|---|
| `npm run backup` | consistent snapshot, integrity-checked, gzipped, retained |
| `npm run export:history` | full CSV of the irreplaceable dataset |
| `npm run backfill:unitsize` | recompute sizes from names (dry run by default) |
| `npm run audit:promo` | promo-pack blast radius per merchant |
| `npm run audit:ean` | merchants-per-product distribution + EAN coverage |
| `npm run audit:bands` | matcher threshold tradeoff curve |
| `npm run audit:search` | 40 queries against the live catalog |
| `npm run audit:search-curve` | search threshold tradeoff curve |
| `npm run audit:images` | image hosting, third parties, backlog arithmetic |
| `npm run gen:postgres` | regenerate the Postgres schema from the SQLite one |
| `npm run verify:code` | typecheck + tests (what the pre-commit hook runs) |
| `npm run verify` | the above plus `audit:db` |

---

## One process change

The pre-commit hook ran the full `verify`, which now includes `audit:db`. The audit fails on
legacy data, so **every code commit was blocked by the state of the database** — including the
first one of the night. A commit changes code; it cannot change data. Split into `verify:code`
(what the hook runs) and `verify` (that plus the data audit, for CI and the nightly). The data
gate did not get weaker; it stopped standing in the wrong doorway.

---

## Your two tasks from last time, still outstanding

- Open `monitorulpreturilor.info` in a browser (DNS-unreachable from this sandbox).
- Start the 2Performant affiliate application.
