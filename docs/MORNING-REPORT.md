# MORNING REPORT — overnight 2026-09-08

    PHASES        1,2,3,5,6,7 done. Phase 4 was ALREADY BUILT before the brief arrived (decision 2).
    TESTS         886 pass, 0 fail. Typecheck clean. Build clean.
    VERIFY        audit:db 43/48. verify:site halts there. 5 failures, all pre-existing, explained below.
    COMPARABILITY 29,203 products · 32,484 prices · 2,702 comparable in 2+ · 3,829 comparable-or-equivalent.
    WAITING ON YOU  6 decisions, numbered in section 5. Decisions 1 and 2 are about work already landed.

---

## 1. Phases done, and not reached

| phase | state |
|---|---|
| 1 — /search performance | **done** (committed to `main` before the brief; see decision 1) |
| 2 — private-label opportunity | **done** |
| 3 — 30 classes + outside audit | **done** |
| 4 — surface it | **ALREADY BUILT AND LIVE.** The brief says not to build it. See decision 2. |
| 5 — unattended backlog (a–e) | **done**, and two of the five were much bigger than the brief thought |
| 6 — measure and propose (a–e) | **done** |
| 7 — close out | this file |

Nothing was left unreached. Three things in the brief were deliberately NOT done and each says
so where it is described: Glovo merchants (forbidden by the brief), matcher-rule changes
(forbidden), and dropping `Offer.bulkTiers` (its stated precondition failed — things read it).

---

## 2. `verify:site` and `audit:db`, with every failure explained

`verify:site` chains with `&&` and **halts at `audit:db`**, so the steps after it did not run in
that chain. They were run individually: `audit:search-quality` **36/40**, `verify:perf` **all 12
routes under 1,000 ms**, `verify:offline` clean.

`audit:db`: **43 of 48 invariants hold.** It was 42/48 mid-session; running `compute:home`
cleared 20 stale `liveOfferCount` rows left by the Sezamo re-scrape.

The five failures, none of them in code touched tonight:

1. **"no day moves >50% on more than 5% of the offers written that day"** — historical. Two
   mass-move days, both full re-scrapes after a matcher change, both already looked at and
   both corrections. The invariant cannot tell a correction from a corruption and should not
   try. Tuning it to go green would disable it for the next real one.
2. **"no product's offers disagree by >70%"** — this is the peer-relative GROUP finding, not a
   verdict on a row. CLAUDE.md is explicit that it may not name a culprit. Leaving it red is
   correct; it is a queue, not a bug.
3. **fan-out within limits** — Auchan has one product with fan-out 9 against a limit of 8, and
   Carrefour is using the identity fallback on 5 of 5,279 offers.
4. **"no missing deep link outside flyer and delivery-platform sources"** — 5 Carrefour offers.
   Now separable from the 3,270 *expected* nulls, thanks to `lib/source-capabilities.ts`.
5. **"every live productUrl points at a product page"** — 3 Carrefour offers pointing at
   `footprints-ai.carrefour.ro/campaigns-smart/…`, a promo landing page.

**One invariant that newly passes and is worth noticing:** *"no equivalence class is stranded at
a single merchant"* and *"every classified product satisfies its class's membership rules"* both
hold across the 30 new classes.

---

## 3. The 30 classes, in full, for your review

`npm run audit:private-label-classes` prints every member of every class with its own price,
its own size and its own unit price. Summary — **9 clean, 20 flagged on the >2x unit-price rule,
0 outside their window, 1 resolving to a single merchant**.

The single-merchant one is `sos-salsa-branza-300g`, and it changed WHILE THIS REPORT WAS BEING
WRITTEN: Auchan's *Sos salsa cu branza 300 g* aged out of the live window, leaving only Mega
Image. That is the audit working — a class that stops being a comparison says so the same day —
but it means the table below is a snapshot of a live catalog, not a fixed set.

