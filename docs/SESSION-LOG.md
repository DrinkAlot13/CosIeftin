# Overnight session log — 2026-08-31

Branch: `overnight/2026-08-31`. Written as the session runs, not at the end, so that if the
session dies this file shows where it got to.

---

## Phase 0 — the safety net

**Start** 03:26 · **End** 03:40

The price history is the only dataset in this system that cannot be regenerated. Offers can
be re-scraped tomorrow; 78,258 history rows cannot. Before this phase there was one SQLite
file, no backup, on a machine that lost processes mid-write earlier in the week.

### What changed

| file | what |
|---|---|
| `backups/2026-08-30T21-26-38-835Z-pre-session.db` | pre-session snapshot, taken before anything else ran |
| `scripts/backup.ts` (new) | `npm run backup` — VACUUM INTO, integrity check, truncation guard, gzip, retention, restore instructions |
| `scripts/export-history.ts` (new) | `npm run export:history` — full CSV export of the irreplaceable dataset |
| `package.json` | `backup`, `export:history` scripts; **`nightly` now starts with `npm run backup`** |
| `.gitignore` | backup artefacts excluded from git |

### Decisions taken

- **`VACUUM INTO`, never a file copy.** `cp` of a live SQLite file can capture a torn page
  and produces a database that opens cleanly and is quietly wrong. `VACUUM INTO` is
  transactionally consistent against concurrent writers.
- **The backup rejects itself** rather than recording a bad one, on any of: failed
  `PRAGMA integrity_check`, row counts in the snapshot disagreeing with the live DB, or
  `PriceHistory` below 95% of the previous snapshot. A silently truncated backup is worse
  than none, because it looks like protection.
- **Retention never prunes the oldest surviving snapshot**, whatever the policy computes.
  Losing the last line of defence to a retention rule would be the worst possible failure.
- **CSV over Parquet** for the history export: no new dependency, universally readable, and
  78k rows is nowhere near where the format would matter.

### Numbers

- snapshot: 31.5 MB raw → **7.7 MB gzipped (24%)**
- Offer 43,108 · PriceHistory 78,258 · Product 34,263
- history export: **78,258/78,258 rows**, 13.4 MB CSV

### Restore proof (an unverified backup is not a backup)

Decompressed the snapshot and compared it against the live database:

```
restored integrity_check: ok
Offer         43108 / 43108   match
PriceHistory  78258 / 78258   match
Product       34263 / 34263   match
Merchant         13 / 13      match
BulkTier       4708 / 4708    match
price sum (bani) 116852571 / 116852571   match
```

Row counts alone can match while values are corrupt, so the money checksum is part of the
proof, not decoration.

### Deferred to the morning report

- Backups are local only. Off-machine copy is a decision for the owner (see report).

**Tests** — not re-run in this phase (no application code touched; scripts only).

### One thing had to change to commit at all

The pre-commit hook ran `npm run verify`, which now includes `audit:db`. The audit fails on
legacy rows, so **every code commit was blocked by the state of the database** — including this
one. A commit changes code; it cannot change data. Split into `verify:code` (typecheck + tests,
what the hook runs) and `verify` (that plus `audit:db`, what the nightly and CI run). The data
gate did not get weaker; it stopped standing in the wrong doorway.

---

## Phase 1a — parseQuantity: Romanian promo-pack notation

**Start** 03:52 · **End** 05:10

The DB audit flagged Activia yoghurt at 14,63 lei against a 2,59 cross-store median. Not a price
bug: `(7+1) x 125 g` parsed as a single 125 g pot, so its lei/kg came out eight times too high.
Nothing else in the system could have caught that — the price was right, the name was right, and
only the two together were wrong.

### The contract

`parseQuantity` now returns `{ value, unit, packCount, packSize, paidCount, freeCount, isPromoPack }`,
with `packCount === paidCount + freeCount` as an invariant (tested across ten notations).

Parsing runs in two stages — promotional shape first, then the base pack from what is left.
The other order lets a promo's own digits be misread as the pack: `4+2 x 125 g` reads as a plain
`2 x 125 g` two-pack under the multipack rule.

| notation | reading |
|---|---|
| `(7+1) x 125 g` | 8 pots, 1000 g, paid 7 free 1 |
| `4+2 x 125 g` | 6 pots, 750 g |
| `2+1 gratis` | multiplies the size stated elsewhere in the name |
| `1+1 gratis` (no size) | 2 BUC — not a guessed mass |
| `3 la prețul de 2` | 3 items, 2 paid; both diacritic spellings and the diacritic-free scrape |
| `2 x 500 g + 1 gratis` | 3 × 500 g — free items join the stated pack, not extra copies of it |
| `6 x 1,5 L` | 6-pack, **not** a promo |
| `pachet 2 buc`, `set 3 buc`, `bax 24` | pack of pieces |
| `12 role`, `10 buc` | count |
| `Lapte 1,5% grăsime 1 L` | 1000 ML — the percentage is still not a size |

**A bare `N+M` is deliberately NOT a promotion.** `Omega 3+6+9`, `ECO Avocado 90 Gr+`, `3+ ani`
are all real catalog strings. A promo must attach a size or carry a free-word. Guessing here
corrupts a real quantity, which is worse than missing a promo label.

### Blast radius (`npm run audit:promo`, read-only)

**73 of 34,263 products (0.21%)** read a different total quantity — every unit price computed
from them was wrong, by 6× to 8×.

| merchant | products | promo packs | quantity changed |
|---|---|---|---|
| auchan | 9,039 | 67 | 68 |
| mega-image | 2,721 | 53 | 53 |
| freshful | 1,878 | 12 | 13 |
| sezamo | 9,036 | 6 | 9 |
| carrefour | 2,728 | 4 | 4 |
| metro | 6,433 | 3 | 3 |
| kaufland, penny, dcneu, farmaciatei, finestore, lemanoir | — | 0 | 0 |

All 73 are in `grocery`; beer and mineral-water six-packs dominate. Nothing was written — a
re-scrape (Phase 1c) applies it.

### Three further bugs, found by measuring instead of assuming

Comparing the old and new readings across all 34,263 names surfaced defects nobody had reported:

1. **`24 plicuri x 15 g` → 360 *pieces***. The reversed-multipack rule claimed it and threw the
   grams away. Every instant-coffee and tea box in the catalog. Fixed by widening the forward
   rule's counting nouns and forbidding the reversed rule to fire when the trailing number
   carries a mass or volume — but not when it carries a count, because `10 g x 3 bucati` is
   three 10 g sachets and must still parse.
2. **`Albrau,0.5 l` → unitSize 0.** `[\d.,]+` captured `",0.5"`; `parseFloat` read it as 0.
   A zero unitSize is a division by zero in every per-unit price derived from it. The number
   pattern is now `(\d+(?:[.,]\d+)?)` — a number and nothing but.
3. **`Cub Knorr 6 l, cu pui 108 g` → 6 l.** The 6 l is what the stock cube *makes*. Now 108 g.

### parseSize: retired

The brief said retire it if the two parsers disagree. They disagreed on **611 of 34,263 names
(1.78%)** — all promo packs, all sachet boxes, the zero-unitSize case, and 96 bin-bag products
where `60L, 20 bucati` was priced per litre of bag capacity instead of per bag.

`parseSize` is now a thin adapter over `parseQuantity`. Agreement is 34,263/34,263 by
construction.

Its drift-guard test would then have been tautological — a test that can only pass, which is
worse than none because it looks like protection. Replaced with: (a) a structural check that no
second implementation grows back inside `ingest-core.ts`, and (b) a **frozen reading** of the
50 real names, so any future change to the shared parser shows up as a diff.

### isPromoPack wired into shrinkflation

This is why 1a had to precede Phase 2. A promo ending shrinks the pack and raises the per-unit
price — it clears every numeric bar the detector has, and it is not shrinkflation. Any promo
observation in the window now disqualifies the whole series. That costs real findings on
permanently-promo packs; against a feature that ships behind a flag and a human review, a
missed finding is much the cheaper error.

### Logged, not decided

- **`Pulpe de pui … Family Pack, +/- 1 .3 kg`** — the source string is corrupt. Old read 0.3 kg,
  new reads 3 kg; the truth is presumably 1.3 kg. One product. Deciding whether `1 .3` means
  `1.3` is guessing, so it is flagged rather than special-cased.
- **~10 cosmetics gift sets** (`NIVEA CASETA CADOU (CR MAINI100ML+CR100ML+BL250ML+LIP4.8G…)`)
  have no single size by nature. Last-declared-size wins, which is arbitrary but consistent.
  A real fix means a multi-component quantity type — out of scope, worth a decision.
- **`Zahar vanilinat Cosmin, 48 g, 6 plicuri`** now reads 6 buc, not 48 g, because the last
  declared size wins. That rule is what makes `60L, 20 bucati` bin bags and `1,5% grăsime 1 L`
  milk both come out right, so it stays.

