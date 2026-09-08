# Phase 2 — how big is the matching gap, and does a model close it?

`npm run audit:brand-gap` · read-only · 2026-09-08

The brief: *"Take the 500 most widely stocked branded grocery products we carry. For each: how
many merchants do we show, and how many have a store product that plausibly IS it? Report the
gap. That number is the real size of the problem, and it tells us whether an AI reviewer is worth
building or whether a bug fix closes most of it."*

Run at 500 first, then at full breadth — **6,939 targets**, every branded grocery product of a
brand seen on four or more shelves. The numbers below are the full-breadth run.

---

## The headline

```
                                        SHOWN    ACCEPTS  PLAUSIBLE
  merchants per product, summed          8612       8613      11686
  products comparable (2+ shops)         1253       1253       2657
  products showing ONE shop              5686
```

- **SHOWN** — merchants with a live offer on that exact catalog row. What the site displays.
- **ACCEPTS** — plus merchants whose store product the **current rules already accept**.
- **PLAUSIBLE** — plus every candidate passing a generous pre-filter, whatever the rules say.

**The gap the current rules already accept is ONE pair, across 6,939 products.**

Not one percent. One. There is no bug fix sitting in the data waiting to be collected, because
the rules are not malfunctioning — they are refusing these pairs on purpose.

## The answer to the question that was asked

> does a bug fix close most of it, or is an AI reviewer worth building?

**Neither, and the numbers say why.**

A bug fix cannot close it, because 3,068 candidate pairs are refused and every refusal is a rule
firing as designed. The largest bucket is `mutually-distinct` at 1,800 — the rule CLAUDE.md calls
decisive — and reading the refusals shows it is mostly right:

    Pate de pui Bucegi, 120g        vs  Pate porc cu unt 120g       chicken is not pork
    Pate de porc 200g               vs  Pate vegetal Bucegi, 200g   meat is not vegetable
    BUCEGI Carne Porc 300 g         vs  Carne de curcan 300g        pork is not turkey

An AI reviewer would therefore be pointed at exactly those 1,800 pairs and asked to overturn the
decisive rule — the one place where a wrong "yes" publishes one product's price on another. That
is the worst possible first job for a judge whose errors we cannot see.

**And the ceiling bounds both.** If every plausible candidate were accepted — including the pork
and the turkey — comparability across these 6,939 products would go from 1,253 to 2,657. Even
then **62% would still show one shop.** Matching is not what is keeping them there. Different
merchants stock different products, and no rule change reaches that.

## Why the rules refuse — the full table

```
  mutually-distinct          1800
  head-noun                   353
  brand                       353
  low-overlap                 287
  pack-shape                   93
  variant-flavour              75
  variant-mismatch             66
  dose-mismatch                13
  size                         12
  variant-qualifier            11
  variant-fat                   5
```

Two of these buckets are contaminated by defects, and both were found by reading the refusals
rather than by any check.

---

## Defect 1 — the head-noun gate compares the BRAND at brand-first names

`headNoun` is `sigTokens(nname)[0]`, the first significant token, and its comment states the
assumption out loud:

> The catalog item's anchor noun = its first significant token (**RO names are noun-first**).

Measured: **1,885 of 6,939 branded grocery targets (27.2%) lead with the brand**, so their "head
noun" is `bucegi`, `chio`, `poiana`. `decide()` then demands that word in the merchant's own name
**before the brand gate runs**, and returns REJECT.

**327 of the 353 head-noun refusals (92.6%) are at brand-first rows.**

    BUCEGI Carne Porc 300 g                  vs  Carne de curcan 300g
    CINI MiNiS Cereale cu Scortisoara 250 g  vs  Cereale cu scortisoara, cu vitamine…
    Poiana Ciocolata Lapte si Stafide 90 g   vs  Ciocolata cu alune si stafide 90g
    Chio Hula Hoops Inele Cascaval 70 g      vs  Pufuleti crocanti cu aroma de cascaval Hula…

This compounds with the brand-in-name survey from earlier today: a brand-first catalog row meeting
a merchant that omits brands from its names (Mega Image 1.8%, Freshful 2.2%) is refused for a
reason that has nothing to do with what the product is.