| class | prod | shops | lei/unit range | flag |
|---|---|---|---|---|
| apa-carbogazoasa-05l | 23 | 6 | 2.38–7.38 /l | 3.10x |
| apa-plata-05l | 24 | 4 | 2.38–12.10 /l | 5.08x |
| arahide-coaja-500g | 5 | 4 | 21.98–24.38 /kg | ✓ |
| arahide-decojite-500g | 5 | 4 | 17.98–20.38 /kg | ✓ |
| cafea-macinata-decofeinizata-250g | 5 | 4 | 59.96–167.96 /kg | 2.80x |
| ciuperci-intregi-conserva-280g | 4 | 4 | 18.54–38.54 /kg | 2.08x |
| ciuperci-taiate-conserva-280g | 9 | 5 | 16.52–34.96 /kg | 2.12x |
| croissant-cacao-85g | 5 | 4 | 20.59–49.88 /kg | 2.42x |
| faina-alba-650-1kg | 7 | 4 | 2.05–8.69 /kg | 4.24x |
| fasole-alba-uscata-1kg | 12 | 5 | 6.99–15.79 /kg | 2.26x |
| fasole-rosie-boabe-400g | 12 | 5 | 8.12–27.47 /kg | 3.38x |
| fulgi-ovaz-500g | 11 | 7 | 3.98–24.98 /kg | 6.28x |
| mazare-verde-boabe-400g | 8 | 4 | 10.97–18.22 /kg | ✓ |
| migdale-fara-sare-150g | 2 | 2 | 67.93–74.60 /kg | ✓ |
| migdale-sarate-150g | 4 | 3 | 67.93–229.93 /kg | 3.38x |
| mustar-clasic-300g | 10 | 5 | 12.17–34.78 /kg | 2.86x |
| mustar-iute-300g | 9 | 6 | 12.17–26.30 /kg | 2.16x |
| otet-alcool-1l | 6 | 4 | 3.39–5.49 /l | ✓ |
| porumb-dulce-boabe-150g | 5 | 5 | 21.93–28.42 /kg | ✓ |
| porumb-dulce-boabe-340g | 6 | 3 | 14.68–29.38 /kg | 2.00x |
| rahat-fructe-500g | 4 | 3 | 15.38–29.98 /kg | ✓ |
| seminte-albe-sarate-100g | 8 | 5 | 38.90–85.90 /kg | 2.21x |
| seminte-albe-sarate-200g | 6 | 6 | 29.95–69.95 /kg | 2.34x |
| sos-salsa-branza-300g | 2 | 2 | 33.30–33.97 /kg | ✓ |
| stafide-brune-200g | 1 | 2 | 49.95–54.95 /kg | ✓ |
| ulei-masline-extravirgin-1l | 17 | 5 | 45.99–109.99 /l | 2.39x |
| ulei-masline-extravirgin-500ml | 25 | 5 | 50.78–139.98 /l | 2.76x |
| zacusca-ciuperci-300g | 5 | 4 | 23.30–49.30 /kg | 2.12x |
| zacusca-vinete-300g | 11 | 5 | 18.30–95.51 /kg | 5.22x |
| zahar-brun-500g | 5 | 5 | 8.70–13.18 /kg | ✓ |

### What the 2x flag turned out to measure, and why I did not tune it

