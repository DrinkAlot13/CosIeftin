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
its own size and its own unit price. Summary — **10 clean, 20 flagged on the >2x unit-price
rule, 0 outside their window, 0 resolving to a single merchant**:

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

CLAUDE.md says not to fix a peer-relative check by tightening the threshold. So instead the
audit asks a question that does not depend on price at all: **which WORDS separate the cheap
half from the dear half**, checked against the catalog's own brand column. If they are brands
and pack sizes, the class is consistent. If a product-defining word appears on one side only,
the class merged two things.

**That found seven real merges, all now fixed:**

- **`necarbogazoasă` admitted to the SPARKLING water class** — `carbogaz` is a substring match,
  so the token that DEFINES the class also matched its negation. A still water in the fizzy class.
- flavoured waters (`afine`, `mentă`) in both water classes
- sugar SACHETS (`plic`, `baghete`), stored as 500 g exactly like a bag
- PICKLED mushrooms, in vinegar with dill, inside the tinned-whole class
- other croissant fillings — **I wrote `capsune`; the catalog writes `capsuni`**
- Manitoba flour in the tip-650 class; ground oat FLOUR in the oat-flake class

After the fixes: 0 outside window, 0 single-merchant, and every remaining spread verified as
brand premium by its own tokens.

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

**The 2x unit-price spread threshold.** It is the right instinct and the wrong instrument for
classes that admit national brands, and it fires on 20 of 30 correct classes. Reading them one
by one is not sustainable at 60 or 200 classes. **The token test is the better gate** — do
product-defining words separate the cheap half from the dear half — and it found all seven real
merges while clearing the thirteen false alarms. I would make the token test the flag and keep
the spread as context, not the reverse.

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
