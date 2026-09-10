# The brand gap — measured, and it is not the lever

`npm run audit:brand-gap`, 2026-09-10. Read-only.

**Verdict: the brand backfill was built, run, caught wrong by its own audit, and rolled back. It
is not shipped. Coverage stays at 64.7%.** The valuable output of this phase is a live data
defect it found on the way: **Carrefour's brand field is wrong about 46% of the time.**

---

## 1. Where the gap is

| | |
|---|---|
| live grocery products | 32,001 |
| carrying a brand | 20,689 (64.7%) |
| **missing a brand** | **11,312 (35.3%)** |

It is not spread evenly, and it is not produce:

| merchant | live grocery offers | with a brand |
|---|---|---|
| sezamo | 8,169 | **11.8%** |
| mega-image | 6,707 | 98.3% |
| metro | 5,433 | 98.8% |
| auchan | 4,630 | 96.5% |
| carrefour | 4,075 | 91.4% |
| freshful | 3,153 | 95.4% |
| glovo-kaufland | 2,253 | **12.2%** |
| glovo-profi | 1,116 | **28.0%** |
| glovo-penny | 676 | **19.5%** |
| kaufland | 265 | **14.0%** |

Sezamo and the Glovo storefronts are essentially the whole gap. And the missing products are
plainly branded — *Zott Liegeois cacao 175 g*, *Bonduelle Miniconserva Naut*, *Panzani Orez natur
500 g*. The brand is in the name, at the front.

## 2. Three routes, and why none of them shipped

### Route 2 — the naming convention. Graded 99.3%, and still unsafe.

Sezamo and Glovo lead their product names with the brand. That was measured with a real oracle:
take offers from that merchant whose product's brand was supplied **independently by a different
merchant**, and check whether the leading token predicts it.

| merchant | graded | leads with the brand |
|---|---|---|
| sezamo | 967 | **99.3%** |
| glovo-kaufland | 274 | 95.3% |
| glovo-penny | 132 | 97.7% |
| glovo-profi | 312 | 59.3% |

Three variants were built and graded. Every one scored ≥99% and every one wrote nonsense onto the
population that actually needs it:

```
raw lead token          → andive, gulii, apio, capsune          (produce)
∩ brand vocabulary      → chivas   ← "Chivas proaspat legatura" is CHIVES; the token is in the
                                     vocabulary because Chivas Regal exists
                        → cookie   ← "Cookie cu cacao 85 g" is a product word
+ contradiction guard   → strips bonduelle, panzani, chivas (real brands) and KEEPS cookie
```

**The reason is structural, and it is the third time this session it has appeared.** A rule can
only be graded where the answer is already known, and where the answer is already known is
exactly where the rule is easy. Sezamo's graded overlap is mainstream branded goods; Sezamo's
*gap* is produce and private label. Same trap as `audit:off-hitrate`'s route 2 and the EAN
sample.

`Product.brand` feeds `decide()`'s brand gate, and CLAUDE.md's Zarea regression is one loose brand
backing 64 unrelated wines. A wrong brand does not cost a comparison — it manufactures one. Not
taken.

### Route 3 — the brand vocabulary. Rejected on sight.

`catalogBrands` is built for search REQUIRE, where a false positive costs a filtered result. Its
1,629 tokens include `verde`, `bucata`, `romania`, `gradina`. Fit for its purpose, unfit for
writing a brand column.

### Route 1 — the merchant's own stored payload. Built, run, rolled back.

414 products where `Offer.rawSourceBlob` carried a brand. Written, then verified by
`audit:brands`, which imports only `PrismaClient` and shares no code with the backfill.

**It failed: 75.8% of the assignments named a brand appearing in no name we hold.**

```
Pirifan   ← Dr.Oetker Vitalis Gustare de ovaz clasic 50 g
Barilla   ← Tabasco Sos habanero 60 ml
Mogyi     ← Old El Paso Dip chunky salsa 312 g
Sim       ← Alpro Bautura soia cu aroma de vanilie 1 l
Bear      ← Baton cu cereale, Nestle Maxi Choco 25g
```

