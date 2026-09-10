# Phase 1a — where the next equivalence classes would pay

`npm run propose:class-opportunities`, 2026-09-10. Read-only; it writes nothing and assigns
nothing. Full output (all 200 groups with every member, shop, size and unit price) is in
**`reports/phase1a-class-opportunities.txt`** — 4,134 lines, which is the artefact to read before
Phase 1b.

**Headline: the opportunity is real but far smaller and more specific than "the next 200
classes". The top of the ranking the brief specified is unusable, for two measurable reasons, and
what survives is ~60 groups worth ~450 products.**

---

## 1. The baseline this has to beat

| | |
|---|---|
| live grocery products | 32,001 |
| strict comparable (2+ merchants carry it) | 3,530 |
| comparable-or-equivalent | 4,599 |
| **equivalence's current contribution** | **+1,069** from 131 classes |

131 classes, 128 non-empty, 116 resolving to 2+ merchants, 1,537 products assigned.

## 2. What the grouping found

- 32,001 live grocery products, **3,733 not bucketable** (no unit, no size, or no usable head
  noun) and therefore invisible to this method.
- **1,833 candidate groups** — 2+ products, 2+ merchants, not already majority-covered by a class.
- Products in all 1,833 groups: **16,586**. That is the absolute ceiling and it is not a forecast.

## 3. Why the ranking the brief specified surfaces the *least* usable groups first

Ranking by (distinct merchants × products) puts the most numerous head nouns on top, and the most
numerous head nouns are the most generic. The top ten:

| # | head noun | size | products | shops | unit-price spread |
|---|---|---|---|---|---|
| 1 | ciocolata | 0.1kg | 164 | 9 | 8.0× |
| 2 | apa | 0.5l | 138 | 9 | **77.1×** |
| 3 | bautura | 0.5l | 158 | 7 | 24.6× |
| 4 | bautura | 1l | 116 | 9 | 18.7× |
| 5 | vin | 0.75l | 181 | 5 | 27.3× |
| 6 | bautura | 0.33l | 139 | 6 | 6.0× |
| 7 | bautura | 1.5l | 151 | 5 | 6.0× |
| 8 | lapte | 1l | 76 | 9 | 8.7× |
| 9 | baton | 0.05kg | 97 | 7 | 7.4× |
| 13 | **set** | 1buc | 81 | 7 | **102.6×** |

**None of these can become a class.** "bautura 0.5l" is a category, not a need someone
substitutes within; "set 1buc" at 102× spread is a bag of unrelated objects. The high score is
caused by the same genericity that disqualifies them.

### The worked example that shows why a person must read every group

Group `lapte · 0.5l`, 14 products across 7 shops, spread 13.1×:

```
Lapte pentru cafea Zuzu Barista, 3.5% grasime, 450 ml    6.59   14.64/l
VASELINE Lapte de Corp Cacao 600 ml                     21.07   35.12/l
VASELINE Lapte de Corp Hydrating 600 ml                 21.07   35.12/l
Lapte 3.5% grasime 500ml                                 6.79   13.58/l
Lapte 1.5% grasime 500ml                                 6.09   12.18/l
```

**Drinking milk and body lotion in one group.** `lapte` is genuinely ambiguous in Romanian —
*lapte de consum* and *lapte de corp* share the head noun — and no amount of size bucketing
separates them. A class built from this group without reading it would offer body lotion as a
substitute for milk. It is also the exact shape CLAUDE.md warns about: the 13.1× spread flags the
*group*, and naming any single row as the culprit would encode an answer the method cannot supply.

## 4. The second contamination: 334 groups are keyed by a brand

`headNoun` is brand-aware and correct — given `brand="Palmolive"` it returns `gel`, not
`palmolive`. **But it can only skip a brand it is told about, and 39.6% of live grocery products
(10,734) carry no `brand` field at all.** Sezamo and the Glovo storefronts largely do not populate
one. For those products the leading token *is* the brand, so the group becomes "every Alpro 1 l
product" rather than "every plant drink 1 l":

```
[153] alpro · 1l · 20 products across 5 shops
      Alpro Bautura din cocos neindulcita 1 l      16.69
      Alpro Bautura din soia Original 1 l          13.99
      Alpro Bautura din ovaz neindulcita 1 l       16.75
      Alpro Matcha 1 l                             21.79
```

Five shops, tight spread, high score — and it is a **brand family**, which CLAUDE.md names as
precisely what a class must not be (one Nivea shower gel once backed 17 products across three
merchants). Worse, these score *well* because a widely-stocked brand spans many shops, so they
float to the top of the list a person is meant to read first.

