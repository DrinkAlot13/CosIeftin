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
