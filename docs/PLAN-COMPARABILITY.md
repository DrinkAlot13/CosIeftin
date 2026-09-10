# The comparability plan

Four phases. **Each one reports and stops.** Later sessions resume with "continue the plan" or
"do phase N".

---

## Why this plan exists

Comparability is ~2,900 of ~39,000 grocery products and a week of merchant work moved it barely
at all. The measurements say why:

- **Merchant overlap is the binding constraint.** The Phase 2 branded-gap measurement returned
  `ACCEPTS − SHOWN = 1`. The matcher is not the bottleneck; the catalogues genuinely do not
  overlap.
- **Merging is negative.** Loosening classes produced false equivalences, not comparisons.
- **An LLM reviewer tops out at ~3%.**

**And the original target was never achievable.** ~14,000 products sit in single-merchant sections
by design (`dcneu`, `cosmetice`, `farmacie` are coverage sections, not comparison sections), and
much of grocery is private label that exactly one shop sells. The honest ceiling for six grocers
is perhaps 5,000–8,000.

So the plan stops chasing the ratio: **make the tail useful, and let equivalence do what matching
cannot.**

### The baseline, measured 2026-09-10

| | |
|---|---|
| grocery products with a live offer | 32,148 |
| **strict comparable** (2+ merchants carry it) | **3,530** |
| **comparable-or-equivalent** (…or in a class resolving to 2+ merchants) | **4,599** |
| equivalence's current contribution | **+1,069** |
| classes today | 131 (128 non-empty, 116 resolving to 2+ merchants, 1,537 products assigned) |

`audit:comparability`'s shopper-facing figure — priced *today* at 2+ shops, grocery only — is
**2,896 (7.4%)**. The two differ because one counts stock-aside carriage and the other counts
what a shopper can compare right now. **Both are reported; neither replaces the other.**

---

## Phase 1 — Extend equivalence classes

The biggest unexploited lever: 131 classes already produce the largest single gain anything has
delivered (+1,069). Phase 5 of the original brief said "report what the next 30 would be" and
never ran.

**1a. Measure the opportunity.** Group live grocery products by head noun + size window across
merchants; rank by (distinct merchants × products); exclude anything an existing class already
covers; report the top 200 groups with members, merchants, size spread and prices.
**Report and stop — read before any class is written.**

**1b. Build in batches of 40, not 400.** Every class carries, without exception: require/exclude
tokens, an explicit size window (min and max, never a tolerance percentage), `anySize` only for
weight-sold goods and always with `maxUnitSize`, and per-canonical-unit pricing for weight-sold
classes.

A class may **not** merge: different fat content, different form (UHT vs fresh, făină 000 vs
650), BIO with conventional, different variety where it drives price, or non-interchangeable pack
shapes. **If a distinction is arguable, keep them apart** — a missing comparison costs nothing, a
false one costs trust.

**1c. Verify from outside, every batch.** `audit:private-label-classes`, importing only
`PrismaClient`. Print every class in full: members, merchants, prices, own sizes, unit prices.
Flag — never merge — unit-price spread over 2×, sizes outside the window, and classes resolving
to fewer than 2 merchants. Apply the peer-median limit: **report the group and the
discriminators, never name a culprit.**

**1d. Report.** Comparable, and comparable-or-equivalent, after each batch. **Never fold the
second into the first** — that would make the number rise by redefining the word. Project what
400 classes would plausibly reach based on the batches actually built, never from the first batch
alone.

## Phase 2 — Price history makes single-shop products useful

95,000 history rows, unused at product level. A product sold at one shop can still answer "is
this a good price?", which reframes ~26,000 dead products into ~26,000 with a price story.

On every product page, one shop or six: the 30/90-day low with its date; the current price
against it ("cu 12% peste minimul lunii trecute"); a sparkline; and "acum e un moment bun" only
where the data supports it, with the rule stated.

**Rules.** Never interpolate — a gap in history is drawn as a break. Only our own observations;
a retailer's claimed reference price is never mixed in unlabelled. Under 14 days of history says
so rather than showing a meaningless trend. Where we hold an Omnibus 30-day figure, show it
labelled as the retailer's own legally required figure — **but do not compute a discount claim
from it. That gate is still NO.**

Then a "preț bun acum" filter on category pages, and a report of how many products have enough
history to say anything, per section. History started 2026-08-06; if the answer is small, say so.

## Phase 3 — Reconsider the delivery-platform toggle

Kaufland, Penny and Profi via Glovo are ingested and hidden. Showing them is +577 comparisons
(~19%) for a config change. Median markup 11.6%; a quarter of the assortment matches shelf price
exactly.

Report the markup distribution per merchant and how many offers match shelf price exactly. Then
build the shippable version: platform prices **visible**, labelled "preț prin Glovo — include
adaosul platformei", **excluded** from "cel mai mic preț" and from cheapest-shop ranking,
**included** in the comparison table and merchant count as a distinct kind. Behind the flag
still. Report what the site looks like with it on, with screenshots.

**The decision to ship is the user's. Do not enable it.**

## Phase 4 — The basket is the product

Nobody wants to browse 29,000 products. At basket level comparability barely matters, because the
optimizer handles missing lines — a real basket total is a real answer even when half the items
are single-shop.

The homepage leads with a basket someone can fill in thirty seconds, pre-filled with common
staples, editable, answering immediately. The answer is the headline: *"coșul tău costă 312 lei
la Auchan, 340 la Mega"*. Comparability stops being the number on the page. Search stays
prominent; category browsing moves below.

Report screenshots at 1440 and 390. **This changes what the site IS**, so it is reviewed before
it stays.

---

## Standing rules

- **Report and stop at the end of each phase.** Never run phases back to back.
- **Never fold equivalence into the strict comparability count.**
- **Never loosen a rule, gate or threshold to make a number better.**
- **Verify by rendered output and database query, never from source.**
- Every batch of classes is printed in full to be read.
- Log everything in `docs/SOAK.md`; the soak is running, and the matcher rules, thresholds and
  merchant list are not to be touched.
