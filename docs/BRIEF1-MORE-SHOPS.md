# Brief 1 — more shops

2026-09-09 · Penny and Profi added via Glovo; Selgros reported, not run.

Phase 2 measured merchant overlap as the binding constraint on comparability and matching as
done. This is the only lever that measurement left open.

---

## robots.txt, confirmed before anything was fetched

Re-fetched 2026-09-09 and **byte-for-byte unchanged** from the 2026-09-02 record in
`docs/data-sources.md`:

```
User-Agent: *
Disallow: /embedded-web-views/*
Disallow: /*/order-tracking/*/share
Disallow: /*/password-recovery

User-Agent: PetalBot
Disallow: /
```

Store catalogs are permitted. `/stores/` appears nowhere in the file. We are not PetalBot.

## Lidl: confirmed absent, not overlooked

`npm run discover:stores` lists **eight** storefronts in Bucharest — carrefour, carrefour
supermarket, freshful, fryday, kaufland, mega-image, penny, profi — and Lidl is not among them.
Not retried, per the brief. `tests/delivery-platform.test.ts` now pins that no Lidl row exists,
because a config row for a store that does not exist fails with the *same* message as an expired
delivery-address session, and telling those apart costs an evening.

`profi-buc` was probed directly before being configured: HTTP 200, **117 product tiles**. The
bare slug `profi` renders *"Această pagină nu există"*, which is why the suffix is not optional.

---

## What each shop actually bought

Run one at a time, same gates, same `DELIVERY_PLATFORM` exclusion.

| | offers written | new products | queued for review | **comparisons it buys** |
|---|---|---|---|---|
| **Penny (Glovo)** | 678 | 509 | 413 | **82** |
| **Profi (Glovo)** | 1,112 | 652 | 1,017 | **261** |

"Comparisons it buys" is the counterfactual, not the offer count: **products where this merchant
is one of exactly two**, so removing the shop would stop them being comparable. It is the honest
measure of what a shop adds, and it is far smaller than the headline.

`npm run audit:merchant-contribution` — written for this brief, because "1,112 offers" is the
number that flatters and "261 comparisons" is the number that is true:

```
  merchant             offers  products  SOLE 2nd  only shop
  auchan                 5606      5606      1082       4109
  mega-image             6747      6747       814       5650
  carrefour              5205      5205       795       4157
  sezamo                 7518      7518       768       6479
  metro                  5377      5377       474       4703
  glovo-kaufland         2217      2217       304       1781
  glovo-profi            1112      1112       261        712
  kaufland                537       537       106        385
  glovo-penny             678       678        82        507
  dcneu                 10624     10624         0      10624   NO comparisons depend on it
  farmaciatei            2022      2022         0       2022   NO comparisons depend on it
```

**DCNeu is the lesson.** 10,624 offers, the largest single contribution of rows in the database,
and **not one product compares because of it**. Every one of its products is sold only there.
Offer count and usefulness are different quantities, and this table is why the brief was right to
ask for the second one.

## Comparability, both ways, as asked

```
                                    comparable        of     share
  DEFAULT (delivery platforms off)        2998     56351      5.3%
  TOGGLE ON (Glovo included)              3575     56351      6.3%

  the forty pinned staples                  23 of 40      57.5%   (was 21 of 40, 52.5%)
```

**With the toggle OFF — the default a shopper sees — Penny and Profi contribute nothing at all.**
Glovo prices carry a platform markup and are excluded from every user-facing surface. The 343
comparisons the two shops buy are only visible with the toggle on.

That is the number to decide with, and it is the whole decision: adding delivery-platform shops
raises comparability by **577 products (2,998 → 3,575, +19%)** *if* you are willing to show
marked-up delivery prices beside shelf prices. If you are not, these two scrapes bought
1,790 offers and zero visible comparisons.

### A caveat that makes the net numbers unattributable, stated rather than hidden

