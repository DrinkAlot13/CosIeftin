# PROPOSALS — what to do next, ranked by value per hour of your attention

Written 2026-09-08, from the overnight session on `overnight/2026-09-08`. Every entry carries
the measurement that justifies it. Where the honest answer is "not worth doing", it says so.

**Ranking is by value per hour of YOUR attention, not per hour of mine.** A change I can make
unattended and verify from outside costs you a two-minute read; one that needs a judgement call
costs you far more, so it has to be worth more.

---

## 1. Stop DELIVERY_PLATFORM prices reaching the basket optimizer — 30 minutes, high value

**The measurement.** `currentOfferWhere()` in `lib/queries.ts` carries this comment:

> DELIVERY_PLATFORM prices carry a platform markup and are OFF by default everywhere —
> **optimizer**, item pages, deals, counts, search, comparability.

It is not true of the optimizer. Neither `src/app/api/basket/v2/route.ts` nor
`src/lib/substitution/load.ts` filters `priceSource`. Running a real 20-staple basket
(`npm run audit:real-basket`) puts **Kaufland (Glovo) in the shop list at 60,98 lei** with 2
exact and 2 substituted lines. The v2 route also omits `merchant: { active: true }`, which
`load.ts` does apply — so the two loaders disagree about which shops exist.

**Why it matters more than the four lines suggest.** A Glovo price is a marked-up price. Every
other surface excludes it precisely so a comparison is like-for-like; the one surface that
tells a shopper *where to go and what it will cost* does not. The markup audit
(`audit:markup`) exists because that gap is real money.

**Not done unattended** because it changes what the optimizer returns, and the brief reserved
that. It is two `where` clauses.

---

## 2. Populate `ProductAttribute.isPrivateLabel` — 1 hour, high value, no risk

**The measurement.** The table is **completely empty** — 0 rows, no keys of any kind. Yet
`substitution/load.ts` reads it to set `isPrivateLabel`, and `substitution/pick.ts` and
`resolve.ts` both branch on `ctx.preferPrivateLabel`. **That preference has never done
anything**; it has been reading a hardcoded `false` for every product since it was written.
`basket/v2/route.ts` is honest about it — `isPrivateLabel: false` with the comment "private
label is inferred until ProductAttribute is populated".

**The work is already done.** `audit:private-label` identifies 3,859 live private-label
products by brand, across 27 brands, with the per-brand and per-merchant breakdown. Writing
those as attributes turns a dead preference into a live one.

**Caveat worth stating:** the brand list is a declaration, not an observation, and 13 of the 27
brands are ones I nominated from the data rather than ones you listed. Set `source:
"name-parse"` and `confidence` accordingly so a later feed can overwrite them.

---

## 3. Retire `Offer.bulkTiers` (the JSON column) — 2 hours, high value

**The measurement.** Two copies of one fact, and they do not agree:

    offers carrying the JSON column     463
    BulkTier rows                    12,745  across 7,826 offers
    offers where BOTH exist             274
    of those, the two copies AGREE        0
    offers with JSON and no table rows  189

    offer 26486:  json  1@1255, 4@840        table  3@1290

The JSON holds `1@…` rungs — a quantity-1 "tier", which is the base price wearing a discount's
clothes and exactly what `validateTiers` refuses. **Until tonight the optimizer parsed the JSON
with no validation at all** while the item page ran the gate. Both readers now validate, so the
bleeding has stopped, but the column is still there and still disagrees.

**Why it is not simply a `DROP COLUMN`.** 189 offers have JSON and no table rows. Per
CLAUDE.md's migration rule the sequence is add → backfill → verify → switch reads → drop:
validate those 189 into `BulkTier`, confirm the count, then drop. The 274 disagreeing ones need
a decision first — see decision 3 in the morning report.

---

## 4. Harvest EANs from Farmacia Tei — 2 hours, medium value, and NOT for grocery

**The measurement** (`npm run probe:ean`): Farmacia Tei publishes `gtin13` in JSON-LD on every
product page — **4 of 4 sampled** — and currently has **0 EANs on 2,898 offers**. One field,
one page per product, a scraper that already visits those pages.

**Be clear about what it does not do.** It will not move grocery comparability by one product.
An EAN helps only when a SECOND shop can be matched to a FIRST by it, and no second grocery
merchant publishes one: Mega Image, Carrefour, Freshful, Metro, DCNeu and Penny have nothing in
JSON-LD, meta, a spec row, or any embedded payload. Auchan does, and is already at 98%. So this
is a `farmacie`-section improvement and should be judged as one.

---

## 5. The 20-staple basket cannot be filled by ANY shop — the biggest product problem here

**The measurement** (`npm run audit:real-basket`, 20 real staples, EQUIVALENT mode):

    Sezamo      8 exact ·  6 substituted ·  6 missing
    Freshful    6 · 7 · 7        Mega Image  4 · 9 · 7
    Metro       4 · 7 · 9        Carrefour   1 · 5 · 14
    Auchan      3 · 7 · 10       Penny       0 · 0 · 20

    BEST SINGLE SHOP: none could fill the basket.

**The diagnosis, and it is not what it looks like.** These 20 slugs are the v1 Index basket's
PINNED products, and most of them carry no `equivalenceClassId` — so `EQUIVALENT` mode has
nothing to substitute with and degrades to `EXACT`. The class-based Index basket, over
comparable lines, reports Sezamo 30/40 and Mega Image 33/40. **Same catalog, very different
answer, because one resolves through classes and the other through pinned product ids.**