**Twenty of thirty flagged, and I do not believe twenty of them are wrong.** The 2x rule
assumes a class of own-brand equivalents. These classes admit national brands too — deliberately,
because a class says what a product IS, not who made it — and in Romanian grocery the brand
premium routinely exceeds 2x. `apa-plata-05l` spans 2,38 lei/l (a shop's own spring water) to
12,10 (Evian). Every member is genuinely 0,5 l still water. That is not a merge error; it is
the comparison a shopper wants.

CLAUDE.md says not to fix a peer-relative check by tightening the threshold. So the audit also
prints a question that does not depend on price at all: **which WORDS separate the cheap half
from the dear half.** Reading those lists is how seven real merges were found.

**Read section 8 before trusting that as a rule.** I first wrote it up as a better instrument
than the spread threshold; measured properly it flags 29 of 30 classes and is worse. It is a
READING AID and the audit now labels it as one, with a single verdict per class.

**The seven real merges, all now fixed** — `npm run audit:discriminator --demo` reproduces each
one from the live catalog by stripping the fix's added exclusions and listing what the old rule
admitted (26 products in total):

- **`necarbogazoasă` admitted to the SPARKLING water class** — `carbogaz` is a substring match,
  so the token that DEFINES the class also matched its negation. A still water in the fizzy class.
- flavoured waters (`afine`, `mentă`) in both water classes
- sugar SACHETS (`plic`, `baghete`), stored as 500 g exactly like a bag
- PICKLED mushrooms, in vinegar with dill, inside the tinned-whole class
- other croissant fillings — **I wrote `capsune`; the catalog writes `capsuni`**
- Manitoba flour in the tip-650 class; ground oat FLOUR in the oat-flake class

After the fixes: 0 outside the window, and no class merging two products that I can find by
reading them. The remaining spreads are brand premium — Evian beside an own-brand spring water,
Sanovita oats beside K-Classic — which is the comparison the site exists to show. That
judgement is mine from reading the member lists, not a verdict any rule produced.

### Milk is not among the 30, and it was your headline example

Carrefour names its treatment (`Lapte Uht Carrefour Clasic 3.5% 1L`). Mega Image and Freshful
do not. Mega carries **"Lapte de consum 3.5% grasime 1L" at 5,49 and "Lapte 3.5% grasime 1L" at
8,99** — same shop, same fat, same litre, and nothing in either name says which is UHT and which
is fresh. The brief forbids merging UHT with fresh; the catalog cannot separate them. Requiring
`uht` yields a one-merchant class, which is not a comparison.

**It needs a treatment or shelf-life field from the merchant feed, not a cleverer rule.**

---

## 4. Comparability — two numbers, never folded

    products                        29,203
    prices                          32,484
    comparable in 2+ shops           2,702      <- moves ONLY when a real cross-shop MATCH is made
    comparable OR equivalent         3,829      <- also moves when a class is written
    difference                      +1,127

**The strict number did not move because of this work, and that is the point.** It was 2,449 at
the start of the session and is 2,702 now — and all 253 of that came from re-scraping Sezamo
(see section 7), not from a single equivalence class. A class relates two DIFFERENT products; it
cannot make them the same product, so it must not touch `comparable`.

**What equivalence WOULD add, attributed honestly:**

    single-shop products that now have a priced equivalent elsewhere   1,148
      via the 30 classes written tonight                                 204
      via classes that already existed, simply re-assigned                944

The second line is the uncomfortable one. `propose:equivalence --apply` had not been run since
the classes were last edited, so re-running it took classed products from 820 to 1,399. **The
Index basket's per-shop fill jumped for the same reason** (mega-image 21→33 lines, freshful
19→29) — that is a stale assigner catching up, **not** the new classes, none of which is an
Index line. I have said this in the commit, in `SOAK.md` and here because it would be very easy
to read that jump as tonight's work.

`tests/equivalence-never-prices.test.ts` pins the boundary structurally: `getItemPage` may not
read `equivalenceClass` at all, so a class member can never set another product's *cel mai mic
preț*; and `countStats` must keep the plain 2-merchant depth test intact.

---

## 5. Decisions I need from you

**1 — Five commits landed on `main` before the branch instruction arrived.**
`967930a` (search perf), `8eb9401` (store discovery), `846de15` (the 30 classes), `b590c6b`
(the Sezamo link fix), `381cb44` (untracking scratch). They were made in response to an earlier
instruction in the same conversation ("finish everything"), before the overnight brief existed.
Everything since is on `overnight/2026-09-08`.
*Options:* (a) leave them — they are good changes and one is a live bug fix; (b) revert them on
main and re-land through the branch.
**Recommendation: (a).** Rewriting published history to satisfy a rule that did not exist when
they were written costs more than it buys, and `b590c6b` fixes 9,420 dead links.

