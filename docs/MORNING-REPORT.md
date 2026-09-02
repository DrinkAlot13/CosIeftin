# Morning report

**Phases done: 1–9 (all but 10, which is this).**
**Tests: 742 passing. Build: clean.**
**verify:site: NOT GREEN — 5 audit-db invariants fail, itemised in §2. None is a wrong price on a page.**
**Comparability: 14.6% raw · 6.7% excluding stale · 5.8% excluding stale and out of stock.**
**Blockers: Kaufland aborted twice and is serving last week's flyer. DCNeu needs a re-scrape — we were reading half its shop.**

---

## 1. Phases

| | phase | outcome |
|---|---|---|
| 1 | full re-scrape | done, 12 attempted, **Kaufland failed twice** |
| 2 | Pepsi product | **PASSES** — one row, one shop, right product |
| 3 | 81 spread products | 81 → 60 → **1** |
| 4 | misleading strikethrough | done, verified on 5 rendered pages |
| 5 | SGR deposit | done — schema, write path, item page, basket |
| 6 | out-of-stock sweep | done, 10 surfaces |
| 7 | 21 smeared ladders | **0 remain** — and found DCNeu was scraping half its shop |
| 8 | methodology page | done, `/metodologie` |
| 9 | verify and measure | done, not green |
| 10 | this report | done |

Phases 4, 6 and 8 were done out of order, during the hour DCNeu's detail pass was running.
Phases 2 and 3 are reports against fresh data and could not start until it landed.

---

## 2. verify:site — exactly what fails

`audit:displayed` is **8/8**. `audit-db` is **23/28**. The five:

**a. `no active merchant has 2 consecutive runs that produced nothing` — 2**
Real, and the most important line in this report. See §5 decision 2.

**b. `no day moves >50% on more than 5% of the offers written that day` — 2**
30 August (already diagnosed as a legitimate re-scrape) and **today**. A full re-scrape after
a matcher change moves a lot of prices; that is what it is for. The invariant is doing its
job — it does not know the difference between a mass correction and a mass corruption, and it
should not. Expected to clear on the next ordinary nightly.

**c. `no unflagged offer deviates >70% from its cross-store median` — 47**
Real data debt. I withheld 7 of them; my own script used a stricter definition (3+ offers)
than the invariant (2+), so the two disagree and I ran out of session before reconciling.
These are mostly multipacks matched to singles — Auchan water at 19,95 against a 4,20 median
is a six-pack on a single-bottle product. **Not fixed. 47 wrong prices are visible.**

**d. `no missing deep link outside flyer sources` — 6**
Auchan 6, Freshful 14 offers whose "La magazin" goes to the merchant homepage rather than the
product. Minor: the price is right, the link is lazy.

**e. `every recently-seen offer carries its raw source string` — 1**
2 offers of 32,228. Noise.

**So: (c) is a real user-visible defect I did not finish. (a) is a blocker needing your
decision. (b), (d), (e) are not wrong prices.**

---

## 3. The Pepsi page — rendered HTML

```
cel mai mic preț | 28,14 RON | 14,21 lei/L · | 1 magazine | Vezi la Auchan · 28,14 RON →
Prețuri în 1 magazine
Magazin | Disponibilitate | Preț | Preț/unitate
Auchan | 🏬 | Magazin + online | În stoc | 28,14 RON | ✓ Cel mai mic preț | 14,21 lei/L | La magazin →
```

One row, one shop, no cola, no vanilie, no 2 l PET. Count and rows agree. 28,14 ÷ 1,98 l =
14,21. No strikethrough. **The defect the user reported six sessions ago is closed.**

What it took beyond the variant block: the block governs matches the matcher MAKES, and three
pre-block offers were still attached — stale, no `storeName`, `matchedBy` "scraper" — because
those merchants' fresh runs never re-matched them. **9,822 such unverifiable legacy offers
were withheld** across ~6,600 products, and the item table now hides withheld rows entirely.
Greying a false claim does not make it true.

---

## 4. The number

```
raw (any state)                14.6%   5,170 of 35,357
excluding stale                 6.7%   2,353
excluding stale AND out of stock 5.8%   2,035     <- the shopper-facing number

by section:  grocery 8.8% · alcohol 2.1% · dcneu 0.0% · cosmetice 0.0% · farmacie 0.0%
```

- **Products that lost a headline price entirely: 7,237 of 35,357** (79.5% still have at
  least one showable price).
- **Multi-merchant products broken apart by the variant block: 8** measured directly, though
  that measurement only covers offers carrying their own name — about a third of the catalog.
- **Comparability lost to:** out of stock 3,074 · stale 0 · flagged 61.
- **Carried by 2+ shops but not priced today: 232.**

Top out-of-stock categories: mezeluri 84.9% · lactate 74.3% · dcneu-deodorante 73.5% ·
menaj 65.0% · dcneu-gel-de-dus 63.7% · bauturi 41.5% · bacanie 36.9%.

**5.8% is at the bottom of your predicted 5–8%,** and the reason is that DCNeu, cosmetice and
farmacie contribute 0.0% — they are single-merchant sections by construction, and they are
11,000 of the 35,357 products. Grocery alone is 8.8%.