### New: `npm run audit:promo`

Read-only. Reconstructs the pre-1a reading, runs both over the live catalog, and reports the
difference per merchant and per section. Kept so the Phase 1c re-scrape can be verified against
a measured expectation rather than a hope.

**Dependencies added** — none.

**Tests** — 395 passed, 0 failed. Golden set unchanged at **97.3%, 2 false matches** (the
CLAUDE.md invariant). Typecheck clean. Added `toEqual` to the test runner (structural equality;
it had only `toBe`).

---

## Phase 1b — one StoreProduct contract, no inline remaps

**Start** 05:12 · **End** 06:05

Metro and Mega Image wrote thousands of offers with no `productUrl` and no `rawPriceText`.
The scrapers set both fields correctly. One line at the matcher call destroyed them:

```ts
pool.map((c) => ({ name: c.name, brand: c.brand, price: c.price, available: c.available, url: c.url, image: c.image }))
```

TypeScript cannot object — a narrower object literal is a perfectly valid `StoreProduct`.
Nothing failed and nothing warned. It was found only by querying the database for a field the
writing code believed it was setting.

### A third instance, previously unreported

**Carrefour had the same line.** Its pool sets `rawPriceText`, `productUrl`,
`referencePriceBani` and `referencePriceKind` — and the call site listed six fields, so
**every Carrefour offer was written with no source string and no Omnibus reference price**.
Metro and Mega Image had been fixed; Carrefour had not, and nobody had looked.

### What changed

| scraper | before | now |
|---|---|---|
| carrefour | `.map()` dropping 4 fields | pool passed unmapped |
| freshful | local `Candidate` shape, provenance added at the call | `StoreProduct`, provenance set at the read |
| sezamo | local `Cand` shape, provenance added at the call | `StoreProduct`, provenance set at the read |
| mega-image | `.map()` re-listing every field by hand | pool passed unmapped |
| metro | `.map()` re-listing every field by hand | pool passed unmapped |
| monitorul | no `rawPriceText` at all | sets `rawPriceText` + `productUrl` |
| kaufland, dcneu, finestore, lemanoir, farmaciatei, carrefour-alcohol, adapters/runner | already on the contract | labelled for error messages |

`StoreProduct` gained `sourceId` — the merchant's own SKU, which four scrapers were already
carrying as an off-contract `code` field purely for dedupe. It is carried but **not yet
persisted**; that is Phase 2's `StoreProductIdentifier`.

Zero `pool.map(` remain in `scripts/`.

### Two defences, because the compiler cannot be one

1. **`assertPoolContract`**, called inside `matchPoolToCatalog` *before any database work*, so
   a mangled run writes nothing at all. Refuses a pool where under 95% carry `rawPriceText` —
   the one field a scraper can always supply, since it is the very string it just parsed. Every
   run now prints its own coverage: `pool contract: 2721 products · rawPriceText 100% · …`.
   `productUrl` is reported but **not** enforced: flyer sources genuinely have no per-product
   link, and a guard that has to be bypassed is not a guard.
2. **A structural test** over every `scripts/scrape-*.ts`, because a runtime guard alone would
   let the re-mapping pattern creep back everywhere it does not reach. It fails if any scraper
   re-maps its pool at the matcher call, and if any scraper that matches a pool never sets
   `rawPriceText`.

### Logged, not decided

- The 95% threshold is **provisional**. It is loose enough for a scraper with a few genuinely
  price-less cards and tight enough to catch a systematic loss; it has not been tuned against a
  tradeoff curve, and it should not be treated as final.

**Dependencies added** — none.

**Tests** — 406 passed, 0 failed. Golden set unchanged at **97.3%, 2 false matches**.
Typecheck clean.

---

## Phase 4 — search quality, measured for the first time

**Start** 07:05 · **End** 08:20

Search quality had never been measured. The scoring lived inside `searchProducts`, wrapped
around a Prisma call, so checking whether "lapte zuzu" returns the right milk needed a
database, a scrape and a running app. Nobody was going to do that on every change, so every
adjustment to the weights was a guess with no way to tell a fix from a regression.

### What changed

- Scoring extracted to `src/lib/search/rank.ts`, pure and testable.
- **40 real Romanian queries** (`tests/fixtures/search/queries.ts`), each stating *why* it is in
  the set: no-diacritic spellings, diacritic spellings, product+brand, brand alone, phone-keyboard
  misspellings, sizes in the query, near-miss discrimination, and degenerate input.
- The test catalog is **1,028 real product names** from the live database, including 400
  unrelated products as distractors — without those, precision is untested and a ranker that
  returns everything scores perfectly.
- `npm run audit:search` runs the same 40 against the **whole live catalog** (21,353 products).
- `npm run audit:search-curve` sweeps the threshold and reports the tradeoff.

### The defect the fixture alone did not catch

Against 1,028 names, 39/40 passed. Against the real 21,353, `"lpate"` returned **1,195 products
led by "Spinari si spate de pui"**.

The curve showed the threshold was the wrong knob:

| threshold | recall | top-1 | median hits |
|---|---|---|---|
| 0.35 | 36/36 | 34/36 | 383 |
| 0.45 | 34/36 | 33/36 | 278 |
| 0.55–1.05 | 33/36 | 33/36 | 187 |

Raising it **cost recall and bought nothing**. So it was not raised.

The actual cause was two compounding bugs:

1. **Plain Levenshtein charges a transposition two edits.** "lpate" is a transposition of
   "lapte" — the commonest way to mistype it — so the misspelling was scored as *closer* to
   "spate", an unrelated word one substitution away. Replaced with **Damerau-Levenshtein**,
   where a transposition costs one.
2. **Typo similarity alone both qualified a result and ranked it.** No string metric can break
   the "lpate" tie — it is genuinely one edit from both words. What breaks it is the catalog:
   milk heads hundreds of products, "spate" a handful. So the query is now **corrected before
   scoring**, against the catalog's own head-noun vocabulary, weighted by frequency — edit
   distance proposes, prior frequency disposes. A token the catalog already knows is never
   touched, so a real query cannot be "corrected" into a different one.

Also added a **head-noun bonus**: what a product IS beats what it contains, so "lapte" ranks
milk above milk chocolate. It is a boost and not a filter, because "lapte de cocos" is a
genuine head-noun match that a shopper genuinely wants.

### After

| | before | after |
|---|---|---|
| recall (live catalog) | 36/36 | 36/36 |
| **top-1 accuracy** | **34/36** | **36/36** |
| top-1 misses | `lpate`, `cicolata` | none |

36/36 on both at **every threshold from 0.35 to 1.05**, so the threshold is no longer a
correctness lever at all. Left at **0.35**, the value with maximum recall — conservative, and
**provisional**: it now governs only how long the tail is, not whether the right answer is
found.

### Logged, not decided

- **`"lpate"` now returns "Lapte de corp Lactovit" first — body lotion.** Its head noun really
  is "lapte", so no string signal can separate it from drinking milk. The fix is category
  signal, and **search ignores `Category` entirely** today. That is the next measurement to add
  (precision@10 by category), not a weight to fiddle with.
- **Search reads the whole grocery catalog on every request** and scores it in Node: 164 ms to
  load, ~530 ms to score, per query. Fine at this size, will not survive traffic. The Postgres
  cutover (pg_trgm + unaccent) is where this stops being a full scan — which is the stated
  reason for Phase 3 in the first place.

**Dependencies added** — none.

**Tests** — 486 passed, 0 failed. Golden set unchanged at 97.3%.

---

## Phase 1c (part 1) — the backfill a re-scrape could not do

**Start** 06:10 · **End** 07:00

A re-scrape does not fix existing sizes. The catalog master upserts existing products with
`update: { image }` only, so a product created a month ago keeps whatever size the parser of
the day gave it, forever. Every Phase 1a correction would have applied to newly-created
products and to nothing else, leaving two readings side by side in one table with nothing to
say which was which.

`npm run backfill:unitsize` recomputes `unit`/`unitSize` from each product's own name — the
same input the stored value came from — and recomputes every `pricePerUnit` derived from them.
A name the parser cannot read is **left alone**: an unreadable name is not evidence the old
size was wrong. Dry run by default; verifies by re-reading every row it wrote.

**643 products corrected, 1,411 offers repriced, 0 verification mismatches.**
`scrape-auchan` now also updates `unit`/`unitSize` on re-scrape when the name parses, so the
catalog master can correct a size rather than only ever set one.

### Three more bugs, found by dry-running the backfill against live data

1. **37 farmacie products were stored as their DOSE.** Romanian pharmacy dose forms were not
   counting nouns, so `Nurofen 400 mg, 24 drajeuri` fell back to the 400 mg and recorded a box
   of 24 as **0.0004 kg** of product. Added `drajeuri`, `pastile`, `supozitoare`, `ovule`,
   `fiole`, `perle` — and the singular forms (`comprimat`, `capsula`, `tableta`, `doza`) that
   were missing beside their plurals.
