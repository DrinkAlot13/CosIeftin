# Carrefour's brand field is wrong, and the fix is on the detail page

**Ready to apply after the soak. Not applied — changing a scraper while the soak is measuring the
app is out of scope.**

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
