# EAN coverage — the ceiling, measured before anything is built

`npm run probe:ean`, 2026-09-10. 45 real product detail pages across 12 merchants, sampled
**only from products we have no EAN for**, every candidate validated with `parseEan()`.

**The answer is that there is no ceiling to raise. 19.0% is the whole of it, and it is one
merchant.**

---

## 1. The finding that settles it

Every EAN we hold comes from Auchan. Not "mostly" — measured:

```
grocery products (live) with an EAN:            6,269
  ...of which also have an AUCHAN offer:        6,269 = 100.0%
  ...with NO Auchan offer:                          0
```

**Zero.** Our 19.0% coverage is not a blend of sources that could be topped up; it is Auchan's
catalogue, exactly. Every per-merchant percentage in the table below is therefore an artefact of
how much that merchant's catalogue overlaps Auchan's — Glovo-Profi's 21.3% is not Glovo
publishing barcodes, it is Glovo selling things Auchan also sells.

## 2. Per merchant — obtainable, by what mechanism, at what cost

| merchant | live grocery | missing an EAN | sampled | yielded one | mechanism | s/page | full harvest |
|---|---|---|---|---|---|---|---|
| **auchan** | 5,606 | 265 | 5 | **4/5** | embedded JSON | 5.6 | 0.4 h |
| sezamo | 8,169 | 7,589 | 6 | **0/6** | — | 4.5 | 9.5 h |
| mega-image | 6,881 | 6,216 | 6 | **0/6** | — | 4.3 | 7.5 h |
| metro | 5,433 | 5,008 | 6 | **0/6** | — | 3.7 | 5.2 h |
| carrefour | 4,075 | 3,413 | 6 | **0/6** | — | 5.2 | 5.0 h |
| freshful | 3,153 | 2,867 | 6 | **0/6** | — | 3.8 | 3.0 h |
| penny | 27 | 27 | 5 | **0/5** | — | 3.9 | <0.1 h |
| selgros | 25 | 24 | 5 | **0/5** | — | 3.8 | <0.1 h |
| kaufland | 265 | 239 | — | — | **no product page** | — | unreachable |
| glovo-kaufland | 2,253 | 2,063 | — | — | **no product page** | — | unreachable |
| glovo-profi | 1,116 | 878 | — | — | **no product page** | — | unreachable |
| glovo-penny | 676 | 571 | — | — | **no product page** | — | unreachable |

**0 of 40 non-Auchan pages published a checksum-valid EAN.** Not in JSON-LD, not in a meta tag,
not in a labelled spec row, not in an embedded JSON payload. No page even carried an EAN-ish
*label* with an unusable number behind it — the category simply is not published.

Four merchants (Kaufland's flyer, the three Glovo storefronts) have **3,751 missing EANs that
cannot be reached at all**, because they publish no per-product page. That is a declared source
capability, not a gap we could close by trying harder.

### What harvesting everything would buy

Every probeable page, at the measured seconds-per-page: **~30 hours of fetching**, to gain
**265 EANs**, all of them Auchan's. Coverage would move **19.0% → 19.8%**. The scanner number
from `docs/NATIVE.md` is unchanged at one identification in five.

## 3. Why the earlier answer looked the same and was a different answer

`docs/data-sources.md` recorded this on 2026-09-08 and concluded *"the answer to what would
comparable products become: nothing"*, because an EAN raises comparability only when a **second**
shop can be joined to a first by it. That was right, and it answered the **join** question —
which is what `audit:ean` measures.

The **identification** question is different: a scanner asks "which product am I holding", and
one merchant's EAN answers it completely. For that use, an EAN from a single shop is worth
exactly as much as one from two. So the same pages were re-read against the different question.

**The re-read agrees, for a reason the first run could not have established**: not "no second
merchant publishes one", but **no other merchant publishes one at all.**

## 4. The instrument had to be fixed before its number could be trusted

The 2026-09-08 probe had five defects, each of which moves the ceiling in the flattering
direction. Fixed in this run, and listed because the old numbers are in `data-sources.md`:

1. **It did not validate the checksum.** It accepted any `\d{8,14}` near an EAN-ish label, while
   `parseEan()` — written because "an unchecked barcode is worse than none" — sat unused two
   directories away. A weight or an order code would have counted as a find.
2. **It sampled products that already had an EAN**, so on Auchan (95%) it mostly re-found what we
   already store. The sample is now drawn only from `ean: null` — the actual question.
3. **`take: n` with no ordering** took the first rows by insertion, which cluster by scrape batch.
4. **It did not check `robots.txt`**, unlike `probe:extension-ids`.
5. **It did not measure cost**, which is half of an actionable answer.

It also reported Glovo and Kaufland as *"no live grocery offer is missing an EAN"* when the truth
is that all 3,751 of their gaps have no page to visit — the CLAUDE.md rule about distinguishing
"the source has none" from "we lost them", inverted into a clean bill of health.

**Sezamo was never measured at all in that run**: every sampled URL 404'd, which is the link bug
fixed in `b590c6b`. It is our largest merchant, and this is its first real reading — 0/6.

## 5. Verdict

**Do not build a harvester.** There is nothing to harvest. The 265 Auchan gaps are real but
rounding error, and the other eleven merchants publish no barcode on any surface we can read.

This closes the follow-up `docs/NATIVE.md` left open. Raising our own EAN coverage was the right
*shape* of answer — a scraping target with an exact result rather than a probabilistic one — and
the measurement says the target does not exist. Scanning stays dead on both routes.
