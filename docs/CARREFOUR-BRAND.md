# Carrefour's brand field is wrong, and the fix is on the detail page

**APPLIED 2026-09-10.** Step 1 (stop writing `data-brand`) and step 2 (void the wrong existing
values) are done and logged in `docs/SOAK.md`. Step 3, harvesting the real brand from the detail
page, is written but NOT run — see `docs/BRAND-BACKFILL-QUEUE.md`.

---

## 1. What `data-brand` actually contains

`scrape-carrefour.ts:85` reads `el.querySelector("[data-brand]")` from inside each product card.
The scoping is **correct** — it cannot reach a sibling tile, so this is not the neighbour
contamination that produced DCNeu's 5,969 fabricated prices. The attribute itself is not the
product's brand.

Carrefour's own product name carries the real brand while `data-brand` names a different one from
the same category:

```
claims "Carrefour Bio"    for  Lapte UHT Prodlacta 3.5% 1L
claims "Sim"              for  Lapte Uht Ladorna Zile Usoare 3.5% 1L
claims "Meggle"           for  Crema vegetala UHT Hulala fara zahar 500ML
claims "Dorna"            for  Apa Minerala Naturala Plata Aqua Carpatica 2L
claims "Dorna"            for  Apa Minerala Naturala Plata Borsec, 2L
claims "Dorna"            for  Apa Minerala Carbogazoasa Perla Harghitei 2L
claims "San Bernardo"     for  Apa Plata Zizin 2 L
claims "San Bernardo"     for  Apa Plata Aquatique 2L
```

**One wrong brand is assigned to several different products of the same category.** "Dorna" lands
on three competing waters; "San Bernardo" on two more. That is the signature of a value that
belongs to something else inside the card — a promoted-brand slot, a filter facet, a merchandising
tag — rather than a per-product attribute. `Carrefour Classic` and `Carrefour Bio` appearing on
third-party goods (Prodlacta, Tabasco) points the same way.

## 2. How wrong

| measurement | result |
|---|---|
| agreement with brands supplied independently by another merchant (2,446 compared) | **53.8%** |
| the same test on mega-image (2,500) | 98.8% |
| the same test on freshful (2,496) | 97.7% |

So it is Carrefour specifically, not a flaw in how we read brands generally.

## 3. The real brand IS published — on the detail page

`npm run probe:brand -- carrefour --n=25`. **25 of 25 detail pages publish a brand in JSON-LD
(`brand.name`), 100%.** And it is the right one. Where the detail page disagreed with what we
hold, the detail page's answer appears in the product's own name and ours does not:

```
Orez Jasmine Panzani 1kg            detail "Panzani"      listing said "Carrefour"     we hold "Panzani"
Cafea boabe Julius Meinl Trend      detail "Julius Meinl" listing said "Segafredo"     we hold "Julius Meinl"
Sos Tomi Fabulosul Burger 440g      detail "Tomi"         listing said "Heinz"         we hold "Tomi"
Frisca spray LaDorna 20% 250 g      detail "LaDorna"      listing said "Olympus"       we hold "Olympus"   ✗
Ceai de catina Celmar 20 plicuri    detail "Celmar"       listing said "Teekanne"      we hold "Teekanne"  ✗
Detergent lichid Perwoll Color 2L   detail "Perwoll"      listing said "Lex"           we hold "Lex"       ✗
Bautura necarbonatata Santal        detail "Santal"       listing said "Tymbark"       we hold "Tedi"      ✗
Pepsi Twist Zero Zahar              detail "Pepsi Twist"  listing said "Mirinda"       we hold "7Up"       ✗
```

**17 of 25 differed from the brand we hold, and in 16 of those the detail page's brand is in the
product's own name while ours is not.** The raw "32% agreement" number the probe prints is
therefore *not* the detail page being unreliable — it is a measure of how often what we hold is
wrong. Read the other way round, the detail page is right and our column is not.

Note the rows where `we hold` equals `listing said` — Olympus, Teekanne, Lex, Boromir, Maille,
Gullon. Those are the products where **Carrefour's listing was the source of our brand**, and they
are precisely the ones the detail page contradicts.

## 4. Blast radius

| | |
|---|---|
| Carrefour live grocery offers | 4,069 |
| products whose `Product.brand` equals Carrefour's listing value (Carrefour is the likely source) | **1,891** |
| of those, products matched to **2+ merchants** | **165** |

**165 is the number the fix buys**, and it is the honest one: those are live comparisons whose
match passed `decide()`'s brand gate using a brand that is about as likely to be wrong as right. A
wrong brand does not lose a comparison — it can manufacture one, which is the Zarea shape.

The other 1,726 carry a possibly-wrong brand that no comparison currently depends on. They still
degrade search ranking and class grouping, and they are a false match waiting for a second
merchant to stock the product.