---

## 5. Decisions I need from you

**1. Omnibus strikethrough — already taken, confirming.**
You confirmed mid-session that following CLAUDE.md over the brief was right. The 30-day
figure is shown labelled, never struck. No action needed.

**2. Kaufland's drop guard vs a weekly flyer. — BLOCKER**
Kaufland aborted twice: `296 offers < 60% of last 594 live`. This is the guard working and
being wrong at once. Kaufland is a FLYER source whose catalogue legitimately varies week to
week; the 60% guard was designed for a site redesign or an anti-bot block, where a collapse
means the read broke. Right now Kaufland serves last week's prices with last week's dates.
Options: (a) exempt FLYER sources from the drop guard and rely on the promo-window expiry
instead — **my recommendation**, because a flyer already carries its own validity dates;
(b) lower the threshold for flyers only; (c) leave it and accept a stale Kaufland whenever
its flyer shrinks. I did not change it — a guard that has already saved this project twice
is not something to weaken at 4am without you.

**3. Spread withholding keeps the CHEAPEST offer. Should it keep the median?**
The brief said cheapest and that is what I did. On some products the cheapest may be the wrong
one: "Gelatina foi Dr. Oetker 10 g" carried sezamo 1,59 · carrefour 5,79 · auchan 6,85 on
names that all look like the same product — sheets-vs-package rather than a bad match — and
keeping 1,59 shows the lowest price when three shops disagree. 59 products affected.

**4. Do deposits belong in the ranking?**
Not applied, as instructed. If they did: a 6-pack carries 3,00 lei against a 2 l bottle's
0,50, so on beverages the ranking would shift toward large single containers. That is
arguably the honest total cost, and arguably a distortion since the deposit comes back.

**5. DCNeu re-scrape.**
We were reading 90 of its 180 categories. Raising the cap needs a ~1 hour re-scrape to take
effect. Not run tonight because the remaining phases mattered more.

---

## 6. Is it ready to merge to main?

**No — but closer than the number suggests, and for one reason only.**

Everything user-facing is right: the reported defect is fixed, no page shows a NaN or a zero
or a wrong-domain link, every unit price recomputes from its own row, the strikethrough is
honest, out-of-stock is handled on ten surfaces, and DCNeu's quantity discounts finally
render.

What stops me saying yes:

1. **47 offers deviate >70% from their product's median and are unflagged** (§2c). Those are
   wrong prices on live pages. It is a bounded, known list and an hour's work.
2. **Kaufland is serving last week's flyer** and will keep doing so until decision 2.
3. **34 commits sit on `fix/pepsi-merge` and main is 26 behind.** That is a large single
   merge and it deserves you awake, which is what you said.

Fix (1), decide (2), and I would say yes.

---

## 7. What surprised me

**DCNeu was scraping half its shop, and the log said so every night.** `MAX_CATS` was 90,
DCNeu has 180 leaf categories, and `.slice(0, 90)` truncated in page order. Every run printed
`Discovered 90 leaf categories` — a true statement that told nobody anything, because it reads
as a fact about DCNeu rather than a fact about our cap. The user's reported product sat in the
invisible half. I have raised the cap and made the log say when it bites, but the general
lesson is in BACKLOG: every scraper with a `MAX_*` constant needs the same look, because a cap
that bites produces a smaller, entirely valid-looking run.

**Fixing the site made its own audits lie.** Three separate checks reported large failure
counts that were entirely artifacts of withholding working: 8,822, then 22, then 46. Each one
counted rows that are on no page. An audit that does not share the display's definition of
"shown" will report defects the site does not have — and that is exactly as dangerous as one
that misses defects it does, because both teach you to ignore it.

---

## 8. Where I think you are wrong

**"Phases 2 through 6 are what a user sees."** Phase 7 was on your list as cleanup and it
turned out to contain the largest data gap in the project — half of DCNeu missing. The
ordering was right for the reasons you gave, but "cleanup" was the wrong label; it was the
only phase that asked *why the user's specific product does not exist*, and that question
found something no correctness check could have.

**The 5.8% understates what you have.** Three of five sections are structurally
single-merchant, so they can never contribute and they are a third of the catalog. Grocery —
the section the product is actually about — is 8.8%, and it is the only number that describes
the thing you are selling. I would report grocery comparability on its own and treat the
blended figure as an internal metric.

---

## 9. The assumption test

**Assumption chosen:** every offer on one product describes the SAME SIZE. Every cross-store
comparison depends on it, the unit price divides by it, and nothing verified it directly —
the size gate runs at match time, but nothing asked afterwards whether the offers that
survived actually agree.

**Query:** for every product with 2+ shown offers that state their own size, compare those
sizes; flag any product where they differ by more than 6% or use different units.

**Result: 0 of 2,017 comparable products disagree.** The assumption holds. That is the first
time this method has come back clean, and it is worth as much as the five corruptions it found
before — it means the size gate is working end to end rather than at the moment of matching
only.