This is the single largest gap between what the site can do and what it does. It is a design
question rather than a bug, which is why it is a proposal: should `/lista` resolve through
classes the way the Index basket already does?

---

## 6. Six equivalence classes hold nothing — 30 minutes, medium value

`banane-bio-kg`, `mere-rosii-kg`, `nectarine-kg`, `cirese-kg`, `mandarine-kg`,
`cartofi-noi-kg`. An empty class is not harmless: the basket reports its line as "no shop can
fill it", which reads as a catalog gap when it may be a rule matching nothing. Each needs one
look at `npm run explore:head -- <noun>` to say which it is. Some are genuinely seasonal
(cherries in September), and *that* is a fine answer — but it should be recorded rather than
inferred.

---

## 7. 209 offers are missing a deep link their source publishes — 1 hour, medium value

Now separable for the first time, because `lib/source-capabilities.ts` declares which sources
have deep links at all:

    sezamo 83 · carrefour 38 · metro 36 · mega-image 34 · freshful 14 · auchan 4
    (kaufland 655 and glovo-kaufland 2,615 are EXPECTED nulls, correctly)

Small, and each is a shopper who cannot reach the price we quoted.

---

## 8. `iaurt-natural-400g` merges 3% and 5% fat — 15 minutes, and it is live now

Found by running the real basket: a request for *Iaurt natural Laptaria cu caimac, 5% grăsime,
300 g* resolved to *Iaurt natural 3% grăsime 400g*. The class rule is `require: ["natural"]`
with no fat discriminator, and the ±26% size tolerance admits a 300 g pack into a 400 g class.

**This is exactly what the classes brief forbids** — different fat content, and a pack-size
tolerance hiding what it admits. It predates tonight's work. The 30 new classes all carry an
explicit window instead, which is the fix pattern to copy.

---

## 9. Two products' stored size disagrees with their own name — 15 minutes, low value

Out of 29,203 live grocery products, exactly two (`npm run audit:assumptions`):

    3.0x  stored 0.25 l   name says 0.75 l   Pachet apa de gura Colgate Plax Cool Mint, 500…
    1.2x  stored 0.3 kg   name says 0.25 kg  Rosii cherry Trimix, la caserola, 250 g

The first is a multipack whose total was not summed. Worth fixing for correctness; worth
knowing the rate is **0.01%**, which is the real finding.

---

## 10. Selgros — NOT worth doing, and here is the evidence

Re-diagnosed tonight (`npm run probe:selgros`). The old note in `docs/data-sources.md` said the
listing renders client-side; that is wrong — headless Chromium finds 48
`a.product-item[data-product-id]` cards on the home page and curl sees 24 in the raw HTML.

What actually fails: **every name selector misses**, so all 48 cards are dropped for having no
name (hence a pool of zero); and **the price is split across nodes**, so `[class*="price"]`
reads `39` for a product priced 39,99. Wiring it up naively fabricates prices.

It has never run — no `Merchant` row, no `ScraperRun`. And Selgros is cash & carry: the
assortment is catering packs (750 g shrimp, cases) with a validity window, which is not the
pack a household buys. Metro already shows what that looks like — 1,626 own-brand products,
every one single-shop.

**Recommendation: leave it excused.** An hour of work for an assortment that mostly cannot join
a retail comparison.

---

## 11. Glovo Lidl / Penny / Profi — blocked, and one of the three does not exist

For the record, since it was asked earlier: **Lidl is not on Glovo Bucharest.** Six slug
variants all return "Această pagină nu există" and it appears on no listing page. **Profi does
exist** (`profi-buc`, 117 tiles, not in config) and Penny is already a disabled config row.
robots.txt is byte-identical to the 2026-09-02 record.

Two considerations against, both worth saying plainly:

1. These arrive as `DELIVERY_PLATFORM` and are excluded by default everywhere, so they raise
   comparability **only if shown** — and showing marked-up prices beside shelf prices is the
   thing the exclusion exists to prevent.
2. Proposal 1 above says the optimizer is currently leaking platform prices anyway. Adding two
   more platform storefronts before fixing that makes the leak bigger.

**Recommendation: fix 1 first, then decide.** The overnight brief forbids adding merchants, so
nothing was done.

---

## 12. Carrefour collapses on a second run — 1 hour, and it is silently costing 2,800 offers

**The measurement** (found by `audit:db`'s collapse invariant, 2026-09-08):

    2026-09-08 06:55   written  1197   pool  1209    <- collapse
    2026-09-08 05:14   written  4014   pool  3944    <- healthy, 100 minutes earlier
    2026-09-07 20:59   written  4083   pool  4035
    2026-09-07 01:58   written  1201   pool  1213    <- same collapse, previous day

A second Carrefour run shortly after a good one discovers ~1,200 products instead of ~4,000 and
writes them without aborting. **The <60% abort guard cannot catch it**, because the write rate is
fine — 1,197 of 1,209 pooled. What collapsed is DISCOVERY, upstream of everything the guard
watches. Rate limiting, a session expiring, or a category list that renders short on a warm
cache are all candidates; none is established.

It leaves Carrefour holding roughly a quarter of its catalog until the next good run, which
directly suppresses comparability — Carrefour is one of the six merchants that can pair with
another on a private-label class.

**Worth adding an invariant for the shape**, not just this instance: a run whose POOL is under
60% of that merchant's recent best pool should abort the same way a run whose WRITES collapse
does. The existing guard watches the wrong end of the pipe.