This is the project's recurring defect wearing new clothes: **an assumption written in a comment,
never observed, wrong for a quarter of the data.**

### What the fix is worth — simulated, not applied

Candidate change: the brand has its own column, so strip brand tokens out of the NAME used for
matching. `headNoun` then returns the real noun and the brand gate still has `nbrand`.

Simulated by rewriting the catalog name and re-running the **whole** `decide()` pipeline — not one
gate, which is how the descriptor work projected 2,097 and delivered 5.

    refused pairs re-decided        3068
    now MATCH                        275

**Do not spend this number.** It is an upper bound and the sample already shows leaks:
`Ciocolata cu lapte Milka, 90 g` against `Ciocolata aerata cu lapte 90g` is Milka Bubbly, a
different bar; `Apa plata minerala San Benedetto` against a brandless `Apa plata 500ml` cannot be
verified at all. The golden set is the referee and it has not been run against this change.

**The simulation had two bugs of its own before it produced even this number**, both worth
recording because both flattered the result:

1. It normalised the stripped name, and `normalizeRo` removes `%`. `doseTokens` reads strength out
   of `raw`, so the dose gate was switched off and `Iaurt grecesc Olympus 10%` "matched"
   `Iaurt grecesc 2%`. Fixed by stripping brand words while leaving the survivors' spelling alone.
2. It fed `decide()` a store name truncated to 58 characters for display.

Together they inflated 275 to 285.

---

## Defect 2 — the flavour class is the one comparison that is not fuzzy

`variant-classes.ts` lists the singular and the plural of the same fruit as **separate values** —
`portocale` and `portocala`, `capsuni` and `capsuna`, `mar` and `mere` — and `variantConflict`
compares them by exact set membership. Two merchants using different numbers of the same fruit
therefore contradict each other:

    Suc de portocale Olympus, 0.5 l      vs  OLYMPUS Suc de portocala 500 ml
    Bautura … cu aroma de piersica       vs  Băutură necarbogazoasă piersici, ceai negru 1.5l
    STRONGBOW Gold Cidru Mere SGR 0,33 L vs  STRONGBOW GOLD MAR CIDRU 4,5% 0,33 L ST SGR

CLAUDE.md, on the matcher: *"Token equality is fuzzy: comprimate/compr., capsule/caps,
paprica/paprika. Treating those as distinct rejected genuinely identical products."* The flavour
class is the one place that does not follow it.

It also raises a hard **REJECT before anything is scored**, so these never reach the review queue,
and no audit has ever seen one.

**Blast radius: small.** 4 pairs of 91 variant refusals in this population, and one of those four
is a false positive of the detector (a multi-fruit juice where `mar`/`mere` matched but the other
fruits genuinely differ). So three real cases here. The fix is cheap — canonical groups instead of
a flat set — but it is not worth a headline, and nothing above depends on it.

---

## What this measure cannot see

**The pre-filter needs the brand somewhere**: on the catalog row, or in the merchant's own name.
Where a merchant omits the brand AND the row it landed on has none, the candidate is invisible.

    no brand on the row AND none in the merchant's own name:  2,925 of 34,430 live offers (8.5%)
      sezamo 1,909 · glovo-kaufland 501 · mega-image 130 · kaufland 120 · freshful 70 · auchan 69

Every figure above is a **floor**, and most of a floor at the merchants the brand-in-name survey
named this morning.

**The brand assumption runs the other way and strengthens the headline.** `Offer` has no
`storeBrand` column, so the store side of each comparison was given the brand of the catalog row
it currently sits on — generous, because it makes the brand gate easier to pass. `ACCEPTS = +1`
survived that generosity.

## How the targets were chosen, and why it matters

Selecting on "biggest gap" measures the selection; selecting on "most shops" picks what already
works. Both answer a question nobody asked.

So selection ran on **brand ubiquity** — how many distinct merchants mention this brand anywhere
in their own product names. A property of the brand, taken from merchants' words, independent of
any individual product's gap. Products were then taken one per (brand, head noun, unit, size), so
the eleven Napolact rows enter as one target rather than eleven.