**One caveat stated rather than buried**: "Product.brand equals Carrefour's listing value" is an
inference about provenance, not a record of it. We do not store which merchant supplied a brand.
Where two merchants agree, this attributes it to Carrefour wrongly. It is an upper bound on
Carrefour-sourced brands and therefore on the 165 too.

## 5. What to do, in preference order

1. **Stop trusting `data-brand`.** One line in `scrape-carrefour.ts`. A wrong brand in the gate is
   worse than no brand — Mega Image and Freshful show that 98% is achievable, and Carrefour's 54%
   is below the level at which the field carries information. This alone is a strict improvement
   and costs nothing.
2. **Read the brand from the detail page instead.** 100% availability, JSON-LD `brand.name`, and
   it agrees with the product name. Cost: **9.2 s/page**, so 4,069 offers ≈ **10.4 h** for a full
   pass, or a rotating slice nightly the way `probe:links` samples. This is the only route that
   both removes the wrong data and fills the column.
3. **Clear the 1,891 suspect brands when (1) lands**, since leaving them is leaving the defect.
   `backfill-brands.ts --clear` already demonstrates the provenance-marked pattern this needs.

## 6. Why nobody caught it

Brand pollution surfaces as **golden-set misses**, and those were read as matcher tuning. The
BASELINE.md entry for Phase 3 says it outright: *"2 are the brand-pollution data bug — Zarea wines
carry brand='Basilescu', 'Piper-Heidsieck', even 'Paw Patrol', so the brand gate correctly rejects
a match the data makes impossible. Fixing that is a data cleanup, not a matcher change."*

That was written about Zarea, filed as a data cleanup, and never traced back to which merchant was
producing the pollution. This is that merchant.


---

## 7. What was actually applied, and what it measured

**1. `scrape-carrefour.ts` passes `brand: ""`.** Not a change to how the page is read —
`data-brand` is still captured in `rawSourceBlob` — but a refusal to write a field measured at
53.8%. From 2026-09-10 Carrefour contributes no brands.

**2. 1,266 existing brands voided**, reversibly, out of the 1,891 Carrefour-sourced candidates.

The selection rule went wrong twice before it was right, and both times the DRY RUN caught it:

| attempt | rule | what it would have done |
|---|---|---|
| 1 | `Product.brand` == Carrefour's listing value | voided 1,827 — including `Olympus` on "Smantana de gatit **Olympus**" and `Borsec` on "Apa minerala **Borsec**". It identified rows Carrefour SOURCED, not rows Carrefour got WRONG, and Carrefour is right 54% of the time. **~1,000 correct brands destroyed to remove ~800 bad ones.** |
| 2 | …and the brand is absent from Carrefour's own name | voided 1,337 — still wrong: `Dr. Oetker` on "Cacao pudra **Dr.Oetker**". The brand's FIRST token is "dr", two characters, which failed the ≥3 guard, so every Dr. Oetker product was condemned by an abbreviation. |
| 3 | …using the brand's LONGEST token, plus corroboration from another merchant's payload | **1,266 voided, 625 spared.** |

What the final rule selects is unambiguous — **88 distinct brands smeared across 1,266 products,
about 14 products each, and only 8% appear on a single product**:

```
  48  Ariel            39  Carrefour Classic   37  Persil
  39  Bio All Green    31  Carrefour Bio       30  Tymbark
  25  Heinz            22  Molino Rossetto     19  Kaiser Franz Josef
```

"Kaiser Franz Josef" sat on 19 different oils — Costa d'Oro, Monini, Solaris, Mueloliva,
Calusar. That is a category slot, not a product attribute.

### What it bought

`audit:fanout` (worst group 7, grocery p95 2) and the golden set (95.0%, 1 false match) are
**unchanged, and neither could move**: the golden set carries literal names, and fan-out reads
existing offer→product assignments rather than recomputing them. Saying "no regression" from
either would be reporting a check that checked nothing.

The effect is latent, and measured by simulation instead. Of 200 sampled voided products, 114 had
a plausible partner elsewhere in the catalogue:

```
  would match a second merchant WITH the old brand:      0
  would match a second merchant WITHOUT it:             18
```

**Zero — the wrong brand was blocking completely.** Extrapolated, roughly **114 of the 1,266
become newly matchable** at the next re-match. Every example is a brand blocking a real product:

```
  was "Julius Meinl"      Cafea macinata Carrefour Columbia 250 G
  was "Olympus"           Smantana pentru gatit 10% Meggle 200ml
  was "Baneasa"           Spirale cu ou Monte Banato 400g
  was "Szatmari"          Fusilli Baneasa Premium, 400G
```

This answers the question about the 165 two-merchant matches directly, and the answer is better
than expected: **the tightened rule voided almost nothing that a live comparison depended on** —
1,265 of the 1,266 are single-merchant, and exactly 1 had a second merchant. The wrong brand is
*why* they were single-merchant. A separate simulation over the broader Carrefour-sourced set
found 165/165 matches hold without a brand and only 124/165 hold with it, all 41 flips in the
direction of the brand blocking a correct match — never manufacturing one.
