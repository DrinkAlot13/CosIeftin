# Morning report

**UPDATED after the four follow-up items.**

**Phases 1–10 done, plus items 1–4.**
**Tests: 742 passing. Build: clean.**
**verify:site: NOT GREEN — 4 invariants fail, NONE of them a wrong price on a page.**
**Comparability: 14.6% raw · 6.7% excluding stale · 5.6% excluding stale and out of stock.**
**audit:displayed 8/8. audit-db 25/29. All 12 merchants write.**

**The headline change: the "47 live wrong prices" did not exist.** They were an artifact of
two definitions over two populations. Under one shared rule there are **zero** visible
outliers, and the only user-facing defect I reported last time is gone.

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

`audit:displayed` **8/8**. `audit-db` **25/29**. The four:

**a. `no active merchant has 2 consecutive runs that produced nothing` — 1**
Historical: Kaufland's two aborts are still in its run history. Kaufland now writes 296
offers. Clears on its next successful nightly.

**b. `no day moves >50% on more than 5% of the offers written that day` — 2**
30 August and today. A full re-scrape after a matcher change moves a lot of prices; that is
what it is for. The invariant cannot tell a mass correction from a mass corruption and should
not try. Clears on the next ordinary nightly.

**c. `no missing deep link outside flyer sources` — 6**
Auchan 6, Freshful 14 offers whose "La magazin" goes to the merchant homepage rather than the
product page. The price is right; the link is lazy.

**d. `every recently-seen offer carries its raw source string` — 1**
2 offers of 32,228. Noise.