## Three versions of this script, two of which were wrong

Recorded because the wrong ones were plausible and produced confident numbers.

| version | test for "is this the same product" | what it reported |
|---|---|---|
| 1 | brand + head noun + size | `Pate de pui` = `Pate porc cu unt`. +123 products. |
| 2 | + no variant-marker asymmetry | still `Iaurt grecesc 10%` = `2%`, `Pate de pui` = `Pate de pui cu trufe`, `Surasul Soarelui` = a correctly-attached Unisol oil. +49. |
| 3 | `decide()`, the real matcher | **+1** |

`pui`, `porc`, `curcan` and `vegetal` are not variant markers and should never be — that list is
deliberately narrow. Numbers are dropped before tokenisation, so `10%` against `2%` is invisible
to any token test. Both are handled by `decide()`, and neither by an approximation of it.

**A third gate exists for the same reason.** An offer attaches to exactly one catalog row, so if
it already sits on a row it fits better than ours, the merchant is not missing our product — it is
selling that one. Without that check, `Ulei de floarea-soarelui 1L`, correctly attached to the
Unisol row, counted as evidence that Mega Image stocks `Surasul Soarelui`, because `soarelui` is
both a brand word and a common noun.

## Recommendation

1. **Do not build the LLM proposer yet.** Its candidate space is 1,800 `mutually-distinct` pairs,
   and the rule is right about most of them. Adding a judge there risks the one error class this
   project ranks above all others, to chase a ceiling of 1,404 products that even a perfect run
   would leave 62% of these products showing one shop.
2. **Fix the head-noun gate**, under the full protocol: golden-set pairs added first, then the
   change, then the full-catalog diff. Upside is bounded by 275 pairs and will be less.
3. **Fix the flavour synonyms** — cheap, safe, worth three matches.
4. **The real ceiling on comparability is merchant overlap, not matching.** That is a sourcing
   question, and no amount of matcher work reaches it.

---

# Both fixes applied and refereed — 2026-09-08

Golden-set cases were added **before** either fix, so both are graded rather than tuned.

| | golden set | false matches | queued pairs that now match |
|---|---|---|---|
| baseline, with the 7 new cases | 94.6% (227/240) | 1 | 938 |
| + brand-aware head noun | 95.0% (228/240) | 1 | 930 |
| + flavour folding | **95.0% (228/240)** | **1** | 930 |

903 tests pass. False matches stayed at 1 against a ceiling of 2.

## 1. The head-noun gate

`headNoun` now returns the first significant token that is **not part of the brand**. The brand
is a known field on both sides; excluding it is not a heuristic.

**It had to change in two places, and the second is the one that mattered.** `decide()`'s gate
was the visible defect. But `matchPoolToCatalog` indexes store items by token and looks each
catalog row up **by its head noun** — so a brand-first row asked the pool for items containing
its BRAND, and at Mega Image (1.8% of names carry one) those items do not exist. The pair never
became a candidate and no rule ever got to weigh in.

### What it did, measured three ways

**Refusal reasons** — `head-noun` refusals fell **353 → 41**. The unblocked pairs did not become
matches; they met `mutually-distinct` instead (1,800 → 2,041), because the brand token sitting
*inside* the name is still counted as content by every token rule.

**The queue** — 938 → **930** matches. A small net LOSS, and it is not a regression: the queue
holds only pairs that became candidates under the OLD index, i.e. pairs where the merchant DID
write the brand. On exactly those, the new rule is strictly harder. The population is selected by
the thing being changed.

**Candidate reach** — the half the queue cannot see. `npm run audit:candidate-reach` rebuilds the
index and asks each row for candidates under both head nouns: **835,349 pairs newly reachable, 4
of which `decide()` accepts.**

### The measurement changed the design

Swapping the index key was a net loss: **1,095,490 pairs would have become unreachable** against
835,349 gained. Indexing a brand-first row on its brand was not purely a bug — asking the pool for
`milka` returns a tightly brand-scoped candidate set; asking for `ciocolata` returns every
chocolate in the shop. So candidate selection now takes the **union of both head nouns** and loses
nothing. The gate uses the brand-aware one, which is where the defect always was.