2. **`LIBRESSE ABSORBANTE 32BUC+20BUC` is 52 pads**, stored as one half. Bundled COUNTS now add
   up. Bundled masses deliberately do not: `50 mg + 20 mg/g, 30 g` is a concentration whose
   pack is the 30 g at the end, and a cosmetics gift set has no single size at all.
3. **`3 mg/ml` was read as a pack size.** An 86 lei nicotine spray divided by a millionth of a
   kilogram asked SQLite to store **8,650,000,000** in a 32-bit INT column. Prisma threw and
   took the backfill down mid-write.

That third one was a live crash risk in the scrapers too, not just in this script. Every
per-unit write now goes through `perUnitBaniOrNull`, which returns **null** out of range — the
column is nullable for exactly this reason, and clamping would store a number that is not the
price while every chart and sort believed it.

---

## Phase 1d — the site was telling visitors its real prices were fake

**Start** 07:00 · **End** 07:05

Every page carried *"Prototip cu date demonstrative — prețurile afișate sunt fictive"*, and the
footer repeated it. That stopped being true long ago. A visitor who believed the banner would
dismiss a real price; a merchant reading it was being told we publish invented figures about
them.

Removing it creates the opposite obligation, so the footer now says what IS true: prices are
collected automatically, can differ from the till, and should be checked on the merchant's site.
`tests/no-demo-claims.test.ts` fails if the fictional-prices copy returns **and** if the footer
ever loses that warning.

The homepage counters were loose in a way a visitor cannot check, which is exactly why they had
to be right: "N magazine" counted any merchant with any grocery offer, so a merchant we had
switched off still counted as a store you could shop, and a price last seen months ago still
counted as a price. All three now count live offers from active merchants only.

`catalog.ts` loses `basePrice` — 49 invented RON-per-pack figures sitting next to real names.

---

## Phase 2 — EAN and the three bands, audited rather than assumed

**Start** 08:20 · **End** 09:10

### The headline metric the brief asked for first

| | |
|---|---|
| products with a live offer | **30,735** |
| **comparable (2+ merchants)** | **2,418 — 7.9%** |
| mean merchants per product | 1.10 |

92.1% of the catalog is backed by exactly one merchant. By section: grocery **11.3%**;
`dcneu`, `farmacie`, `cosmetice`, `alcohol` all **0.0%**, each having exactly one merchant, so
nothing in them can ever be compared. **Catalog size is not the constraint — overlap is.**

### The EAN lever is not available, and that is now verified

Auchan's VTEX API *does* publish EANs — 9,031 checksum-valid, 99.1% of its offers. That
corrects an earlier session's claim that no Romanian grocer publishes a GTIN.

But Auchan is the catalog master, so those EANs sit on products Auchan created, and an EAN only
becomes a **join** when a second merchant supplies the same one. I probed the two likeliest:

- **Sezamo** `/api/v1/products/card` returns `productId, image, name, slug, brand, unit,
  textualAmount, prices, stock, ratings` — no identifier field of any kind.
- **Freshful** `__NEXT_DATA__` product node carries 40+ fields including `code`, `variantCode`,
  `sku`, `brandCode` — and no EAN, GTIN or barcode.

So the 1,968 "EANs backed by 2+ merchants" were never joined on the EAN. They were joined on
the name, and the EAN came along for the ride. **Name-and-size matching is the only lever**,
which is worth knowing before building `StoreProductIdentifier` plumbing for a key nobody
supplies.

### The thresholds are nearly vestigial

`npm run audit:bands`, on the 223-pair golden set:

| AUTO threshold | published | false MATCH | false miss | to review |
|---|---|---|---|---|
| 0.50 – 0.70 | 44 | 2 | 4 | 0 |
| 0.74 | 42 | 2 | 6 | 2 |
| 0.78 | 38 | 1 | 9 | 6 |

Flat from 0.50 to 0.70 — the shipped 0.62 could move ±0.08 with **no effect whatsoever**. It
only bites at 0.74, where it costs misses without removing the false matches; at 0.78 it trades
one false match for five more misses, which is backwards, since a false match publishes one
product's price on another while a false miss only costs a comparison.

The REVIEW sweep is flat across its **entire** range, because the review band holds zero pairs
at the shipped setting. **A three-band system whose middle band never fires is a two-band
system with extra code.**

Both are flat because the structural guards — size, head noun, brand, mutual distinction — do
all the rejecting, and whatever survives them scores far above any threshold in range.
**0.62 / 0.42 stay exactly as they are**, now with evidence instead of nothing, still labelled
provisional.

---

## Phase 3 — the prepared Postgres migration had drifted 11 models behind

**Start** 06:35 · **End** 07:05

`prisma/schema.postgres.prisma` was written as a migration prepared in advance, and the SQLite
schema then grew past it. It was missing **11 models** — BulkTier, ScraperRun, PriceAnomaly,
ProductPackChange, FeedSource, FeedRun, ProductSpec, EquivalenceClass, ProductAttribute,
UserFavorite, UserBlocklist — and **45 fields**, including `Offer.priceBani`, the column all the
integer-money work depends on.

Nothing complained, because nothing runs against it. It would have been discovered on cutover
night. A prepared migration nobody executes is not preparation; it is a liability that looks
like preparation.

Hand-maintaining a parallel schema does not work, so it is no longer hand-maintained:
`npm run gen:postgres` generates it, applying the three deliberate differences (postgresql
provider, `@db.Text` on long free-text columns, indexes on the hot query columns).
`tests/schema-parity.test.ts` checks model-by-model, field-by-field, **and** byte-for-byte
against a fresh generation. **No cutover, per the brief.**

---

## Phase 5 — structured data, sitemap, robots

**Start** 08:20 · **End** 08:50

A comparator lives on organic search and had no sitemap, no robots.txt and no structured data.

The rule applied throughout: **structured data must be true.** A comparator's rich result IS its
search listing — Google renders the price range straight out of the JSON-LD, to more people than
see the page. So `lowPrice`/`highPrice`/`offerCount` come from the *same offers rendered on the
page*; a product with no usable price emits no JSON-LD at all; `availability` has exactly two
honest values; `gtin13` appears only for a checksum-valid EAN; brand and image are omitted when
absent rather than filled with a placeholder.

Product names are scraped from merchant pages — untrusted input — so the serialiser escapes `<`,
and a test feeds it a name containing a script-closing tag and an onerror payload.

The sitemap lists only products with a live offer (a stale product is a soft 404 that costs
crawl budget), and `lastModified` is the offer's real `lastSeen`, not `new Date()`. robots
disallows `/search`: every query string is a distinct URL over the same catalog — the classic
faceted-search crawl trap.

---

## Phase 6 — the list now works in the aisle, not just loads there

**Start** 08:50 · **End** 09:20

The service worker made the PAGE load offline and did nothing for the only thing on it anyone
needs. In a shop with no signal, `/api/basket` failed, `setResult` never ran, and the shopper
stood in front of the shelf looking at an empty panel.

The old justification — *"a stale basket total would be worse than an error"* — is right about
stale money and wrong about the shopper. Twenty minutes old and labelled as such beats nothing;
three weeks old does not, however labelled, so it is not served at all.

`lib/offline-cache.ts` caches under two rules: **never another list's totals** (keyed by the
exact item/quantity signature) and **never without its age** (freshness comes back *with* the
result, so the UI cannot forget to say so). Anything past 7 days is refused, as is a timestamp
from the future. `localStorage` is wrapped because private mode and blocked site-data both
**throw** rather than return null — tested with a storage that throws on every call, corrupt
JSON, a payload missing its timestamp, and no `window` at all.

---

## Phase 7 — trust features behind a flag, plus a tracked .env

**Start** 09:20 · **End** 09:40

The shrinkflation page was publicly reachable. It states that a **named manufacturer** shrank a
pack while raising its price per kilo — defensible with good evidence, indefensible without, and
the difference is not visible from inside the code that produces the detections. It is now gated
on `FEATURE_TRUST` and **404s when off** rather than rendering an empty page, because an empty
page invites the reader to conclude we looked and found nothing.

The default is not "off until we trust the code". It is "off until a person decided to publish".

`flagEnabled` accepts only an explicit affirmative. Everything else is off — including the
values that actually occur in a deployment: the literal string `"undefined"`, an unrendered
template placeholder, an empty value, and the one a bare `!!process.env.X` gets wrong: `"false"`.

**Separately: `.env` was tracked in git**, since the initial commit. Nothing sensitive had been
written into it yet, which is exactly why it was easy to miss — the first person to set a real
`AUTH_SECRET` or production `DATABASE_URL` would have committed it, and a secret in git history
outlives the commit that removes it. Now gitignored, with `.env.example` as the template.

---

## Phase 8 — legal/trust drafts, and the image audit behind them

