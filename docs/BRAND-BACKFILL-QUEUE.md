# Brand backfill — written, queued, not run

Two detail-page harvests. **The script exists and is committed unrun**, because it fetches
thousands of pages and writes `Product.brand`, which feeds `decide()`'s brand gate — neither
belongs in the middle of a fortnight that is measuring the app.

`npm run backfill:detail-brands`

---

## What is queued

| merchant | what it reads | availability, measured | s/page | products | one pass |
|---|---|---|---|---|---|
| **sezamo** | `/brand/` link, else embedded JSON | **40/40 = 100%** | 4.2–4.9 | 7,189 | **~8.4–9.7 h** |
| **carrefour** | JSON-LD `brand.name` | **25/25 = 100%** | 9.2 | ~4,069 | **~10.4 h** |

Both are **merchant truth**. `docs/BRAND-GAP.md` rejected two inference routes — the
naming-convention rule graded 99.3% and still wrote `chivas` for chives, because it could only be
graded on the population that did not need it. This asks the merchant and writes what it says.

## Order

1. **Sezamo first.** It is 7,201 of the 11,312-product gap and its column is simply empty, so
   there is nothing to overwrite and no risk of replacing good data. Run without `--overwrite`.
2. **Carrefour second**, with `--overwrite`, because its column was deliberately voided
   (`docs/CARREFOUR-BRAND.md`) and the detail page is the value that should replace it.
3. **Re-run `propose:class-opportunities`.** Phase 1a found 334 of 1,833 candidate groups keyed by
   a brand rather than a noun, overwhelmingly Sezamo. `headNoun` is brand-aware; give it the brand
   and "every Alpro 1 l product" becomes "every plant drink 1 l". This is the change most likely
   to make the Phase 1b shortlist both bigger and cleaner.

## Coverage this reaches

| | live grocery products with a brand |
|---|---|
| today | 21,262 of 32,001 — **66.4%** |
| after Sezamo | **~87%** |
| after Carrefour too | ~87%, but ~1,266 of them corrected rather than absent |

Carrefour's contribution is accuracy, not coverage: it restores brands that were voided for being
wrong, this time from the field that is right.

## One-off, not nightly

A brand does not drift. The shape is **one pass, then a detail fetch only for products the listing
scrape sees for the first time** — `--new-only` does that, bounded to products created in the last
seven days. A rotating nightly slice would pay the cost forever for a question answered once.

## Safety, and how to undo it

- Never overwrites an existing brand unless `--overwrite` is passed.
- Every write is marked `ProductAttribute(key="brand", source="merchant-detail")`, so
  `--clear --write` removes exactly what this wrote and nothing a scraper or a human set.
- `--limit=N` bounds a run, so 8 hours can be done in slices.
- `robots.txt` honoured; one page at a time.
- Verify from outside with `npm run audit:brands`, which imports only `PrismaClient` and shares no
  code with the backfill. **That audit already caught one bad backfill in this project and forced
  a rollback**, which is the reason to run it rather than trust the writer's own count.

## Measure before and after

The golden set **cannot** see this — its 240 pairs carry literal names and brands, so a database
write cannot move it, and reporting "no regression" from it would be reporting a check that
checked nothing. The instruments that can:

- `npm run audit:fanout` — over-matching. Baseline: worst group 7, grocery p95 2.
- `npm run audit:comparability` — the split figure.
- A re-match simulation of the kind used for the Carrefour void, which found 0/114 sampled
  products could match a second merchant with the wrong brand and 18 could without it.

**Giving Sezamo a brand can go either way**: a brand gate with data can reject matches it
previously allowed, because a brandless product passes the gate by default. Sezamo is our largest
merchant by live offers, so this must be measured over the whole catalogue before and after — the
CLAUDE.md rule about blast radius, not an assumption that more data is better.