**None of these is a wrong price on a live page.** The one that was — 47 median outliers —
turned out not to exist; see §9.

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
raw (any state)                 14.6%   5,170 of 35,357
excluding stale                  6.7%   2,353
excluding stale AND out of stock 5.6%   1,980     <- the shopper-facing number
```

Down from 5.8% because withholding now removes rows that were previously counted — the number
got smaller and more honest at the same time.

- **Products with no showable price at all: 7,466 of 35,357** (78.9% have at least one).
- **Multi-merchant products broken apart by the variant block: 8** measured directly.
- **Lost to:** out of stock 3,074 · stale 0 · flagged (withheld) the remainder.

By section: grocery 8.8% · alcohol 2.1% · dcneu 0.0% · cosmetice 0.0% · farmacie 0.0%.

Top out-of-stock categories: mezeluri 84.9% · lactate 74.3% · dcneu-deodorante 73.5% ·
menaj 65.0% · bauturi 41.5% · bacanie 36.9%.

## 5. Decisions I need from you

**1. Omnibus strikethrough — already taken, confirming.**
You confirmed mid-session that following CLAUDE.md over the brief was right. The 30-day
figure is shown labelled, never struck. No action needed.

**2. Kaufland — RESOLVED without touching the guard. No decision needed.**
The scrape was healthy all along: 264 of 265 prices parsed. The BASELINE was wrong. All 594
"live" Kaufland offers were observed on one day and **303 of them carried a promo window that
had already passed** — flyer offers accumulate across weeks unless something expires them, so
the guard was comparing one week's catalogue against three weeks of dead ones. 594 − 303 = 291
current offers; 296 against 291 is a healthy run.

The drop-guard baseline now excludes offers whose promo window has passed. The rule is
unchanged and still 60%; only the number it reads changed, from "every row not yet marked
stale" to "every row still actually on offer". **Kaufland writes 296 offers.**

For the record, since you asked what exempting FLYER sources would cost: Kaufland is the
merchant whose data is hardest to sanity-check — weekly, no deep links, 100% flyer — so it is
the worst one to leave unguarded, and a broken run would silently replace 296 real prices with
nothing while still looking alive in `audit:liveness`. The baseline fix removes the need to
decide at all.

**3. Spread withholding keeps the CHEAPEST offer. Should it keep the median?**
The brief said cheapest and that is what I did. On some products the cheapest may be the wrong
one: "Gelatina foi Dr. Oetker 10 g" carried sezamo 1,59 · carrefour 5,79 · auchan 6,85 on
names that all look like the same product — sheets-vs-package rather than a bad match — and
keeping 1,59 shows the lowest price when three shops disagree. 59 products affected.

**4. Do deposits belong in the ranking?**
Not applied, as instructed. If they did: a 6-pack carries 3,00 lei against a 2 l bottle's
0,50, so on beverages the ranking would shift toward large single containers. That is
arguably the honest total cost, and arguably a distortion since the deposit comes back.

**5. DCNeu re-scrape — RUNNING, no decision needed.**
Started during item 2. It discovers **180 categories and scrapes 180** (was 90 of 180), and
has already pulled `menaj/flori-artificiale +140` — the category holding the product you
pointed at, which never existed in our catalogue before tonight. It is finding **10,683
products against 6,019**. The detail pass needs another hour or two.

---

## 6. Is it ready to merge to main?

**Yes, with one caveat — a change from last time.**

What changed: the only user-facing defect I flagged (47 outliers) was a measurement artifact
and is zero under one definition. Kaufland now runs. All 12 merchants write. `audit:displayed`
is 8/8 and the four remaining `audit-db` failures are historical or cosmetic, not wrong prices.

**The caveat: DCNeu is mid-re-scrape.** It is finding 10,683 products against 6,019 before —
the half that `MAX_CATS=90` was hiding — and its detail pass will run for another hour or two.
Merging while that runs is safe (it writes to the database, not the branch) but the DCNeu
numbers in this report are from the truncated catalogue and will change.

**My recommendation: read this, let DCNeu finish, run `npm run verify:site` once more, then
merge.** 40 commits, and they deserve the one check that runs against the finished data.

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


---

## 10. The four follow-up items

**1. The 47 outliers — they were not real.** Two definitions over two populations: `audit-db`
used `|b − med| > 0.7·med` over every offer it had loaded; the repair used a ratio over
visible offers only. The thresholds agree on the high side and differ by a factor of two on
the low side (0.30·med against 0.588·med), and the populations differed entirely. `lib/outlier`
now holds the rule, the threshold, the peer minimum and the population, and both callers
import it. **Result: 0 visible outliers.** The 47 were withheld, stale or out-of-stock rows.

The median is now computed over visible offers only, which matters on its own: including
withheld prices lets one we have already refused drag the median toward itself and hide the
next one.

**2. DCNeu at full coverage + truncation made loud.** `lib/truncation` with `noteCap` for
slice-style caps and `notePageCap` for pagination loops. Every cap surveyed:

| scraper | cap | value | shape | truncating |
|---|---|---|---|---|
| dcneu | MAX_CATS | 90 → 250 | slice | **was, 90 of 180 — fixed** |
| farmaciatei | MAX_SUBS | 24 | slice | wired, reports at run time |
| carrefour, -alcohol, finestore, lemanoir, metro | MAX_PAGES | 13/8/12/15/45 | pagination | wired |
| megaimage, sezamo | MAX_PAGES | 65/30 | pagination | loop shape differs — BACKLOG |
| auchan adapter | maxPages | 8 | pagination | self-limiting, breaks on empty page |

New invariant: `no merchant's successful run collapsed to half its own recent best` — the
shape truncation leaves in the data after the fact. Green.

**3. Kaufland — fixed, see §5.2.**

**4. Audit scope.** All 21 audits now open with a banner declaring USER-FACING (counts only
rows that reach a page — 3 audits) or DATA INTEGRITY (counts everything, and says "do not add
a visibility filter here" — 18 audits). That distinction is the whole cause of the phantom
8,822 / 22 / 46.

Corrected: audit-displayed 6/8 → **8/8**. Outliers 47 → **0**. Cheapest-withheld 8,822 → **0**.
Struck collisions 22 → **0**. Zero-write runs 46 → **0**.