**A scheduled nightly ran during this session.** `ScraperRun` shows Auchan re-scraped at
01:04Z (5,611 offers) and Freshful at 01:08Z (3,156) — neither of which I started, between my
"before" and "after" measurements. Auchan's contribution moved 910 → 1,082 and Freshful's
in-stock count moved 3,093 → 819 in the same window.

So the session-level before/after (2,835 → 2,998) **cannot be attributed to Penny and Profi**,
and I am not going to present it as though it can. The per-merchant counterfactual above is
computed from a single snapshot and is unaffected — which is precisely why it is the figure
quoted.

## Match rate: low, and the reason is in the rule coverage

Penny wrote 678 offers of which **509 created new products** — roughly 25% matched something
already in the catalog. Profi: 1,112 offers, 652 new.

The rule coverage says why, and it is not the matcher misbehaving:

```
glovo-profi: 337,834 decisions
  size=246,095   size-unit=48,272   brand=37,578   mutually-distinct=3,973
```

**73% of all rejections are `size`, and another 14% are `size-unit`.** Glovo storefronts list
pack sizes the shelf catalog does not carry — different formats of the same goods. That is a
catalog-shape difference, not a matching failure, and it is consistent with Phase 2's finding
that the matcher is done.

1,017 Profi pairs and 413 Penny pairs landed in the review queue rather than being discarded.

---

## Selgros — reported, correctly not run

The brief asked four questions. All four were already answered by the 2026-09-08 re-diagnosis in
`docs/data-sources.md`, and re-reading it did not change any of them:

| question | answer |
|---|---|
| does a scraper exist? | yes — `npm run scrape:selgros`, through the shared adapter |
| does it work? | **no.** It pools **0** products and refuses to touch the database, which is the correct behaviour rather than the bug |
| was it ever run? | **never.** No `Merchant` row, no `ScraperRun`. It has contributed nothing, ever |
| what does it pool? | zero, for two specific reasons |

**Why zero, precisely** (`npm run probe:selgros`, the same headless engine the adapter uses):

- **The card selector is correct** — 48 `a.product-item[data-product-id]` on the home page,
  server-rendered. The old note claiming "renders client-side" was wrong.
- **Every name selector misses.** `.product-title`, `h3`, `[class*="title"]`, `.product-name`
  all return nothing, so all 48 cards are dropped for having no name.
- **The price is SPLIT ACROSS ELEMENTS.** `[class*="price"]` reads `per BUC. 39` for a product
  priced 39,99 — lei and bani in separate nodes. Wiring this up naively writes **39 lei instead
  of 39,99** on every row, which is a fabricated price and worse than no merchant at all.

**And the overlap argument cuts the other way.** The brief hoped Selgros would overlap Metro and
create comparisons. Metro is already here and the table above shows what cash & carry does:
5,377 offers, 474 comparisons, **4,703 products sold only there**. Selgros's home-page assortment
is catering packs — 750 g of shrimp, cases, carrying validity windows — which are not the packs a
household buys and mostly cannot join a retail comparison even once they parse.

**Verdict unchanged: excusing it remains correct.** The work is small; the payoff is doubtful,
and the failure mode of doing it carelessly is a fabricated price on every row.

---

## The ceiling, stated plainly

Two shops added, 1,790 offers written, and:

- **Default view: no change.** Delivery-platform prices are excluded.
- **Toggle on: +343 comparisons from these two**, 2,998 → 3,575 overall (+19%).
- **The forty staples: 21 → 23 of 40**, and even that cannot be cleanly attributed because the
  nightly moved Auchan and Freshful in the same window.

Against a catalog of 56,351 products, 3,575 comparable is **6.3%**. Adding every remaining Glovo
storefront — Carrefour, Mega Image, Freshful, Carrefour Supermarket — would duplicate merchants
already present at shelf prices, so it would add rows and few comparisons.

**The gain is small, and the brief asked me to say so plainly rather than report the offer
count.** 1,790 offers bought 343 comparisons, visible only if delivery prices are shown. The
constraint is not how many storefronts we scrape; it is that Romanian grocers stock overlapping
but non-identical assortments, and the shelf merchants that overlap most are already here.