**Start** 09:40 · **End** 10:20

`npm run audit:images`: **33,868 of 34,430 product images are hotlinked from 13 retailer CDNs.**
Only 561 are self-hosted. Three problems in one coat — the merchant can break every image at
will, it is their bandwidth serving our page, and **every visitor's browser connects to all 13**,
handing each an IP address, a User-Agent and a Referer naming the exact page being read.

The audit also answers a question nobody had asked: `download-images` converts 600 per nightly
run, so 33,868 remaining is **57 nights if the catalog stopped growing** — and it does not, so
the batch must exceed the growth rate or this never converges. One `IMG_LIMIT=all` run clears
the backlog (~1.3 GB). It also found **721 orphaned image files** on disk that no product
points at.

Three pages, linked from the footer, all marked **DRAFT on the page itself**:

- **`/despre`** — the methodology page, which for a comparator *is* the trust page. States that
  prices can be 24 hours old, that the final price is the one at the till, that no Romanian
  grocer publishes an EAN so matching is by name/brand/size, and plainly that wrong matches
  exist. Its numbers are read from the database, so it cannot drift.
- **`/confidentialitate`** — lists the third-party hosts the browser contacts, **generated from
  the catalog** rather than typed, because a hand-written list is true only on the day it is
  written. This disclosure was previously absent while the site already showed a cookie banner.
- **`/termeni`** — accurate about what the service is and is not.

They are accurate about the software. They have **not** been reviewed by a lawyer.

Also fixed a CSS bug introduced in Phase 6: the offline-banner tokens were defined in the dark
blocks and in a `.viz` selector but **not on bare `:root`**, so a light-mode visitor with no
explicit theme got `background: var(--undefined)` — transparent, failing silently.

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

# Overnight session — every price a user sees is correct

Branch `fix/pepsi-merge`. Ten phases, in order, no reordering.

## PHASE 1 — finish the scrape

Started from 3 merchants already done under mixed matcher code; killed that run, took a fresh
backup, pushed the `offersWritten` schema change, and started `scrape:all` clean so every
merchant goes through the current matcher (variant hard block + pack shape + tobacco
exclusion).

Completions as they landed, with the pool census printed by `matchPoolToCatalog`:

| merchant | offers written | pool | matched | review | rejected |
|---|---|---|---|---|---|
| auchan | 5,944 | 5,695 | 5,692 (99.9%) | 0 | 3 |
| freshful | 329 | 3,101 | 317 (10.2%) | 406 | 2,214 |
| mega-image | 720 | 6,960 | 695 (10.0%) | 786 | 5,088 |
| carrefour | 904 | 4,010 | 898 (22.4%) | 748 | 2,336 |
| metro | 5,297 | 5,246 | 4,743 (90.4%) | 0 | 503 |
| sezamo | 7,804 | 7,785 | 7,783 (100.0%) | 0 | 2 |
| finestore | 276 | 276 | 275 (99.6%) | 0 | 1 |
| lemanoir | 94 | 97 | 4 (4.1%) | 0 | 93 |
| carrefour-alcohol | 1,202 | 1,212 | 762 (62.9%) | 56 | 394 |

Notes on the numbers, so they are not read wrong later:

- **"matched" counts matches to an EXISTING catalog product.** Le Manoir shows 4/97 matched
  and still wrote 94 offers, because it runs with `addNew` and the other 93 became new
  catalog products. A low match rate on an addNew merchant is not a failure.
- **freshful, mega-image and carrefour are match-only** (`addNew` defaults false), so their
  rejected column IS discarded work. Those three are the ones where the 70%+ rejection rate
  matters, and the Mega Image diagnosis (37/50 sampled rejections correct, ~1,200 realistic
  upside) is in the backlog, not tonight.
- **metro wrote more offers than pool items** (5,297 from 5,246): one store item can back more
  than one catalog product. Not an error, but worth watching for fan-out.

The tobacco exclusion fired live during the run — 30 products on one merchant, 200 on another,
printed with samples ("Tigari", "Tigari Tuned Blue XL").

The rule-coverage table printed on every run. First full-catalog counts under the new matcher:
`size=765139 · size-unit=159896 · brand=114035 · mutually-distinct=20765 · ean=5651 ·
variant-flavour=1515 · brand+size=975 · pack-shape=409 · low-overlap=274 ·
variant-mismatch=237 · name+size=217 · variant-qualifier=194 · variant-format=19 ·
dose-mismatch=15 · variant-fat=2 · head-noun=0`.

`variant-flavour` at 1,515 and `pack-shape` at 409 are the two blocks added for the Pepsi
page doing real work across the whole catalog. `head-noun=0` is unreachable-by-construction,
recorded in BACKLOG so nobody chases it as a second doseTokens.

Remaining when this entry was written: dcneu (mid detail pass, ~2,500/6,019), farmaciatei,
kaufland, penny.

### Groundwork found while phase 1 finished (read-only, no changes)

Two things that make phase 5 (SGR deposit) far cheaper than expected:

- **Auchan PUBLISHES the deposit.** Its VTEX payload carries `"GARANTIE_SGR":["0,5"]` —
  the per-container deposit in lei, stated by the merchant. 995 offers already hold it in
  `rawSourceBlob`. That is an authoritative value, not a derivation, and it is the same shape
  as Kaufland's `formattedBasePrice`: a merchant-computed figure that shares no assumption
  with our parser.
- **Auchan marks SGR products in the URL.** 1,134 offers have a `-sgr` suffix in
  `productUrl` (VTEX `linkText`), which identifies deposit-bearing products even where the
  attribute is absent.

So the plan for phase 5 is: read `GARANTIE_SGR` where published, fall back to 50 bani per
container for in-scope categories, and multiply by `containerCount` derived from `packCount`.
The six-pack vs 2 L difference the brief calls out (3,00 lei vs 0,50) falls straight out of
that.

## PHASE 4 — the misleading strikethrough (done during the phase-1 wait)

Implemented while DCNeu's detail pass ran. Phases 2 and 3 are reports against the freshly
scraped data and could not start yet; this one needed no new data, only the rendered pages,
which already exist.

**The defect.** `src/app/p/[slug]/page.tsx` rendered `summary.highest` — the CROSS-STORE
MAXIMUM — inside a `.strike` span next to the lowest price:

    cel mai mic preț  12,00   ~~17,99~~

17,99 was another merchant's price. Struck through, it reads "was 17,99, now 12,00": a
discount nobody ever gave, on a product nobody ever discounted.

**The fix.** `src/lib/reference-price.ts` decides what may be shown. A strike requires a
reference on the SAME offer, strictly above that offer's own price, of kind STRIKETHROUGH. A
range is stated as a range: "între 12,00 și 17,99 lei în 4 magazine".

**A DEVIATION FROM THE BRIEF, for the morning decision.** The brief allows striking either
STRIKETHROUGH or OMNIBUS_30D. CLAUDE.md says the opposite about the second, and I followed
CLAUDE.md: the Omnibus figure is the LOWEST price of the past 30 days, printed because the law
requires it, so striking it claims a saving on what may be a price *increase*. It is now shown
with its own label — "Preț minim în ultimele 30 de zile: X" — so the number still reaches the
page and only the discount claim is withheld. Decision 1 in the morning report.

**Surfaces swept.** Only the item page made this claim. `/oferte` says "economisești până la
X" while naming the cheapest shop, and the basket says "dacă mergi în N magazine în loc de
unul" — both state the comparison explicitly rather than dressing it as a discount, so both
were left alone.

**Guard.** `audit:displayed` gains: no struck price may equal another offer's price on the
same product. In `verify:site`.

**VERIFIED BY RENDERED HTML** on five products that have a range:

    /p/telemea-de-vaca-in-saramura-delaco-400-g-5941360013192
      cel mai mic preț | 25,19 RON | între 25,19 și 25,49 lei în 2 magazine
    /p/iaurt-grecesc-natur-olympus-2-grasime-900-g-5941875901359
      cel mai mic preț | 15,49 RON | 20,79 RON | între 15,49 și 16,99 lei în 2 magazine
    /p/cascaval-de-ibanesti-mirdatod-450-g-5941872204255
      cel mai mic preț | 30,19 RON | între 30,19 și 30,79 lei în 3 magazine
    /p/cascaval-delaco-sofia-400-g-5941360016346
      cel mai mic preț | 28,29 RON | între 28,29 și 28,99 lei în 2 magazine
    /p/telemea-de-vaca-hochland-350-g-5941238005052
      cel mai mic preț | 18,96 RON | între 18,96 și 19,29 lei în 2 magazine

Four show no strike at all. The fifth strikes 20,79 — which is NOT inside its own 15,49–16,99
range, so it is a genuine former price at that same shop and is correctly kept. That is the
distinction the whole phase is about, visible in one line of output.

727 tests pass.

## PHASE 6 — out-of-stock sweep, site-wide (done during the phase-1 wait)