**2 — Phase 4 is already built and live; you asked to read the 30 classes first.**
What is live: the item page's equivalents section heading changed from *"Același lucru, la alt
magazin"* to *"Produse echivalente la alte magazine"* with the lede *"Nu sunt același produs"*;
and the homepage carries the second counter. The section itself is **not new** — it predates
this session; what changed is which products fall into it, because the assigner ran.
*Options:* (a) leave it and review the classes with them live; (b) revert the two rendering
changes, keep the classes and the assignment.
**Recommendation: (a), with the reservation stated.** Reverting the heading makes the page
*less* honest ("the same thing" was the stronger claim), and reverting the counter removes a
number you asked for in the previous brief. But this is your call and I should not have got
ahead of it.

**3 — What to do with 274 offers whose two bulk-tier copies disagree.**
Zero of 274 agree. The JSON copy is unvalidated and contains `qty:1` rungs the validator
refuses; the table copy is gated. Both readers now validate, so nothing invalid is applied.
*Options:* (a) treat the table as authoritative, validate the 189 JSON-only offers into it,
then drop the column; (b) keep both and re-derive the JSON from the table; (c) leave as is.
**Recommendation: (a)** — it is the CLAUDE.md migration sequence, and the table is the copy the
item page already trusts.

**4 — `matchScore` means two different things and the review queue ranks on it.**
An EAN join scores 1.00; `brand+size` also reaches 1.00 (10,518 offers, avg 0.959); 9,533
offers have **no score at all**; 18,483 carry a constant 0.50. You guessed this might be
latent — it is **active**: 7 EAN-derived rows are in the queue.
*Options:* (a) add a separate `matchKind` and rank on the pair; (b) reserve 1.00 for joins and
cap scored matches at 0.99; (c) leave it — 7 rows.
**Recommendation: (a)**, but not soon. Touching what a score MEANS is a matcher change and this
brief forbade it; the cost today is seven rows in a 64,603-row queue.

**5 — Should `/lista` resolve through equivalence classes?** See proposal 5. A real 20-staple
basket cannot be filled by ANY single shop, because the v1 pinned slugs mostly have no class and
`EQUIVALENT` mode silently degrades to `EXACT`. The class-based Index basket over comparable
lines reports Sezamo 30/40 and Mega Image 33/40 from the same catalog.
**Recommendation: yes, and it is the highest-value product change on the list.**

**6 — Delivery-platform prices are reaching the optimizer.** See proposal 1. Two `where`
clauses. It contradicts a comment in `currentOfferWhere` that claims the opposite.
**Recommendation: fix it before considering the Glovo Profi/Penny storefronts**, which would
otherwise make the leak bigger.

---

## 6. `docs/PROPOSALS.md` — summary

Ranked by value per hour of your attention. 1: stop DELIVERY_PLATFORM reaching the optimizer
(30 min). 2: populate `ProductAttribute.isPrivateLabel` — the preference has never done anything
(1 h). 3: retire the `bulkTiers` JSON column (2 h). 4: harvest Farmacia Tei EANs — real, but
`farmacie`-only, it will not move grocery comparability (2 h). 5: make `/lista` resolve through
classes — the biggest gap between what the site can do and what it does. 6: six empty classes.
7: 209 missing deep links. 8: `iaurt-natural-400g` merges 3% and 5% fat, live now. 9: two
products whose stored size disagrees with their own name. **10: Selgros — NOT worth doing, with
the evidence. 11: Glovo — Lidl does not exist on Glovo Bucharest at all.**

---

## 7. What surprised me

**Sezamo's every product link was a 404.** Found by accident while probing detail pages for
EANs. The scraper wrote `${BASE}/${slug}`; the live path is `${BASE}/${id}-${slug}`, the same
shape as the category paths. **9,420 dead links on our largest merchant by live products**, and
nothing could have caught it: the scraper set the field, the pool contract saw a non-null
string, and `audit:db` checks the database — which was not wrong. **The world was.** A written
value can be well-formed, non-null, freshly re-observed, and refer to nothing. `npm run
probe:links` now asks over the network. Re-scraped; 0/8 dead.

