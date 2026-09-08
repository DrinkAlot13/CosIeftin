# Why three of Romania's most stocked products show "1 magazine"

Phase 1 diagnosis, 2026-09-08. **No code written, nothing built.**
`npm run trace -- "<term>" [--size= --unit=]` reproduces every figure below.

## The answer, up front

**It is not candidate selection. It is not a rule rejection. It is DUPLICATE CATALOG ROWS.**

The candidates exist, they were found, and they matched — onto *different catalog products*. Each
row then reports its own shops perfectly honestly, and the shopper sees "1 magazine" on every one
of them.

    Napolact Lapte 3.5%, 1 L / 1.5 L   spread across  11 catalog rows
    Almette crema de branza            spread across  16 catalog rows

**And one finding overturns a proposal I made yesterday — section 4.**

---

## 1. Do other merchants carry it? Yes, all of them.

For Napolact 3.5% at 1.5 l alone:

    #2       "Lapte de consum integral Napolact, 3.5% grasime, 1.5 l"   ean 5941065015194
             metro 12,69                                                     LIVE SHOPS: 1
    #103305  "Lapte 3.5% grasime 1.5L"   brand=Napolact
             mega-image 15,99 · freshful 12,99 · metro 12,69                 LIVE SHOPS: 3
    #46085   "Napolact Lapte 3.5% PET 1,5 l"
             sezamo 16,29                                                    LIVE SHOPS: 1

Three catalog rows, one real product. The row a shopper is most likely to land on — **#2, the one
carrying the EAN** — shows one shop, while a sibling row shows three.

**Metro's single offer at 12,69 is attached to BOTH #2 and #103305.** That is the same
duplicate-attachment shape found on the Colgate toothpaste yesterday, so it is not a one-off.

## 2. Where did each candidate go? They matched — elsewhere.

Not "never considered". Not "rejected". For Napolact 3.5% around 1 l:

    #46049   Napolact Lapte fara lactoza 3.5% cutie 1 l   {sezamo, glovo-kaufland}
    #44719   Napolact Lapte 3.5% 1 L                      {glovo-kaufland}
    #70221   Napolact Lapte Uht Cutie 3,5% 1L             {glovo-kaufland}
    #104490  Lapte UHT 3.5% grasime 1L                    {carrefour}
    #5       Lapte de consum integral Napolact 3.5% 1 l   {…}
    … 11 rows in total, for one product in two sizes

Worse: glovo-kaufland's **single store item** `"Napolact Lapte 3,5% 1L Cutie"` is attached to
**three** catalog products — #44719, #46049 and #70221 — and #46049 is *fara lactoza*, a genuinely
different product. The same offer is simultaneously duplicated and mismatched.

**The naming split that causes it.** Merchants name one product three incompatible ways:

    brand-leading        "Napolact Lapte 3,5% Grasime 1,5 L"       metro, sezamo, glovo-kaufland
    description-leading  "Lapte 3.5% grasime 1.5L"                 mega-image, freshful
    treatment-leading    "Lapte UHT Napolact 3.5% grasime 1L"      carrefour

`addNew` creates a catalog row from whichever wording arrives first; the next merchant's wording
does not match it, so a second row is created. Repeat per merchant.

Almette shows the same shape at 16 rows — with a wrinkle worth noting: some of those 16 are
*genuinely* different (ceapa verde, verdeata, hribi, fara lactoza). The duplicates inside it are
pairs like `#44635 "Almette Crema de Branza cu Smantana 150 g"` against
`#103299 "Crema de branza proaspata cu smantana 150g"`, and
`#8 "Crema de branza cu smantana Almette, 250 g"` against
`#103297 "Crema de branza proaspata cu smantana 250g"` — **the second pair are both Sezamo**, so
one merchant's own two prices cannot compare with each other.

## 3. Did the duplicate detector catch it? No — and it cannot.

    duplicate-product rows in the queue                    500
    …mentioning Napolact, Almette or Caimac                  0

