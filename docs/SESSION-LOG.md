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