**Three classes deleted from the code months ago were still in the database, holding products.**
`busuioc-kg`, `marar-kg`, `patrunjel-kg` — the comment in `produce-classes.ts` explaining why
they were removed is still there. The removal never took effect, because deleting a definition
does not delete a row. The seeder now removes classes absent from the code and clears their
assignments first. Same shape as the assign/unassign rule, third and fourth address.

**`mazare-kg` and `porumb-kg` held 41 products and every single one was a tin or a bag of
popcorn.** Their exclusions named `conserva`; the products say `boabe`, `in vid`, `in saramură`.
The catalog contains no fresh peas and no corn on the cob at all, so those classes could only
ever fill with the processed forms sharing the head noun.

**The `pricePerUnit = 0` item was 6,791 offers, not 96** — and every one also has
`pricePerUnitBani = NULL`, written by the same line. The card hides a zero so nothing false was
displayed, but `SortableProductGrid` SORTS on it: **"cheapest per unit" was listing every
product whose unit price we could not compute at the TOP.**

**And one of my own:** my first attempt to untrack some scratch files reported success and did
nothing. The guard was `grep -q '^logs/' .gitignore`, which matched the unrelated
`logs/nightly/` line. A check that cannot tell *this rule* from *some rule starting the same
way* is not a check. Same family as everything above.

---

## 8. Where I think you are wrong

**The 2x unit-price spread threshold — I was half right, and the half I was wrong about is the
half I stated most confidently.** ~~The token test is the better instrument.~~ **It is not.**
Measured as an automatic classifier (`npm run audit:discriminator`) it flags **29 of 30**
classes, against the spread rule's 20. It calls `sos-salsa-branza-300g` — spread 1.00x, a
perfect class — a merge, on the strength of its own require-words `sos salsa branza`. It cannot
tell a product-defining word (`masline`, `murate`) from a merely descriptive one (`coapte`,
`fin`, `extra`, `din`), because both appear beside dozens of brands. So it has NOT replaced the
spread rule, and the class audit now prints the word lists explicitly labelled as a reading aid
with **one verdict per class**, not two.

What I got right is the criticism of the spread rule, and it is now measured rather than
asserted: **fixing all seven real merges changed the flag set by nothing.**

    class                        spread BEFORE the fix   AFTER   still flagged?
    apa-plata-05l                        5.08x           5.08x   yes — unchanged
    fulgi-ovaz-500g                      6.28x           6.28x   yes — unchanged
    croissant-cacao-85g                  2.42x           2.42x   yes — unchanged
    ciuperci-intregi-conserva-280g       2.08x           2.08x   yes — unchanged
    faina-alba-650-1kg                   4.87x           4.24x   yes
    apa-carbogazoasa-05l                 4.33x           3.10x   yes
    zahar-brun-500g                      3.22x           2.87x   yes

Twenty flagged before, twenty after. Four of the seven did not move the number **at all**. The
spread was always brand premium; the merges were hiding inside a flag that was already red for
another reason. **A flag that stays lit after every defect it was meant to catch has been fixed
is not tracking those defects.** `npm run audit:discriminator --demo` reproduces this from the
live catalog: it strips each fix's added exclusions, re-runs membership, and lists the 26
products the old rules admitted — `Apa de izvor necarbogazoasa`, `Zahar brun Muscovado`,
`Bonduelle Ciuperci intregi, in otet cu marar`, `Panzani Faina 650 Manitoba`, `Yutto Fulgi de
ovaz macinati fin`, eight wrong croissant fillings.

**So what actually found the seven?** Reading the member list, with the word lists as a prompt.
That is a person, not a rule — and I should have said so the first time instead of promoting my
reading aid to an instrument. The honest recommendation is a **review gate**: the audit prints
every member, records that a human signed the class off, and flags a class whose rules have
changed since. Spread stays as printed context. I have not built that — it is a design decision
and it is yours.

**"Drop the JSON column after confirming nothing reads it."** The framing assumed redundancy.
The real finding was disagreement — 0 of 274 agreeing, with the optimizer on the unvalidated
side. Had I confirmed "nothing reads it" and dropped the column, I would have deleted the copy
the optimizer was actually using and never noticed the ladders were bogus. **The condition that
saved this was the one you attached to the instruction**, so this is less a disagreement than a
note that it earned its keep.