The detector prints its own criterion in every row it writes: *"Same token bag and size"*. It is
built to find pairs like `"Salata icre de crap cu ceapa Auchan, 70 g"` against the same string —
**typo-level** duplicates.

Napolact's duplicates have completely different token bags: `{lapte, consum, integral, napolact,
grasime}` against `{lapte, grasime}`. This is a **vocabulary-level** duplicate. The detector is
not broken; it was built for a different problem and nobody noticed the gap between them.

## 4. Is `mutually-distinct` blocking these? YES — and that reverses yesterday's proposal.

    carrefour  "Lapte UHT Napolact 3.5% grasime 1L"   mutually-distinct  0.50
        would attach to #5 "Lapte de consum integral Napolact, 3.5% grasime, 1 l"

Same brand. Same fat. Same litre. **That is a correct match, and it is blocked**, because each
side carries a significant token the other lacks:

    carrefour only:  uht
    catalog only:    de, consum, integral

The rule is doing exactly what it is specified to do. The problem is that Romanian dairy naming
describes one product as "UHT" at one shop and "de consum integral" at another. Those are two
vocabularies for the same attribute, not distinguishing features.

**So the 0% false-block figure over 102 pairs did not miss a rare edge case. It never sampled
this class.** It answered *"does mutual distinction wrongly block products whose names differ by a
flavour or a variant?"* — and the answer to that really is no. It did not answer *"does it wrongly
block when two merchants use different vocabularies for the same attribute?"* — and the answer to
that is yes.

### THEREFORE: do NOT implement `mutually-distinct` → REJECT

I proposed that yesterday, and today's evidence says it is wrong.

Right now those pairs sit unreviewed in a queue, which is useless but recoverable. Converting them
to REJECT makes the block **permanent and invisible** — and it would do that to the correct
Napolact match above.

The queue-size problem is real and this is not its fix. What 70,593 `mutually-distinct` rows
actually measure is **how often the rule fires on a class it should not**. Fixing the rule shrinks
the queue as a consequence; re-banding it only destroys the evidence that the rule needs fixing.

---

## What this means for the AI proposer

Phase 2 is still worth measuring, but Phase 1 has already moved its likely answer.

The failure here is **not** "an LLM would judge these pairs better than the matcher". The matcher
was never asked. It matched each merchant's wording to a different row, and no rule was ever
given the question *"are rows #2 and #103305 the same product?"* — because nothing compares
catalog rows against each other. Only store-item-against-catalog-row.

That is a **catalog consolidation** problem, and a deterministic pass can find these: same brand,
same unit and size, non-contradicting variant tokens, different rows. An LLM might help rank the
survivors; it is not needed to find them.

## Recommended order

1. **A cross-vocabulary duplicate detector**, comparing catalog rows against each other rather
   than store names against rows. Same brand, same unit and size, no contradicting variant token.
   That finds the Napolact and Almette families without judging language.
2. **Fix `mutually-distinct` for descriptor asymmetry** — a small set of tokens that describe an
   attribute rather than distinguish a product (`uht`, `de consum`, `integral`, `proaspat`,
   `pet`, `cutie`). Golden set as referee, plus a full-catalog diff, per CLAUDE.md's blast-radius
   rule.
3. **Then Phase 2**, to measure what remains across 500 branded products — against a matcher that
   is no longer making this specific mistake, so the number means something.
4. **Then decide about the LLM**, against a gap that is known rather than assumed.

On the 50%: after this, I would not guess. If the Napolact family is representative, a
deterministic consolidation plus one rule fix could close a large part of it with no model at
all — and that is both cheaper and reversible in a single query, which an LLM's judgement is not.

---

# Phase 1b — I tried both steps and both failed. Two negative results.

Written the same day. **Report before doing anything else with the upper bound**, as instructed —
and it is as well, because the number came out the wrong way round.

## Negative result 1 — the merge upper bound is NEGATIVE

`npm run audit:catalog-duplicates`, grouping on brand + unit + size with no contradicting
discriminator (fat, BIO, lactose, flavour):

    live products (with a price)                        43,002
    groups of 2+ rows that could be one                  6,033
    rows inside such a group                            26,396

    comparable in 2+ shops, TODAY                        2,830
    comparable if EVERY group merged (upper bound)       2,795
    change                                                 −35

**Merging on that criterion would make the site worse.** The Barilla group shows why: **53 rows
at 0.5 kg in one group** — Fusilli, Penne, Lasagne, Spaghetti, Farfalle, Linguine, Gnocchi,
Maccheroni. Different pastas. My discriminators covered fat, BIO, lactose and flavour; nothing in
them knows that a pasta SHAPE names a different product, so nothing contradicted.

Those 53 rows are **already** comparable — several at 3 and 4 shops each. Collapsing them into one
row destroys about twelve comparisons and creates one. Hence −35.

We were both right that a merge upper bound is easy to guess wrong, and it went the opposite way
from the one we hoped.

## Negative result 2 — the descriptor/identity split cannot be mined from the corpus

The obvious correction is to learn which tokens name a product (`fusilli`) and which merely
describe one (`uht`). `npm run audit:descriptors` measures, within brand+size cohorts, how many
distinct siblings each token co-occurs with and how many rows per cohort carry it — on the theory
that a name excludes its siblings and a description sits with anything.

**It does not separate them:**

    token          rows  cohorts  siblings  rows/cohort
    uht             104       41        84         2.54     ← description
    penne            55       33        55         1.67     ← identity
    fusilli          40       24        33         1.67     ← identity
    integral         81       55       114         1.47     ← description
    cutie            85       55       152         1.55     ← description

`uht` and `penne` sit in the same range. `integral` has *more* siblings than `penne`. And the
ranking's own top of "most description-like" is dominated by **head nouns and brand names**:

    vin 858 · par 922 · dinti 660 · gel 853 · crema 1219 · nivea 232 · dove 241 · loncolor 93

Those are the opposite of descriptions. The metric is measuring how common a word is, not what
role it plays. Confounded, and not rescuable by tuning the weights.

## What both failures mean

**Whether `uht` describes a milk or names one is a fact about groceries, not a property of the
corpus.** Within one brand and size, Barilla makes one Penne and one Fusilli, and Napolact makes
one UHT and one "de consum" — statistically identical shapes, opposite meanings. The signal is
not in the data because the distinction was never encoded in it.

That is exactly the limit written into CLAUDE.md yesterday under **"SOME DEFECTS HAVE NO
AUTOMATED DETECTOR"**, arriving one day later in a new place.

## Which changes the case for the LLM — and sharpens it

This is the first genuinely good argument for a model in this project, and it is for a **much
smaller job** than Phase 3 proposed.

**Not** "judge whether these two products match", per pair, at catalog scale, forever — that is
the Zarea risk and it needs a verifier for every one of its outputs.

**Instead:** answer one bounded language question, once. *"In Romanian grocery names, is `uht` a
description of an attribute or the name of a product variant?"* A few hundred tokens, drawn from
the ones that actually cause blocks. The output is **a list, checked into the repository as
data** — reviewable in one sitting, diffable, revertible, and gradeable by the golden set before
it touches anything.

A wrong entry in that list is visible on the page in a code review. A wrong per-pair judgement is
visible only when somebody drives to a shop.

## Recommended next step, revised

1. **Mine the CANDIDATE tokens from the blocked pairs** — the tokens that actually cause
   `mutually-distinct` to fire, ranked by how many blocks each one causes. That part is
   statistical and works; it narrows a 30,000-word vocabulary to the few hundred that matter.
2. **Have a model classify only those**, into description / variant-name / unsure.
3. **Read the list.** It is small enough to read.
4. **Then** apply it in both places — `mutually-distinct` stops blocking on descriptor asymmetry,
   and the duplicate detector gains the shape/variant knowledge it lacked — and re-measure the
   upper bound, which is currently meaningless.

Nothing in steps 1–4 lets a model write an offer, a match, or a price.