**334 of 1,833 groups are brand-keyed.** They are now detected and excluded from the shortlist,
using a brand vocabulary derived from the products that *do* declare one — not a hand-written
list, which would be a second implementation of "what is a brand".

**That detection is incomplete, and the report says so.** A brand no merchant ever puts in the
`brand` field cannot be in the derived set, so `aloma`, `siviero`, `lay`, `alce`, `forest`,
`strada`, `vel` and `kit` still appear in the shortlist below and are brands, not nouns. They are
left visible rather than hand-removed, because a hand-removal list is the thing that goes stale.

## 5. The shortlist — what could plausibly become a class

Three mechanical filters, none of them a verdict: unit-price spread < 2× (CLAUDE.md's own flag
bar), head noun spanning ≤ 3 size buckets (a noun at every size is a category word), and the head
noun not itself a known brand.

**60 of 1,833 groups survive, holding 452 products. 43 of those span 3+ shops (300 products).**

| head noun | size | products | shops | spread |
|---|---|---|---|---|
| fixativ | 0.25l | 21 | 4 | 1.53× |
| humus | 0.2kg | 18 | 3 | 1.84× |
| smoothie | 0.25l | 12 | 3 | 1.46× |
| cozonac | 0.4kg | 10 | 6 | 1.54× |
| cidru | 0.33l | 10 | 3 | 1.65× |
| strudel | 0.1kg | 10 | 3 | 1.36× |
| nuci | 0.1kg | 8 | 4 | 1.87× |
| lipie | 0.5kg | 7 | 5 | 1.85× |
| busuioc | 1buc | 7 | 3 | 1.53× |
| creveti | 0.2kg | 7 | 3 | 1.72× |
| cartofiori | 0.75kg | 7 | 3 | 1.39× |
| mere | 4buc | 6 | 3 | 1.70× |
| zmeura | 0.1kg | 5 | 4 | 1.50× |
| afine | 0.1kg | 5 | 4 | 1.85× |
| bors | 1l | 5 | 4 | 1.55× |
| vinete | 1buc | 5 | 4 | 1.60× |
| tofu | 0.3kg | 5 | 4 | 1.21× |
| fixativ | 0.33l | 5 | 4 | 1.23× |

`produs`, `margele`, `pernite`, `suport` and `ice` are in the surviving list and are junk head
nouns; `aloma`, `vel`, `kit`, `lay`, `alce`, `forest`, `strada`, `siviero`, `guseppe`, `lido` are
undetected brands. **Roughly a third of the shortlist is noise**, which is worth stating plainly
before anyone treats 60 as a work queue.

The pattern in what *is* real: **produce, bakery and a few specific prepared categories** — the
same shape as the existing produce classes. Not the large branded aisles, because those are
either already classed or genuinely different products.

## 6. What this says about the size of the prize

Three numbers, and only the first is safe:

| | products | what it is |
|---|---|---|
| all 1,833 candidate groups | 16,586 | an absolute ceiling, mostly unusable |
| top 200 groups | 8,090 | dominated by generic nouns and brand families |
| **60 plausible groups** | **452** | the honest shortlist, ~⅓ of it noise |

**So a realistic Phase 1b batch of 40 classes is drawing from perhaps 300–450 products, not
thousands** — and every real class rejects members the grouping accepts (different fat content,
UHT vs fresh, BIO vs conventional, făină 000 vs 650, all forbidden merges). If the survival rate
resembles the existing classes' — 1,537 products across 131 classes, ~12 each — then **40 new
classes plausibly reach 300–500 additional products**, moving comparable-or-equivalent from 4,599
to roughly **4,900–5,100**.

**That is a real gain and it is not a large one.** It does not change the shape of the problem the
plan opens with: merchant overlap is the binding constraint, and equivalence widens the tail
rather than closing the gap. The projection above is deliberately made from the *shortlist*, not
from the first batch — but it remains a projection, and Phase 1b batch 1 is what would test it.

## 7. Recommendation before Phase 1b

Two things are worth deciding first, because both change what batch 1 should contain:

1. **The 3,733 unbucketable products** (12% of live grocery) are invisible to this whole method
   for want of a unit, a size or a head noun. That may be a larger and cheaper win than 40 new
   classes, and it has not been measured.
2. **The missing `brand` field on 39.6% of live grocery products** degrades this grouping, and it
   is plausibly degrading the matcher too — CLAUDE.md already records brand pollution causing
   golden-set misses. Worth measuring separately.

Neither is in the plan as written. **Phase 1b as briefed is still viable** — the shortlist is
genuine — but it is a ~400-product lever, and these two may be bigger.

---

**Phase 1a is complete. Nothing has been written to the catalog and no class has been created.**
Per the brief, this stops here to be read before Phase 1b begins.
