# Backlog

Things found while doing something else. Written down instead of chased, so a session's
brief stays the session's brief.

Format: one heading per item, what was seen, why it matters, and what it would take.

---

## `Offer.bulkTiers` (JSON string) duplicates the `BulkTier` table

Two places hold the same fact. The JSON column is populated on **247** offers; the `BulkTier`
table holds **3,938** — and the table is the copy that goes through `validateTiers`, records
a `PriceAnomaly` when a ladder cannot be true, and is deleted/rebuilt per scrape.

The item page rendered the JSON one, so quantity discounts appeared on ~6% of the products
that have them, and specifically not the validated ones.

Now fixed by rendering the table. The JSON column is still written and still read by nothing.
**One vocabulary per column** (CLAUDE.md) says it should be dropped: add-and-backfill in one
push, drop in the next, with an `audit-db` invariant.

## The named verification product is not in the catalog

`FLORI ARTIFICIALE TOPORAS TEXTIL+PVC WEI A-80600` (base 7,78; 3+ → 7,00; 6+ → 6,61) returns
zero rows for "TOPORAS", "FLORI ARTIFICIALE" and "A-80600". Either DCNeu stopped listing it,
it was renamed, or it never entered the catalog. Verified the ladder rendering against
`DENIM AFTER SHAVE 100ML BLACK` instead — base 15,63, 2+ → 13,29 (-15%), 4+ → 12,50 (-20%),
which is the same shape.

Worth checking whether DCNeu's decor/artificial-flower category is being scraped at all.

## `head-noun` fires zero times — legitimately quiet, not dead

The new rule-coverage table reports `head-noun=0` on every run. It is NOT a dead rule: PHASE 1
looks candidates up *by* head noun (`storeByToken.get(chead)`), so every candidate reaching
`decide()` already shares it and the guard inside `decide()` can never fire.

Recorded here so nobody chases it as a second doseTokens. Two options, neither urgent: drop
the check as unreachable, or keep it for the PHASE 0 / EAN path where candidates do not come
from the head-noun index. Leaving it costs nothing but a permanent warning line, which is its
own small problem — a warning nobody can clear is a warning everyone learns to ignore.

Live counts from the first full run under the new matcher, for reference:
`size=765139 · size-unit=159896 · brand=114035 · mutually-distinct=20765 · ean=5651 ·
variant-flavour=1515 · brand+size=975 · pack-shape=409 · low-overlap=274 ·
variant-mismatch=237 · name+size=217 · variant-qualifier=194 · variant-format=19 ·
dose-mismatch=15 · variant-fat=2`

## Dead npm script: `backfill:pricechannel`

`package.json` still lists `"backfill:pricechannel": "tsx scripts/backfill-pricechannel.ts"`,
but that script was deleted when its source column was dropped. Running it fails with a
missing-file error. One-line removal; harmless but it is a lie in the manifest.

## Check every scraper for a cap that is silently truncating

DCNeu's `MAX_CATS` was 90 and DCNeu has 180 leaf categories — `.slice(0, 90)` took the first
half in page order and the log printed "Discovered 90 leaf categories" every run, which reads
as a fact about the shop rather than a fact about our cap. Half the shop was invisible, and
the user's reported product sat in the missing half.

Fixed for DCNeu (cap 250, and the log now says when the cap bit). **Every other scraper with
a MAX_* constant needs the same look** — `MAX_PAGES`, `maxPages`, `take`, `slice` — because
the failure is silent by construction: a cap that bites produces a smaller, entirely valid
looking run.

## DCNeu's category-discovery regex catches product pages

`/href="(https:\/\/comenzi\.dcneu\.ro\/[a-z0-9-]+\/[a-z0-9-]+)"/` matches any two-segment
path, so 7 PRODUCT urls (`balsam-rufe/asevi-balsam-rufe-1-44l-concentrat-zen` and six
siblings) are counted as leaf categories. "Discovered 180" is really 173 categories plus 7
products; all 173 real ones scrape and none yields zero.

Harmless today — a product page fetched as a category simply yields nothing extra — but it
makes the discovered/scraped assertion impossible to state cleanly, which is the assertion
that would catch the next truncation.

## FLORI ARTIFICIALE TOPORAS A-80600 is delisted at DCNeu

The category is now scraped (133 products listed, 140 pooled) and its ladders render. The
specific SKU the user pointed at is gone from DCNeu itself: zero TOPORAS products and no
"A-80600" anywhere in that category page. Nothing to fix — recorded so the question is not
reopened.