### Comparability, before and after

**1,253 → 1,253 products comparable in 2+ shops, across 6,939 targets. No change.**
Accepted gap pairs went 1 → 4.

The simulation said 275. It delivered 3 additional accepted pairs and **zero** additional
comparable products. The simulation modelled the gate in isolation; in the whole pipeline the
pairs it unblocked immediately met `mutually-distinct`. This is the second time a single-gate
projection has overstated a matcher fix by two orders of magnitude — the descriptor work
projected 2,097 and delivered 5.

**The fix is still right.** It removes a rule that was refusing pairs for a reason unrelated to
what the product is, it improves the golden set, and it adds no false match. It is simply not
worth what the projection implied, and the projection was the thing at fault.

## 2. Flavour folding

`variantConflict` compared flavour values by exact set membership over an inflected language.
Now compared through a canonical form. **Flavour-synonym refusals: 4 → 0.**

**Every merge, enumerated** — this is an explicit list, never a stemmer:

    afine = afina        capsuni = capsuna    mure = mura          portocale = portocala
    alune = aluna        cirese = cireasa     pere = para          struguri = strugure
    banane = banana      mere = mar           piersici = piersica  visine = visina
                                                                   zmeura = zmeure

A stemmer is actively dangerous here: **`mure` (blackberry) and `mere` (apple) are one letter
apart**, and `para` (pear) is a prefix of `paprica`. `tests/variant-flavour-folding.test.ts`
pins those apart, along with `lamaie`/`lime` and `visine`/`vanilie`, and asserts that folding
collapses exactly these groups and nothing else.

The missing singular forms were added to the flavour vocabulary while I was in there, which makes
the class fire slightly more overall (`mutually-distinct → variant-flavour` 1,771 → 1,805): those
are pairs where both sides state a flavour and the flavours differ. Correct blocks.

---

# A third defect, found while measuring the second — NOT fixed

`npm run audit:brand-substring`

The brand gate is the strongest thing between a shopper and one product's price on another:

    const brandHit = branded && (st.nbrand.includes(cat.nbrand) || st.nname.includes(cat.nbrand));

Both tests are **substring containment on a normalised string, not token equality.** `aro` is
Metro's private label, and `aroma` contains it. Demonstrated end to end, with a control:

    catalog "aro Dropsuri Menta 75 g" [brand aro]
      vs "Dropsuri de menta 75g"           REJECT  brand   <- correct
      vs "Dropsuri cu aroma de menta 75g"  MATCH   1.00    <- the word "aroma" did that

    catalog "aro Detergent de Vase Lamaie 500 ml" [brand aro]
      vs "Fine Life Detergent de Vase cu Aroma de Lamaie 500 ml"   MATCH 0.87

The last publishes one private label's price on a **different** private label's product.

**Blast radius: 25 of 22,932 live branded non-EAN offers (0.11%).** Live and wrong today:

    carrefour  brand "Fort" found inside "fortuna"
      we say:   Cafea macinata si prajita Fort, 500 g
      they say: Cafea prajita si macinata Fortuna Crema, 500g

**Why it is not fixed here: the obvious fix loses more than it gains, and the choice is yours.**

| rule | blocks `aro`/`aroma`, `Eti`/`petit` | keeps `Wella`/`wellaflex`, `Spira`/`spiral`, `Muller`/`mullermilch`, `OMO PROF`/`OMO PROFESSIONAL` |
|---|---|---|
| whole word only | yes | **no — breaks all four** |
| match at a word boundary | no — `fortuna` and `aroma` both start with the brand | yes |

Neither is clean, because four of the 25 are brand fields that are legitimate *prefixes* of the
real word. `Fort`/`Fortuna` is not reachable by any string rule at all — it needs the overlap
rules, and `difference()` treats `fort`/`fortuna` as counterparts because it is deliberately
fuzzy about prefixes.

A defensible option is whole-word on the NAME clause only, keeping `st.nbrand.includes(...)` as
the escape hatch for sub-brands — but whether the four prefix cases carry a store brand field is
not knowable from `Offer`, which has no `storeBrand` column. That needs a scrape to answer.