Two real gaps, both the same shape: the withholding rule existed in one place and was not
applied in the others.

**`isCurrent` never checked `flagged`.** The canonical "is this a price we stand behind"
predicate tested availability, staleness and observation age — and not whether a gate had
withheld the offer. So the 135 kept-over-refused rows and the 62 excluded-category rows were
withheld on the item table and counted as current everywhere else, including in `summarize`,
which feeds every headline and every count on the site.

**`currentOfferWhere` had the same hole.** That is the database twin of `isCurrent`, and the
comment above it says both must agree. They did not.

**Three listing paths filtered on `availability` alone**, ignoring staleness and flags
entirely. All now call `isCurrent`, so there is one rule and one place to change it.

`tests/page-self-consistency.test.ts` extended from the item page to ten surfaces — `/`,
`/oferte`, `/dcneu`, `/alcool`, `/cosmetice`, `/farmacie`, `/c/lactate`, `/c/bauturi`,
`/search?q=lapte`, `/lista` — each fetched and checked for NaN, Infinity, `undefined RON`,
`null RON` and an empty price. All ten clean.

728 tests pass.

DEFERRED, logged rather than done: recipe pages and alerts were not swept. Both read prices
through the same `queries.ts` helpers that now enforce `isCurrent`, so they inherit the fix,
but neither was fetched and verified by rendered output. That verification is outstanding.

## PHASE 8 — methodology page (done during the phase-1 wait)

`/metodologie`, in plain Romanian, built from the live database rather than hand-written
(merchant table, price channels, section counts all come from Prisma, so it cannot drift out
of date the way a static page would).

Covers, as the brief asked: which merchants and sections, that we read public pages once a
day and drop anything unseen for MAX_DISPLAY_AGE_DAYS; what shelf / online / flyer each mean
and that flyer prices carry a validity window; that we always link back to the merchant; that
SGR deposits are shown separately and refunded on return.

The matching section is deliberately the most honest part — it says we match automatically,
that uncertain matches are held for a human and the product stays separate until then
("preferăm să pierdem o comparație decât să punem prețul unui produs pe altul"), and that
flavour, concentration, fat and format differences stop a match outright.

A "ce nu facem" section states the three things this session fixed, as commitments: no price
we have not seen ourselves, no tobacco, and no striking another shop's price to fake a
discount.

`raportează un preț greșit` now appears under the price table on EVERY item page, and the
footer's "Cum funcționează" points here instead of `/despre`.

VERIFIED BY RENDERED HTML: `/metodologie` returns 200 and renders the merchant table, the
SGR section and the report link.

`/despre` is left in place — it is the short pitch and is linked from elsewhere. Backlog:
decide whether to fold it into this page or keep both.

## PHASE 1 — completed

All 12 attempted. **KAUFLAND ABORTED TWICE** — see the morning report, decision 2.

Late completions: DCNeu (6,129 fresh offers, 18,330 review candidates queued),
Farmacia Tei 2,022, Penny 30. Kaufland refused both times:
`296 offers < 60% of last 594 live in section "grocery"`.

The Kaufland abort is the drop guard working and being wrong at the same time. Kaufland is a
FLYER source: its weekly catalogue genuinely varies in size, and this week's has 264 products
against a baseline built from a larger one. The 60% guard was designed for a site redesign or
an anti-bot block, where a collapse means the read broke. For a weekly flyer, a collapse can
just be a smaller week. The guard kept the previous data, which is the safe outcome, so
Kaufland is serving last week's prices with last week's dates.