## Found while setting up the soak (2026-09-02) — not started

- **`backups/manifest.json` is a generated file tracked in git.** Every `npm run backup` dirties
  the working tree, and a dirty tree blocks a branch switch — which is exactly what blocked the
  `fix/pepsi-merge` merge. Either gitignore it (losing the record from history) or stop writing
  it on every run. `logs/soak/*.json` was gitignored from the start for this reason.
- **`/admin/health` had the Secțiuni table above the liveness block**, which put a composition
  metric ahead of the only block on the page that can tell a live source from a dead one — the
  exact ordering the liveness comment warns against. Fixed while adding the dead-source banner,
  but it says something that a comment saying "LIVENESS FIRST, above everything else on this
  page" did not prevent the section being inserted above it a session later.

## Found in the UI session (2026-09-02) — not started

- **962 products store a loading spinner as their product image.** The scraper reads `<img src>`
  before the site's lazy-loader swaps in the real URL, so what lands in the catalog is the site's
  own placeholder asset: 870 Carrefour `AjaxLoader_1.gif` (**40.7% of Carrefour's live
  products**, all in `alcohol`) and 92 DCNeu `placeholder-350x350.png`. These return HTTP 200, so
  `onError` never fires and no broken-image sweep can see them. The renderer now refuses them and
  shows a static named placeholder; the real fix is at each scraper's read site (prefer
  `data-src`/`srcset` over `src`, or wait for the lazy-load swap) and needs a re-scrape.
- **`Product.brand` holds junk values.** "X Y" is stored as the brand of at least one alcohol
  product and renders as an uppercase brand line on the card. Nobody has counted how many.
- **DCNeu category slugs include product names.** `Asevi Balsam Rufe 1 380ml Talco Rosa 60
  Spalari` is a top-level category. See the taxonomy proposal — this is the same root cause.

## Glovo — blocked on one decision, not on engineering (2026-09-02)

Recon complete; see `docs/data-sources.md`. Store discovery is solved, robots.txt permits
crawling, and the catalog is gated on a delivery address whose creation is a WRITE to Glovo's
customer_profile service. Not attempted: crawling their pages and creating a synthetic customer
record are different acts, and only the first is covered by robots.txt.

Needs from the owner, before any further work:
1. A decision on creating a delivery address on Glovo as a synthetic customer.
2. The ToS review that `data-sources.md` has flagged as outstanding since 2026-08-30.

If both clear, the adapter is Playwright-over-RSC (there is no product JSON API even in served
markets), and the markup work in the original brief follows. Nothing was built, because an
adapter with no reachable data is inert code — the failure mode that cost this project the
substitution engine and the `doseTokens` regex.

---

## One column carrying two kinds of fact — a shape to audit for, AFTER the soak

Fourteen defects in this project share one mechanism, and naming it is more useful than the
list. **Two different kinds of fact share one representation, something downstream recomputes
both, and the tell is always two things that should agree and don't.**

Confirmed instances:

- `Offer.priceSource` — the MERCHANT vocabulary (`shelf`/`delivery`/`aggregator`) and the OFFER
  vocabulary (`SHELF`/`ONLINE`/`DELIVERY_PLATFORM`/`FLYER`) in one column. 2,217 Glovo offers
  written as shelf prices because a translator's `default:` branch swallowed a valid value.
- **"quarantined"** — the census meant "has an unresolved PriceAnomaly", the site meant
  "flagged". 185 live offers carried an open anomaly and were shown anyway.
- `Offer.flagged` — a GATE'S judgement about today's data (must be recomputed) and a STANDING
  human decision (must never be). A re-scrape cleared both.

**Where to look next.** Not now — the soak forbids hunting — but these are the candidates:

- `stockStatus` — observed from the merchant vs inferred by us. A merchant that stops
  publishing availability and one that says "in stock" are not the same fact.
- `lastObservedAt` — on a FLYER row it means "the flyer still lists it", on a scraped row "we
  re-read this price". Liveness treats them identically.
- `matchScore` — an EAN join is 1.0 because it is a JOIN; a name match is 1.0 because it scored
  well. Same number, incomparable confidence, and the review queue ranks on it.
- `Product.unitSize` — a stated pack size vs one parsed out of a name vs a default.

**How to audit it**, when the fortnight is over: for each candidate, find two consumers that
read the column and ask whether they'd give the same answer on the same row. Every one of the
fourteen was found that way — by checking output against something that did not share the
writer's assumptions — and never by reading the code that wrote it.