Rolled back with `backfill:brands --clear --write`, which removed exactly the 414 rows it wrote
and nothing else. **CLAUDE.md's rule that an assigner must be able to unassign is why that was a
two-minute fix rather than an incident.**

## 3. The finding that made this phase worth running

Diagnosing the failure led to Carrefour, which supplied 283 of the 414 bad assignments.

**Carrefour's own brand field agrees with independently-supplied brand data 53.8% of the time.**

| merchant | compared | agree | rate |
|---|---|---|---|
| mega-image | 2,500 | 2,471 | **98.8%** |
| freshful | 2,496 | 2,438 | **97.7%** |
| **carrefour** | 2,446 | 1,317 | **53.8%** |

The disagreements are systematic, not noisy:

```
carrefour says "Bilbor"           we hold "Borsec"           Apa plata Borsec, 2 l
carrefour says "Bilbor"           we hold "Aqua Carpatica"   Apa plata Aqua Carpatica, 2 l
carrefour says "Perla Harghitei"  we hold "Zizin"            Apa plata Zizin, 2 l
carrefour says "Carrefour Bio"    we hold "Prodlacta"        Lapte UHT integral Prodlacta 3.5%
carrefour says "Barilla"          we hold "Tabasco"          Sos habanero Tabasco 60ml
```

Every one of those waters is a different bottled-water brand, and Barilla sits beside Tabasco in a
sauces aisle. The extraction in `scrape-carrefour.ts:85` is correctly scoped to the product card
(`el.querySelector("[data-brand]")`), so this is **not** a neighbour-contamination bug of the
DCNeu shape. Carrefour's own `data-brand` attribute simply is not the product's brand — the
values `Carrefour Classic` and `Carrefour Bio` on third-party products suggest an own-brand or
merchandising tag.

**This affects live data, not just the backfill.** Carrefour has 4,075 live grocery offers at
91.4% brand coverage, and wherever Carrefour was the source of a product's brand, that brand is
about as likely to be wrong as right. It feeds the matcher's brand gate today.

**Not fixed here** — it is a scraper change during a soak, and the brief forbids touching the
matcher and merchant inputs. Written down as the first thing to fix after.

## 4. What the answer to the original question is

**Brand coverage is not the bigger lever.** The safe ceiling is:

| route | products | coverage becomes | shipped? |
|---|---|---|---|
| stored payload, all merchants | 414 | 66.0% | **no — 75.8% wrong** |
| stored payload, mega-image + freshful only | ~97 | 65.0% | no — +0.3 points is not worth the risk |
| naming convention | ~1,589 | 69.7% | **no — writes `cookie`, `chivas`** |
| vocabulary | ~1,502 | — | no |

Against Phase 1b's ~400 products, the best *safe* brand route is ~97. **The premise that brand
coverage would be a larger lever than classes does not survive measurement.**

The projected downstream effects, which is what the brief asked for:

- **Golden set** — unchanged, and it *cannot* change: its 240 pairs carry literal names and brands
  in the test file, so no database write can move them. Saying "no regression" from it would be
  reporting a check that checked nothing. The instrument that can see this is `audit:fanout`
  (baseline: worst group 7, grocery p95 = 2, both within target), and it was run before the
  backfill and is unchanged after the rollback.
- **Class shortlist** — would have improved, but only for the ~400 Sezamo products a safe route
  reaches. The 334 brand-keyed groups are mostly Sezamo, and a safe route does not reach them.
- **ProductAttribute** — the provenance mechanism works and is now proven; `key="brand"`,
  `source="merchant-feed"` made the rollback exact.
- **Search ranking** — no change, since nothing shipped.

## 5. What is worth doing instead

1. **Fix Carrefour's brand extraction.** It is wrong about 46% of the time on 4,075 live offers,
   and it is corrupting the matcher's brand gate right now. Highest value, and it is a real bug
   rather than an enhancement.
2. **Ask Sezamo's detail pages for a brand.** Sezamo is 7,201 of the gap and its listing payload
   carries none. `probe:ean` established its detail pages are reachable. Nobody has looked for a
   brand there. That would be *truth* rather than inference, and it is the only route that could
   close the gap honestly.
3. Leave the vocabulary and naming-convention routes unbuilt.