**"96 offers carry pricePerUnit = 0."** It is 6,791. I mention it not to correct a number but
because the gap matters: 96 sounds like a data cleanup and 6,791 sounds like a systemic default,
which is what it is. Worth asking where the 96 came from — if a previous count was scoped to one
merchant or one section, that scoping is still somewhere.

**Glovo Lidl.** The earlier brief asked for Lidl, Penny and Profi. **Lidl is not on Glovo
Bucharest** — six slug variants all return "Această pagină nu există" and it appears on no
listing page. That lever is two stores, not three, and the marked-up-price objection in proposal
11 applies to both.

---

## 9. Two follow-ups completed after the first draft

### 9.1 `probe:links` generalised — the second external oracle, now a standing check

**Run once across every merchant: 501 links, 11 merchants, ZERO dead.** Sezamo is clean after
the fix, and no other merchant has the problem — so it was one scheme, not a pattern.

    merchant        live  checked   ok   404  soft  dead%
    auchan          4908       50   50     0     0   0.0%
    carrefour       5206       50   50     0     0   0.0%
    dcneu          10785       50   50     0     0   0.0%
    farmaciatei     2040       50   50     0     0   0.0%
    finestore        280       50   50     0     0   0.0%
    freshful        3083       50   50     0     0   0.0%
    lemanoir          94       22   22     0     0   0.0%
    mega-image      6752       50   50     0     0   0.0%
    metro           5384       50   50     0     0   0.0%
    penny             29       29   29     0     0   0.0%
    sezamo          7520       50   50     0     0   0.0%
    glovo-kaufland     0        —                          no product urls — EXPECTED, declared
    kaufland           0        —                          no product urls — EXPECTED, declared

What it does now: 50 links per merchant, **rotating by date** so a scheme that breaks only some
URLs surfaces within days; per-merchant 200 / redirect / 404 / soft-404 / 5xx counts; and a
**soft-404 detector**, because a redirect landing on the home page is a 404 wearing a 200. A
merchant over 4% dead fails the run. Wired into `soak:log` as step 8 and into `soak:report`
**one line per merchant** — an aggregate is exactly how Sezamo hid.

**It caught itself first, and that is worth recording.** The initial version parsed
`--json <path>` by treating anything without a leading dash as a merchant name, so it filtered
every merchant out, checked ZERO links, and printed a green tick with exit 0. It now refuses an
unknown merchant name (exit 2) and **fails a run that checked nothing**. A check that can
silently do nothing is worse than no check, because it also removes the suspicion that would
have made someone look.

`CLAUDE.md` gained a section, **"SOME FACTS CAN ONLY BE CHECKED AGAINST THE WORLD"**, naming the
class, listing the two oracles we own (`audit:unit-oracle` on Kaufland's `formattedBasePrice`,
and `probe:links`), the four rules for building one, and three candidates for a third.

### 9.2 The 2x threshold — I made the case and the data went against me

Full write-up in section 8. Short version: **the criticism of the spread rule holds and is now
measured** (fixing all seven merges left the flag set at twenty, four of them unmoved to two
decimal places), but **my proposed replacement is worse** — 29 of 30 versus 20 of 30, flagging a
perfect class on its own require-words. So the spread rule stays, the token lists are labelled a
reading aid, and `audit:private-label-classes` reports **one verdict per class**, as you asked.

`npm run audit:discriminator` prints both instruments side by side for all 30; `--demo` strips
each fix's added exclusions and lists the 26 products the old rules admitted.

---

## 10. The class-churn problem, and the limit written down

### 10.1 A class is only a comparison while its members are in stock at two shops

**This is the failure mode of the whole approach and it happened on day one.**

    the 30 new classes    29 are a comparison today · 1 stranded at one shop · 0 with no live member
    all 131 classes      114 are a comparison today · 12 stranded at one shop · 5 with no live member

