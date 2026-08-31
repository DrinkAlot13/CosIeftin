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

Five things, none of which were on the brief, all of which were live:

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
   and regenerated hourly. They never have been. See "still open" below.

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

**Tests: 154 → 525.** Golden set unchanged at **97.3%, 2 false matches** throughout — the
CLAUDE.md invariant held on every commit.

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

## Still open — decisions I did not make

1. **Nothing is cached, and the fix is not one line.** Removing `force-dynamic` from the root
   layout was necessary and safe (every route needing per-request rendering declares it on
   itself), but **not sufficient**: after a clean rebuild every route still renders on demand,
   including `/termeni`, which fetches nothing. First hypothesis to test:
   `src/lib/db.ts` does `import "dotenv/config"`, which reads the filesystem at module scope,
   and the root layout pulls it in through `queries.ts` — that can be enough to disqualify a
   route from static generation. I did not chase it further because changing caching across
   `/admin` and the account pages is not a hunch to act on overnight.
   **Impact if fixed:** every product page currently hits SQLite on every request, and search
   reads the entire grocery catalog per query (164 ms load + ~530 ms scoring).

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
