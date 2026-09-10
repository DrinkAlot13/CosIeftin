# Sezamo's brand is on the detail page, at 100%

`npm run probe:brand -- sezamo --n=40`, 2026-09-10. **Report only — no harvester built.**

---

## The answer

**40 of 40 sampled detail pages publish a brand. 100%.**

| where it was found | n |
|---|---|
| a link to the brand's own listing page (`/brand/…`) | 37 |
| an embedded JSON payload | 3 |
| JSON-LD / meta / spec row | 0 |

The values are clean and need no inference:

```
Beyond Meat · Mission · Actimel · Zimbria · Lay's · FOS · Casa Taraneasca
OLYMPUS · Biona · Kitchin · Vilgain · Snickers · Ökoland · Farmer · Alnatura
Pofta Focului · Misura · Marks & Spencer · Corso · Grane Aurii · EDENIA
Pur si simplu · Plafar · Torres
```

This is **merchant truth**, not the naming-convention inference that `docs/BRAND-GAP.md` rejected.
The inference graded 99.3% and wrote `chivas` for chives and `cookie` for a cookie, because it
could only be graded on the population that did not need it. A published brand link has no such
problem: Sezamo states the brand, and we read what it states.

## Cost

| | |
|---|---|
| seconds per detail page | **4.2** |
| Sezamo grocery offers with no brand | **7,189** |
| one full pass | **8.4 hours** |

8.4 hours is a weekend job, not a nightly one. Two shapes make it practical:

- **One backfill pass**, then keep it fresh by fetching a detail page only for products the
  listing scrape sees for the first time. New products are a small daily fraction, so steady-state
  cost is minutes.
- **Rotating slice**, the `probe:links` pattern — 200 a night finishes in five weeks and never
  adds a visible burden.

The first is better here: this is a one-off gap, not a value that drifts.

## What it would buy

Sezamo is **7,201 of the 11,312-product brand gap**. Closing it takes live grocery brand coverage
from **64.7% to about 87%** — and unlike every other route measured, none of it is inferred.

Downstream, all of it plausible rather than measured, and it should be measured after:

- **Class grouping.** Phase 1a found 334 of 1,833 candidate groups keyed by a brand rather than a
  noun, and those are overwhelmingly Sezamo. `headNoun` is brand-aware; give it the brand and
  "every Alpro 1 l product" becomes "every plant drink 1 l". This is the single change most likely
  to make the Phase 1b shortlist bigger and cleaner.
- **Matching.** Sezamo is our largest merchant by live offers and currently enters the brand gate
  with nothing. Whether that helps or hurts is genuinely unknown: a brand gate with data can
  reject matches it previously allowed. `audit:fanout` and a re-match diff over the catalogue are
  the instruments, and CLAUDE.md's rule applies — measure the blast radius over the whole catalog
  before and after, do not assume it.
- **Search ranking and private-label detection** both consume `Product.brand` and both improve
  mechanically.

## The order this should happen in

1. **Carrefour first** (`docs/CARREFOUR-BRAND.md`) — that is removing *wrong* data, which is a
   strict improvement and needs no new fetching.
2. **Then Sezamo** — adding *right* data, 8.4 h, measured before and after with `audit:fanout`.
3. Then re-run `propose:class-opportunities`, because the shortlist should change materially.

Neither is started. Both are after the soak.