Provenance coverage after the run (percentages of that merchant's total offers):

| merchant | offers | fresh | storeName | ownSize | rawText | blob |
|---|---|---|---|---|---|---|
| auchan | 9,391 | 5,981 | 64% | 61% | 65% | 64% |
| carrefour | 2,801 | 2,131 | 76% | 76% | 77% | 76% |
| dcneu | 8,279 | 6,129 | 74% | 64% | 97% | 74% |
| farmaciatei | 2,717 | 2,022 | 74% | 57% | 82% | 74% |
| finestore | 278 | 276 | 99% | 99% | 100% | 99% |
| freshful | 1,938 | 357 | 18% | 18% | 22% | 18% |
| kaufland | 655 | 595 | 91% | 80% | 100% | 100% |
| lemanoir | 94 | 94 | 100% | 4% | 100% | 100% |
| mega-image | 2,746 | 724 | 26% | 26% | 27% | 26% |
| metro | 6,519 | 5,339 | 82% | 74% | 83% | 81% |
| penny | 53 | 30 | 57% | 11% | 58% | 0% |
| sezamo | 9,219 | 7,808 | 85% | 85% | 86% | 85% |

The low percentages are all the same thing: offers not re-seen this run keep their old rows,
and those predate the provenance columns. freshful and mega-image are lowest because they are
match-only and reject 70%+ of their pool.

Penny at 0% blob is a real gap: the adapter runner sets `rawSourceBlob` on the JSON path and
not the DOM path. Logged to BACKLOG.

## PHASE 2 — the Pepsi product, PROVEN

Auchan's genuine six-pack now matches by EAN: storeName
`"Bautura carbogazoasa cu gust de zmeura Pepsi, doza, 6 x 0.33 l"`, ownUnitSize 1.98 l,
packCount 6, 28,14 lei, unit price 14,21 lei/l. Nothing new attached wrongly — the variant
block held across the whole catalog (variant-flavour fired 1,515 times, pack-shape 409).

BUT THE FIRST RENDER STILL FAILED. Three pre-block offers were still on the product:

    Mega Image | Stoc epuizat | ultimul preț 6 aug. 2026 | 10,49 RON | 5,30 lei/L
    Carrefour  | Stoc epuizat | ultimul preț 6 aug. 2026 | 10,49 RON | 5,30 lei/L
    Freshful   | Stoc epuizat | ultimul preț 6 aug. 2026 | 17,99 RON | 9,09 lei/L

all `storeName` NULL, `matchedBy` "scraper", stale. The variant block governs matches the
matcher MAKES; these were made before it existed and their merchants' fresh runs simply never
re-matched them, so the rows were marked stale and left where they were. Greyed with a date,
they still claimed two shops carry a six-pack they do not sell.

TWO FIXES:

1. `withhold:unverifiable` — 9,822 offers across ~6,600 products that are stale, carry no
   name of their own, and were matched by the pre-band path. They cannot be re-judged and the
   matcher that made them is discredited. Flagged, not deleted; a re-scrape that sees the
   product again writes a real offer and clears it.
2. The item page now excludes FLAGGED offers from the table entirely. Out-of-stock rows still
   show with their dates — that is a fact about a shop that does carry the product — but a
   withheld row is one we do not believe, and greying a false claim does not make it true.

**RENDERED HTML, after the fixes:**

    cel mai mic preț | 28,14 RON | 14,21 lei/L · | 1 magazine | Vezi la Auchan · 28,14 RON →
    Prețuri în 1 magazine
    Magazin | Disponibilitate | Preț | Preț/unitate
    Auchan | 🏬 | Magazin + online | În stoc | 28,14 RON | ✓ Cel mai mic preț | 14,21 lei/L

One row, one shop, no cola, no vanilie, no 2 l PET. Count and rows agree. 28,14 / 1,98 =
14,21. No strikethrough. PASS.

## PHASE 3 — the unit-price-spread products

**81 → 60 → 1.**

The re-scrape under the variant block did most of it on its own: 81 products above 2x spread
when first measured (worst 24.3x, freshful 1,69 against sezamo 40,99), 60 after the fresh data
landed (worst 5.9x). The variant hard block and own-size provenance cut both the count and the
severity without anyone withholding anything.

`withhold:spread` then took the remaining 59 (one had already resolved between measurements):
**106 offers withheld across 59 products, all 106 queued to /admin/matches.** The cheapest
offer on each product stays, so the page becomes a single-shop price record with no
cross-store claim — the claim is the part that was wrong, not the price.

Re-measured after: **1 product above 2x**, and it sits exactly on the 2.0x boundary
("CARNE SI SARE Mici porc vita oaie cca 0,53 kg" — a variable-weight meat product, where a
2x spread between shops is plausible rather than a bad match).

A BUG FOUND IN THE AUDIT ITSELF while doing this. `audit:unitprice` filtered on `isStale`
and not on `flagged`, so after withholding 106 offers it still reported 60 — counting rows
that are on no page. The same gap `isCurrent()` had in phase 6. Fixed; it now measures what
the site actually shows.

**A CONCERN I AM LOGGING RATHER THAN DECIDING** (morning decision 3): the brief says keep the
cheapest offer. On some of these the cheapest may be the WRONG one. "Gelatina foi Dr. Oetker
10 g" carried sezamo 1,59 · carrefour 5,79 · auchan 6,85 on names that all look like the same
product — that reads more like sheets-vs-package than a bad match, and keeping 1,59 shows the
lowest price on the page when three shops say otherwise. Kept-cheapest is what the brief asked
for and what I did; whether it should be kept-median is your call.

Worst 20 before withholding, for the record: 5.9x Măsline Kalamata · 4.6x Gelatina foi
Dr. Oetker · 4.0x Tagliatelle Carbonara Baneasa · 3.9x Pasta de dinti Colgate Total.

## PHASE 7 — the 21 smeared DCNeu ladders, and a much bigger find

**Smeared ladders remaining after the fresh scrape: 0.** The check is the population one —
an identical rung set appearing on 5+ offers that have 2+ distinct base prices — and it finds
nothing. The 21 are gone, resolved by the re-scrape rather than by suppression.

**The withheld-base rule holds exactly.** Of 3,743 offers carrying tiers, 3,596 ladders render
and 147 are refused — and all 147 are refused *because their base is withheld, stale or out of
stock*. Not one refusal for any other reason, which is what "a ladder on a price we do not
believe is a made-up number wearing a percentage" looks like when it is working.

### THE FLORI ARTIFICIALE QUESTION — half the shop was missing

The user pointed at `FLORI ARTIFICIALE TOPORAS TEXTIL+PVC WEI A-80600` and it returned zero
rows. The 70 products matching "FLORI" are all false positives — "flori de soc", "floarea
soarelui", "floricele".

**DCNeu publishes 180 leaf categories. We scraped 90.**

`MAX_CATS` defaulted to 90 and the discovery does `.slice(0, MAX_CATS)`, which takes the first
90 **in page order** — so it was not sampling the shop, it was truncating it, and the entire
back half was invisible. `menaj/flori-artificiale` sits past position 90. So does
`menaj/articole-baie`, `menaj/borcane`, `menaj/boluri` and 86 others.

Every run logged `Discovered 90 leaf categories`, which reads as a fact about DCNeu rather
than a fact about our cap. That is the whole failure: the number was true and told nobody
anything.

Cap raised to 250, and the log now says `⚠ CAPPED at MAX_CATS=N — there may be more` whenever
it bites. **DCNeu needs a re-scrape to pick up the missing half** — not run tonight, because
DCNeu alone takes over an hour and the remaining phases matter more.

Logged to BACKLOG: every other scraper with a MAX_* constant needs the same look. The failure
is silent by construction — a cap that bites produces a smaller, entirely valid-looking run.

## PHASES 9 & 10 — verify, measure, close out

audit:displayed 8/8. audit-db 23/28. verify:site NOT green; the five remaining are itemised
in MORNING-REPORT §2 with a judgement on each.

THREE AUDITS WERE MEASURING THE WRONG THING, all the same way — counting rows that
withholding had already removed from every page. 8,822 then 22 then 46 reported failures,
none of them a defect the site has. Fixing the site made its own checks lie, which is as
dangerous as a check that misses real defects: both teach you to ignore it.

Real fixes in this phase: 60 offers past their promo window marked expired, 129 tier rows
removed from offers under review, 7 median outliers withheld with refusals recorded.

THE ASSUMPTION TEST: every offer on one product describes the same size. Nothing verified it
after matching. 0 of 2,017 comparable products disagree — the first clean result this method
has produced, and it means the size gate works end to end rather than only at match time.

Final backup taken.

## ITEM 1 — the 47 outliers: one definition, and the 47 were not real

**The 47 were an artifact of two definitions over two populations — the priceSource shape.**

    audit-db:   |b - med| > 0.7*med   over EVERY offer it had loaded
    the repair: b > 1.7*med || b < med/1.7   over VISIBLE offers only

Two thresholds and two populations. They agree on the high side and differ by a factor of two
on the low side (0.30*med against 0.588*med), and they disagree entirely about which rows
count. The audit said 47, the repair found 7, and the gap read as a bug in one of them rather
than a disagreement between them.

`src/lib/outlier.ts` now holds the rule, the threshold, the minimum peer count and the
population, and both callers import it. The absolute form is kept because "more than 70% from
the median" is what CLAUDE.md states; the ratio form would need 1/1.7 = 0.588, which reads as
41% and is not the rule.

**Result under one definition: 0 visible outliers.** The 47 were withheld, stale or
out-of-stock rows — on no page, misleading nobody. The invariant is now green and its name
says `no VISIBLE offer deviates`.

The median is computed over VISIBLE offers only, which matters: including withheld ones lets
a price we have already refused drag the median toward itself and hide the next one.

`withhold:outliers` also diagnoses, per the brief — pack-mismatch vs missing ownUnitSize vs
genuine disagreement. With zero found there is nothing to diagnose, so the multipack question
is answered by absence: the pack-shape gate IS reaching these rows now that the re-scrape has
populated ownUnitSize.

## ITEM 2 — DCNeu at full coverage, and truncation made loud everywhere

`src/lib/truncation.ts`: `noteCap(label, discovered, scraped, cap)` for slice-style caps and
`notePageCap(label, pagesRead, cap)` for pagination loops. Both print a loud line when the cap
bites, because the failure is silent by construction — nothing crashes, the count is merely
lower, and a lower count is indistinguishable from a shop that sells less.

**Every cap in the codebase, surveyed:**

| scraper | cap | value | shape | currently truncating |
|---|---|---|---|---|
| dcneu | MAX_CATS | 90 → **250** | slice | **YES — 90 of 180.** Fixed |
| farmaciatei | MAX_SUBS | 24 | slice | wired to `noteCap`; reports at run time |
| carrefour | MAX_PAGES | 13 | pagination | wired to `notePageCap` |
| carrefour-alcohol | MAX_PAGES | 8 | pagination | wired |
| finestore | MAX_PAGES | 12 | pagination | wired |
| lemanoir | MAX_PAGES | 15 | pagination | wired |
| metro | MAX_PAGES | 45 | pagination | wired |
| megaimage | MAX_PAGES | 65 | pagination | loop shape differs, not wired — BACKLOG |
| sezamo | MAX_PAGES | 30 | pagination | loop shape differs, not wired — BACKLOG |
| auchan (adapter) | maxPages | 8 | pagination | runner breaks on an empty page, self-limiting |

The slice-style caps are the dangerous ones: they take the FIRST N in page order and lose the
tail. Pagination loops usually exit early when a page adds nothing, so reaching the cap is
suspicious rather than proof — `notePageCap` says so in those words.

**New invariant:** `no merchant's successful run collapsed to half its own recent best`. That
is the shape truncation leaves in the data after the fact — a run reporting success while
writing half what it used to. Currently green.

DCNeu now reports `Discovered 180 leaf categories, scraping 180`. Re-scrape running.

## ITEM 3 — Kaufland: the scrape was fine, the BASELINE was wrong

**The actual error:** `run refused: 296 offers < 60% of last 594 live in section "grocery"`.
Nothing else. The scrape itself was healthy — 264 of 265 prices parsed, 0.4% null, one empty
string — and it matched 296 offers from a 264-product pool.

**Why the baseline was wrong.** All 594 "live" Kaufland offers were observed on one day, and
**303 of them carried a promo window that had already passed**. Flyer offers accumulate across
weeks unless something expires them, so the guard was comparing one week's catalogue against
three weeks of dead ones. 594 − 303 = 291 genuinely current offers, and 296 against 291 is a
healthy run, not a 50% collapse.

**Fixed without touching the guard, as instructed.** The drop-guard baseline now excludes
offers whose promo window has passed. That is not an exemption and not a weakened threshold —
the guard's rule is unchanged and still 60%. What changed is the number it reads, from "every
row not yet marked stale" to "every row that is actually still on offer".

Kaufland now writes **296 offers**. All 12 merchants succeed.

**What would change if FLYER sources were exempted from the guard entirely** (the decision I
was told not to take): Kaufland and any future flyer source would write whatever they found,
including zero. The guard exists because a site redesign or an anti-bot block produces a
collapsed run that looks exactly like a small week — and for Kaufland specifically, a broken
run would silently replace 296 real prices with nothing while the merchant still looked alive
in `audit:liveness`, because a write of zero offers still updates nothing and leaves the old
rows in place. **The risk of exempting is that the one merchant whose data is hardest to
sanity-check (weekly, no deep links, 100% flyer) would lose its only structural guard.** The
baseline fix removes the need to decide: the guard now works correctly on flyer data.

## ITEM 4 — every audit now declares its scope

Three audits reported 8,822, 22 and 46 failures that were artifacts of withholding working.
The cause was never a bad threshold — it was that an audit and the display disagreed about
what "shown" means, and nothing in the audit said which it meant.

All 21 audits now carry a scope banner as their first lines:

**USER-FACING** — counts only rows that reach a page: `audit-displayed`,
`audit-comparability`, `audit-unit-price`. A withheld, flagged, stale-and-hidden or
quarantined row is on no page and cannot mislead anyone, so counting it reports a defect the
site does not have.

**DATA INTEGRITY** — counts every row, shown or not, and says "do not add a visibility filter
here": the other 18. A withheld row is still data and a corruption hiding inside one is still
a corruption.

Corrected numbers after the re-scope:

| audit | before | after |
|---|---|---|
| audit-displayed | 6/8 | **8/8** |
| median outliers | 47 | **0** |
| cheapest offer withheld | 8,822 | **0** |
| struck price collisions | 22 | **0** (check replaced with a structural one) |
| run successful with zero writes | 46 | **0** |
| audit:unit-recompute | 0 live bugs | 0 live bugs |
| audit:liveness | green | green, all 12 merchants |

## FINAL — the metric split, and the last two cosmetic failures

**1. Comparability split by section type.** `src/lib/section-type.ts` states it once and
`audit:comparability`, `/admin/health` and `/metodologie` all read it.

    COMPARISON (grocery + alcool)   1,980 of 24,361 comparable   8.1%   <- the product metric
    PRICE (dcneu + cosmetice + farmacie)
        products                    15,631
        with a showable price       12,784   81.8%
        offers with a ladder         7,239   56.6%

The blended figure was measuring catalog COMPOSITION. DCNeu grew by 6,895 single-merchant
products when its scraper stopped truncating and the headline fell from 5.6% to 5.0% — the
catalog got strictly better and the number got worse. A metric that falls when you fix a bug
is measuring the wrong thing.

The methodology page now says it to shoppers too, under "Ce poți compara și ce nu": a person
landing on a DCNeu page expecting a comparison and finding one shop deserves to have been told
why, rather than concluding the site is broken.

**2. The two cosmetic failures were both invisible-row artifacts, again.**

*6 missing deep links:* zero under the visible population. The invariant counted withheld,
stale and out-of-stock rows — a link can only mislead someone who can click it.

*2 offers with no rawPriceText:* both flagged, stale AND out of stock. But the interesting
part is WHY they had none — `repair-flagged-provenance` deliberately NULLS rawPriceText when a
gate refuses a price, because the string we held belonged to the refused value rather than the
kept one. This invariant then flagged exactly the rows another rule had deliberately cleared.
**Both rules were right; the scope was wrong.** Flagged offers are now exempt.

audit-db 25/29 → **27/29**.

**The two survivors are historical records and are now commented as such**, so nobody tries to
make them green:

- Kaufland's two aborts on 2 September genuinely happened. The cause is fixed and Kaufland
  writes 296 offers, but deleting the run rows to clear the invariant would be falsifying the
  record of an outage to make a dashboard green. If it still fails in a week, THAT is a signal.
- The two mass-move days are both full re-scrapes after a matcher change, which is what those
  are for. The invariant cannot tell a correction from a corruption and should not try — a
  human looks at any day it fires. Both were looked at; both are corrections. Tuning the
  threshold to hide them would disable the check for the next real one.

---

# Overnight session 2026-09-08 — `overnight/2026-09-08`

Written as the work happens, so that if the session dies this file says where it got to.

## Ordering note, before anything else

Four commits landed **on `main` before this brief arrived**, in response to an earlier
instruction in the same conversation ("finish everything"). They are:

    967930a  perf(search): build the search index once per catalog version
    8eb9401  tools: read-only discovery for delivery-platform storefronts
    846de15  equivalence classes for private-label staples: 30 new + the second number
    b590c6b  fix(sezamo): every stored product link was a 404
    381cb44  chore: untrack raw page dumps

The overnight brief says branch and never merge to main. I could not retroactively unland
them and did not rewrite published history to pretend otherwise. Everything from this point
is on `overnight/2026-09-08`. **This is decision 1 in the morning report.**

The same brief says to build the 30 classes and STOP before rendering them. **Phase 4 was
already built and is live** — see decision 2.

## Phase 1 — /search performance. DONE (committed to main before the brief).

Measured first, as asked:

    ROWS LOADED   products 29,166 · offer-count rows 29,166 · categories 93
    product query        282 ms      offer groupBy   237 ms
    build searchable       4 ms      searchCatalog   213-241 ms
    ------------------------------------------------------------------
    DB 520 ms + JS ~230 ms, ON EVERY REQUEST

Where ranking happens: entirely in JS, over the whole catalog. What made it expensive was not
the ranking but the three structures rebuilt before it — catalog vocabulary, head-noun
frequency, brand set. None is per-query; all are pure functions of a catalog that changes once
a night. We were recomputing a nightly constant per keystroke.

Brand-existence separated from ranking exactly as the brief asks: `buildSearchIndex()` now
produces the vocabulary and brand set once, and `searchCatalog(q, catalog, index)` takes it.
The "Nu am găsit illy" answer still consults the real brand set, so the honesty guarantee is
untouched.

FTS5 considered and NOT used. It would answer "which rows match" quickly, but the expensive
part here was never row selection — it was the derived vocabulary needed to say a brand does
not exist. FTS5 does not provide that, so it would have added a schema and left the cost.

    BEFORE  /search?q=lapte   880-919 ms
    AFTER                     254 ms best · 275 ms first-after-purge · target was <300 ms
            /search?q=apa     226 ms · /search?q=illy 132 ms

/api/revalidate now drops AND rebuilds the index, awaited, so the ~880 ms rebuild is paid by
the nightly rather than by the first shopper of the morning.

**The 40-query fixture: 36/40, unchanged.** The four failures (`illy`, `illy capsule`,
`ulei baneasa`, `cicolata`) are catalog-growth artefacts from the earlier addNew change — we
now genuinely stock Illy, and "cicolata" is a real typo inside a product name, so it entered
the vocabulary. **Quality did not regress to buy latency, and that is verified rather than
asserted:** `npm run verify:search-identity` runs all 40 through the same ranker with and
without the prebuilt index and compares kind, ordering and every id. **40/40 byte-identical.**

## Phase 2 — private-label opportunity. DONE. (`npm run audit:private-label`)

`ProductAttribute` is EMPTY — 0 rows, no keys at all. `isPrivateLabel` has never been set on
anything, so `preferPrivateLabel` in the substitution resolver has been reading a hardcoded
`false` for every product since it was written. Every figure below is from brand names.

    live grocery products                    29,166
    private label by brand name               3,859  (13.2%)
      found by the brief's 14 brands          2,476
      found ONLY by 13 brands the data named  1,383  (+56% on the brief's list)
    single-shop AND unclassed                 3,447  <- the target

Per merchant: metro 1,626/5,272 (100% single-shop), auchan 760 (100%), mega-image 750 (98%),
carrefour 680 (100%), freshful 50 (66%), kaufland 7, sezamo 3, penny 0.

Brands the brief's list missed, each appearing at exactly one merchant: ARO (432, metro),
Carrefour Bio (136), Carrefour (221), Cosmia (98), Carrefour Sensation (81),
Nature's Promise Bio (78), METRO PROFESSIONAL (69), Pouce (62), Filiera Auchan (48),
RIOBA (47), World's Market (47), Din Grădină by Freshful (33), TARRINGTON HOUSE (31).

Deliberately NOT added, though the single-merchant heuristic nominated them: DOVE, GILLETTE,
Schwarzkopf, Bic, SAVEX, La Lorraine, Covalact de Tara — national brands one shop happens to
stock. Single-merchant is what a private label looks like from outside; it is not what one IS.

Grouped by head noun + unit + exact size: **1,440 groups, of which only 162 span 2+ merchants.**
A group at one merchant cannot become a useful class, so the ranking excludes them. Top 100
reported with every member, its size and its price.

## Phase 3 — 30 classes + the outside audit. DONE.

See `src/data/private-label-classes.ts` and `npm run audit:private-label-classes`. Printed in
full in the morning report. Verdict after two rounds of fixes: **10 clean, 20 flagged on the
>2x unit-price rule, 0 outside window, 0 single-merchant.**

MILK IS NOT AMONG THE 30, and it was the brief's own headline example. Carrefour names its
treatment; Mega Image and Freshful do not. Mega carries "Lapte de consum 3.5% 1L" at 5,49 and
"Lapte 3.5% 1L" at 8,99 — same shop, same fat, same litre, nothing saying which is UHT and
which is fresh. Merging UHT with fresh is forbidden and the catalog cannot separate them, so
the class is not written.

## Phase 5 — the unattended backlog. DONE, with two of the five reframed by measurement.

**(a) `Offer.bulkTiers` JSON vs the `BulkTier` table.** The brief said drop the column after
confirming nothing reads it. **Things read it, so it was not dropped** — `src/lib/substitution/
load.ts` and `src/app/api/basket/v2/route.ts` both parse it, while the item page reads the
table. And the two copies are not merely redundant, they DISAGREE:

    offers carrying the JSON column     463
    BulkTier rows                    12,745  across 7,826 offers
    offers where BOTH exist             274
    of those, the two copies agree        0      <-- zero
    offers with JSON but no table rows  189      <-- would be lost if the column were dropped

    example, offer 26486:   json  1@1255, 4@840        table  3@1290

A `1@…` rung is a quantity-1 "tier", which is the base price wearing a discount's clothes and
precisely what `validateTiers` refuses. **The optimizer was parsing the JSON with no validation
at all** while the page ran the gate. Fixed by putting both readers through `validateTiers`
against the offer's own base price, so an invalid ladder is dropped rather than used. Dropping
the column is left as **decision 3** — it would discard 189 offers' data.

**(b) `productUrl` null: two facts, one value.** Both 100%-null merchants turned out to be
CORRECT and deliberate, each explained in a comment inside its own scraper — Kaufland's flyer
JSON has no per-product link, and Glovo's category tiles have no `<a>` (pointing at the category
URL tripped the fabrication guard at 71.7%, because it groups on `(price, productUrl)`).

So this was a *reporting* gap, not a data bug: the reason lived where no check could read it.
`src/lib/source-capabilities.ts` now declares per merchant whether the SOURCE publishes deep
links, and `audit:two-kinds` reads that instead of guessing from the percentage. The output
changes from "mixed — cannot be explained" to a verdict:

    kaufland        655   100%  expected: flyer JSON has no per-product link
    glovo-kaufland 2615   100%  expected: category tiles carry no <a>
    sezamo         9867     1%  GAP — declared to have product urls, but 83 row(s) carry none
    carrefour      5978     1%  GAP — 38 row(s)      metro 36 · mega-image 34 · freshful 14 · auchan 4

**209 real gaps**, previously indistinguishable from 3,270 correct nulls.

**(c) The DCNeu discovery regex.** Worse than the brief thought. It matches any two-segment
path, and DCNeu writes categories as `/<department>/<leaf>` AND products as `/<leaf>/<slug>` —
both two segments. Of 180 links matched on the home page today, **9 were products**
(`/balsam-rufe/asevi-balsam-rufe-1-44l-concentrat-zen`), not the seven estimated.

Fixed with a structural rule needing no extra fetch: a path's first segment is a department
only if it never appears as somebody else's second segment. Where it does, the first segment is
itself a leaf and what follows is a product. 180 → **171 categories, 9 products excluded**, and
the run now prints both numbers so `discovered === scraped` means something again.

**(d) `pricePerUnit = 0`.** Not 96 offers — **6,791**, and every one of them also has
`pricePerUnitBani = NULL`. The same line of `scrape-util.ts` writes both: the bani column says
"unknown" with a null, the float column says "unknown" with a 0. All 6,791 are products whose
own size could not be parsed from the name ("Chec festiv Auchan, pret/kg", "Avocado, pret pe
bucata").

The card guards on `unitLowest > 0` and renders blank, so **nothing false was displayed**. But
`Math.min(...pool.map((o) => o.pricePerUnit || 0))` let one unknown drag a whole product's
minimum to 0, and `SortableProductGrid` SORTS on that number — so "cheapest per unit" listed
the products whose unit price we could not compute AT THE TOP. An unknown presented as the best
answer. Fixed: `lowestKnownPerUnit()` skips unknowns, and the sort sends them last.

**(e) matchScore — the one the owner bet on, and it is ACTIVE, not latent.**

    matchedBy        offers   score range
    name+size        20,697   0.49 .. 0.85
    new              18,483   0.50 .. 0.50   <- a constant, not a measurement
    brand+size       10,518   0.67 .. 1.00   <- reaches 1.00
    scraper           9,533   NULL           <- no score at all
    ean               6,167   1.00 .. 1.00
    catalog-master       88   1.00 .. 1.00

A 1.00 from an EAN join and a 1.00 from `brand+size` are the same number meaning different
things — one is a join, the other is a score that happened to max out. **7 EAN-derived rows are
in the review queue**, so the queue does rank a join against a score. Small, but active.
Reported, not fixed: changing what a score MEANS touches matching, which this brief forbids.
It is **decision 4**.

**Gate after Phase 5:** 886 tests pass · build clean · `audit:db` **43/48** (was 42/48; running
`compute:home` cleared 20 stale `liveOfferCount` rows left by the Sezamo re-scrape). The five
failures are all pre-existing and none is in code touched here: two are documented historical
records (a mass-move day, the peer-relative group finding), and three are Carrefour/Auchan
(fan-out 9 > 8, 5 Carrefour offers with no deep link, 3 Carrefour campaign-landing URLs).

## Phase 6 — measure and propose. DONE.

**(a) The audit battery.** `audit:db` 43/48 (see MORNING-REPORT §2 for each failure).
`verify:site` halts at `audit:db` because the chain is `&&`; the later steps were run
individually — `audit:search-quality` 36/40, `verify:perf` all 12 routes under 1,000 ms,
`verify:offline` clean. `audit:liveness` green except one manifest entry naming a backup file
that is not on disk. `audit:categories` structurally clean, 5 empty Altele leaves.
`audit:unit-oracle` 8 disagreements. `audit:comparability` 79.3% of products have at least one
showable price.

**(b) Three assumptions nothing verified.** Two hold outright, which is worth as much as a
finding:

1. **`isCurrent` (JS) vs `currentOfferWhere` (SQL) — the twin pair CLAUDE.md says "must
   agree".** Nothing had ever compared the row SETS. They select **exactly the same 46,723
   offers**, zero on either side. Now checkable: `npm run audit:assumptions`.
2. **`priceBani` vs the legacy `price` float.** 65,486 offers, **0 nulls and 0 disagreements**.
3. **`Product.unitSize` vs the size in the product's own name.** 29,203 live products, 1,508
   with no readable size, and **exactly 2 disagreements (0.01%)** — a Colgate multipack stored
   as 0.25 l whose name says 0.75 l (the total was never summed), and a 250 g cherry-tomato
   punnet stored as 0.3 kg.

**(c) `docs/PROPOSALS.md`** — 11 entries ranked by value per hour of the owner's attention,
each with the measurement that justifies it, and two that say plainly they are not worth doing.

**(d) A real 20-staple basket, through the real API.** `npm run audit:real-basket` POSTs to
`/api/basket/v2` exactly as the page does, then checks every CHOSEN offer against the database.

    Sezamo 8 exact/6 subst/6 missing · Freshful 6/7/7 · Mega Image 4/9/7 · Metro 4/7/9
    Carrefour 1/5/14 · Auchan 3/7/10 · Penny 0/0/20
    BEST SINGLE SHOP: none could fill the basket.

**Every one of the 17 offers it chose passes every gate** — in stock, not stale, not flagged,
seen within 14 days, active merchant, not a delivery-platform price, and the optimizer's price
matches the database's to the ban. So no live bug in what it PICKED.

Two findings in what it OFFERED, though:

- **Kaufland (Glovo) appears as a candidate shop at 60,98 lei.** Neither `basket/v2/route.ts`
  nor `substitution/load.ts` filters `priceSource`, though `currentOfferWhere`'s own comment
  claims delivery-platform prices are off "everywhere — optimizer, item pages, deals, counts,
  search, comparability". The v2 route also omits `merchant: { active: true }`, which the
  loader applies — so the two disagree about which shops exist. **Proposal 1.**
- **`iaurt-natural-400g` merged 3% and 5% fat**: a request for a 5% 300 g yoghurt resolved to a
  3% 400 g one. `require: ["natural"]` with no fat discriminator, and the ±26% size tolerance
  admitted a 300 g pack into a 400 g class. Exactly what the classes brief forbids, and it
  predates tonight. **Proposal 8.**

Deposits are absent from every total: `OfferLike` carries no deposit field, so a basket with
bottled drinks understates the till price. Reported in the script's own output.

**(e) Added but never used.** `npm run audit:never-used`.

    EMPTY TABLES THAT LIVE CODE READS
      ProductAttribute   0 rows — read by substitution/load.ts; preferPrivateLabel has NEVER
                         done anything, it reads a hardcoded false for every product
      ProductSpec        0 — read by the item page
      ProductPackChange  0 — read by /shrinkflation
      UserFavorite / UserBlocklist / PriceAlert  0 — read by the optimizer and the alerts job

    Offer.currency  ONE VALUE (RON) across 65,486 rows — cannot discriminate anything
    ScraperRun.offersNull  max 0, total 0 across 154 runs — correct for what it measures
                           (pool items reaching the matcher with no usable price), and NOT
                           "prices we failed to read". Printing it as a null rate would be a
                           clean sheet measuring almost nothing.

    6 EQUIVALENCE CLASSES WITH NO LIVE MEMBER
      banane-bio-kg · mere-rosii-kg · nectarine-kg · cirese-kg · mandarine-kg · cartofi-noi-kg

## Phase 7 — close out. `docs/MORNING-REPORT.md` written.

Six decisions raised, two of them about work that had already landed before the brief arrived
(commits on `main`, and Phase 4 already being live). Both are stated plainly rather than
quietly undone.
