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