At creation, all 30 spanned 2+ shops — the Phase 3 audit reported 0 single-merchant, which is
the check that would have caught it. Within hours `sos-salsa-branza-300g` fell to one when
Auchan's *Sos salsa cu branza 300 g* aged out of the live window. **Nothing announced it.** The
class went on existing while the comparison stopped.

The older classes tell the same story, and I have no creation-time snapshot for them — twelve
are stranded now and I cannot say when any of them fell:

    banane-bio-kg (sezamo) · crenvursti-450g (mega-image) · margarina-500g (metro)
    mere-1kg, mere-granny-kg, mere-idared-kg, rosii-1kg, sare-1kg (auchan)
    mere-kg, visine-kg (sezamo) · ridichi-kg (freshful) · sos-salsa-branza-300g (mega-image)

**Now in the nightly.** `npm run audit:class-health` reports members, LIVE members and merchant
span per class, and is recorded by `soak:log` as step 9. `soak:report` surfaces it **one line
per class** — an aggregate would bury one class falling among 130 healthy ones, which is exactly
how this went unnoticed. A stranded class is reported as **information, not a failure**: the
rule may be perfectly good and the shelf temporarily empty, and deleting on that basis would be
the "assign must be able to unassign" mistake pointed the wrong way.

### 10.2 The UI did NOT handle it — a live bug, now fixed

You asked me to confirm rather than assume, and the answer was no. Fetched, not reasoned:

    /p/crenvursti-cu-piept-de-pui-caroli-450-g-5941259016419

    🔁 Produse echivalente la alte magazine
       Crenvursti cu piept de pui Caroli, 450 g · produsul de mai sus | Mega Image | 17,99
       Crenvursti cu piept de pui Fox, 470 g                          | Mega Image | 18,79
       Crenvursti cu curcan Caroli, 450 g                             | Mega Image | 23,39

**"At other shops", over three rows all at the same shop, including the product being viewed.**
The guard was `rows.length > 1`, and a row is per (product, shop) — two rows can be one product
at two shops, or two products at one. It counted the wrong thing.

`getClassEquivalents` now returns `otherShopCount` (equivalents at a shop that does not already
sell this product) and `equivalentCount`. The page picks its heading from the data:

- equivalents at other shops → **"Produse echivalente la alte magazine"**
- equivalents only at the same shop → **"Produse echivalente în același magazin"**
- no equivalents at all → nothing renders

Verified on the rendered page both ways: the crenvurști page now says *în același magazin*, and
`zahar-brun-500g` still says *la alte magazine* across five shops. Pinned by a test, including
that both counts exist on every return path — omitting them from the early return would have
made the page compare `undefined > 0`, which is false, and the section would have silently
stopped rendering for every unclassed product.

**Deliberately kept rather than hidden:** a cheaper equivalent at the shop you are already in is
useful, so that case gets an honest heading instead of being suppressed.

### 10.3 The limit, written into CLAUDE.md

New section, **"SOME DEFECTS HAVE NO AUTOMATED DETECTOR"**, next to the peer-median limit. It
records that the spread rule did not find the seven merges — a person reading the member lists
did — with the before/after table showing the flag set unchanged at twenty; that promoting the
reading aid to an instrument produced a rule flagging 29 of 30 and detecting nothing; and three
rules that follow: an audit's job is to make ten minutes productive rather than to reach a
verdict, one verdict per subject, and say plainly which numbers are judgements.

`audit:discriminator` was rebuilt for reading rather than for scoring: classes ordered
likeliest-problem-first, one line per PRODUCT (not per row) sorted by unit price with its shops
beside it, separating words in [brackets] inside the names, and spread, shop count and size
range in the header. The ordering is stated in the file as a sorting heuristic only — nothing
reads it and it appears in no summary.


### 10.4 CORRECTED — Carrefour is not collapsing, and the real finding is better

**What I told you:** "Carrefour collapses on a second run", 1,197 written against a recent best
of 4,083, recurring. **That was wrong.** I would have handed you a defect that does not exist.

**What it actually is:** `scrape-carrefour` (grocery) and `scrape-carrefour-alcohol` both write
to the SAME merchant row. Carrefour holds **4,763 grocery offers and 1,243 alcohol offers**, and
the ~1,212-item runs are the alcohol catalog working normally — on eight of fourteen days,
always beside a ~4,000 grocery run. Two scrapers, not one scraper failing.

I caught it by checking the alternative before building the guard on top of it, which is the
only reason it did not reach you as PROPOSALS item 12.

**The real defect is in the invariant that told me.** `audit:db`'s collapse check took a
merchant's last four runs *regardless of which catalog they covered*, so it fired every night
the alcohol run finished last. **`matchPoolToCatalog`'s write-side guard had already learned
exactly this** — its comment says so in as many words, and it works around it by counting live
offers per merchant AND section. The invariant one file away never got it. The same shape as the
assign/unassign rule in CLAUDE.md: two places, one lesson, nothing connecting them.

Fixed: `ScraperRun.section` exists and the invariant compares within a section. Runs from before
the column are **excluded rather than assumed to be grocery** — and because that is currently
every run, the check prints

    note: COMPARED NOTHING — no merchant yet has 3+ runs carrying ScraperRun.section.
          Green here means 'not checked', not 'healthy'.

which is the rule I wrote into CLAUDE.md tonight, applied to my own work.

**Your diagnosis of the guard gap was right regardless**, and it is now closed — see 10.5.

### 10.5 The missing guard, added: pool size against the merchant's own recent pools

`ScraperRun.poolSize` records what each run DISCOVERED, and `matchPoolToCatalog` refuses a run
pooling under 60% of its merchant-and-section's recent pool. **The existing write guard is
untouched.**

**The baseline is the MEDIAN, not the maximum, and Kaufland is why.** Its pool swings 540 → 247
→ 500 as flyer promotions start and end. Against the recent maximum every short flyer week is a
49% "collapse", so a max-based guard would refuse a healthy run most weeks — the same mistake
that once made the write-side guard refuse Kaufland twice by comparing one week's catalogue
against three weeks of expired offers. A median absorbs the cycle and still catches a real
collapse: Kaufland's median is ~264 so 247 passes, while Carrefour grocery's is ~3,961 so a
1,200-item run would not.

Verified with a real scrape rather than reasoning: Penny wrote 29 offers from a pool of 30, no
false abort.

**14 nights of pool sizes — the number that has been invisible the whole time:**

    merchant         08-30  08-31  09-01  09-02  09-03  09-04  09-05  09-06  09-07  09-08
    auchan               —      —   5707   5695   5649   5420   5667   4536   5294   4644
    carrefour            —   3961   4006   4010   4011   4006   4039   4043   4041   3944
    dcneu             7734   6024      —  10676  10689  10689  10706  10701  10701  10679
    farmaciatei          —    897      —    884    932    909    920    927    917    921
    freshful             —   3239   3244   3104   3103   3100   3102   3112   3103   3100
    kaufland           286    286    540    264    264    264    254    252    247    500
    mega-image           —   7129   7160   6960   7031   7025   7027   7036   7036   7009
    metro             5244   5245   5246   5246   5247   5245   5245   5235   5239   5233
    sezamo            7820   7724      —   7799   7853   7828   7850   7862   7814   7801

**Nobody else fluctuates.** Metro is flat to ±14 across ten days, Mega Image to ±200, Sezamo to
±140. The two entries still on the collapse list are both explained and neither is a defect:
Carrefour's are the alcohol scraper, and DCNeu's are runs from before its discovery **improved**
from ~6,000 to ~10,700 on 2 September — the past reading as broken because the median moved. The
report prints both caveats in its own output; the guard sees neither, because it compares only
the last 14 days within one section.

**One thing neither guard catches, named rather than fixed:** Auchan drifted 5,707 → 4,644 over
ten days, a 19% decline where every single night is within 60% of the last. Slow erosion passes
a ratio test by construction.

**Also still failing: "no offer past promoValidTo left unmarked as expired" — 18 Kaufland
offers**, all `validTo=2026-09-08`. Flyer promos expiring today; the nightly step that marks
them clears it.
