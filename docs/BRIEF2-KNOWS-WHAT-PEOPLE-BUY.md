# Brief 2 — make the site behave like it knows what people buy

2026-09-09

The insight the brief is built on, confirmed by measurement before anything was changed:

```
  all grocery products comparable          7.3%      (2,835 of 39,099)
  the forty pinned staples comparable     52.5%      (21 of 40)
```

**The site is good at what people buy and thin on the long tail**, and it presented both
identically — so the part that works was invisible on first load, and a shopper browsing a
category met a wall of "1 magazin" and concluded the site was broken.

---

## 1. Search ranking — measured, and the change was REVERTED

The brief asked for merchant count as "a strong signal, not just a tie-break". I implemented it
as a bounded score bonus (saturating, capped at 0.25, below the 0.6 a head-noun match is worth so
relevance always wins), then measured it the way CLAUDE.md demands of a parser change.

**Before and after are byte-identical.** Not "similar" — the JSON output of the whole 40-query
run diffs to nothing.

```
  40-query fixture                 37/40 pass    ->  37/40 pass
  top-10 slots that are comparable    64.4%      ->     64.4%
  average merchants per slot           2.11      ->      2.11
  queries whose top result changed        0 of 40
```

**The ranker already surfaces comparable products: 64.4% of the first screen against a catalog
that is 9.9% comparable.** Relevance alone does it — the staples people search for are the
products that happen to be priced at several shops. `merchantCount` was already the third sort
key and mattered only on exact ties, which essentially never happen.

So the change was **reverted**. Shipping a modification that provably alters nothing is
complexity with no benefit, and it would have been reported as an improvement.

`npm run audit:search-comparability` is kept — it is the instrument that answered the question,
and it is the one that will notice if this stops being true.

## 2. "Doar produse comparabile" — the filter, ON by default in browse

Implemented in `SortableProductGrid`, **client-side**, and that is not an implementation detail:
reading `searchParams` makes a page dynamic in Next 14, which is exactly why sorting moved to the
browser in the first place. A `?comparabile=` link would undo the caching that makes category
pages fast.

- **ON for category browsing.** Someone browsing has not named a product, so the useful default
  is the set the site can answer a question about.
- **OFF for search.** Someone who typed a product name wants that product, even at one shop.
  Hiding it would answer a question they did not ask.
- **Nothing is hidden permanently.** The toggle sits in the toolbar, its tooltip says how many
  products it is holding back, and one click restores them.
- **The count above the list reflects the filter, always** — it now reads `sorted.length`, not
  `products.length`. A heading saying 966 above a list of 74 is the same class of defect as a
  price that is not the price.
- The empty state is specific: *"Niciun produs din această categorie nu are preț în două
  magazine acum. Scoate filtrul ca să le vezi pe toate."*

## 3. The homepage leads with what works

Order is now: **biggest price differences → the basket → categories** (was: categories first).

### 💸 Cele mai mari diferențe de preț

**The bounds are the interesting part, and the first version was wrong.**

Ranking by absolute lei saved, with only a wide ratio cap, returned: brandy, dishwasher tablets,
**five coffees**, three detergents, caviar. Every row individually correct, and every one of them
"2 magazine" with an 80–90% gap.

Two problems, both fixed:

1. **With exactly two prices there is no median.** One cheap row and one dear row are as likely
   to be two different products under one name as a bargain — CLAUDE.md's peer-median section is
   about precisely this, and the homepage is the worst place to publish that ambiguity. A
   two-shop product must now be within 50%; three or more shops, where a middle price exists to
   make the outer ones legible, may go to 70%.
2. **Absolute lei favours expensive goods**, which is why it returned seven coffees. At most two
   products per category now. This does not claim to know what people buy — the next section is
   the one that does — it just refuses to spend the whole shelf on one aisle.

The result is varied and plausible: detergent, coffee, pork, feta, razors, shower gel, olive oil,
at 14–63% spreads.

### 🧺 Coșul de bază

The forty pinned staples, each with its cheapest shop and what it costs elsewhere. **This is the
site's strongest surface — 57.5% of these compare across two or more shops — and nothing on the
homepage linked to it.** Now the second section, linking to `/index-cosmic`.

A line whose slug no longer resolves is returned with nulls rather than dropped, because dropping
it would quietly shrink the basket — the exact failure `lib/index-basket.ts` exists to prevent.

The search box stays where it was, at the top of the hero.

## 4. Every product page says what it can and cannot do

"1 magazine" is a number, not an explanation, and it reads as a broken site — which is the wrong
conclusion most of the time. There are two genuinely different reasons a product sits at one
shop, and they now get different sentences:

**Own brand** — read from the `isPrivateLabel` attribute the substitution engine already uses, so
the page and the optimizer cannot disagree:

> ℹ️ **Doar Mega Image** vinde acest produs dintre magazinele urmărite — este marca proprie a
> magazinului, așa că nu are preț de comparat în altă parte.

**Everything else:**

> ℹ️ Momentan doar un magazin are un preț pe care ne putem baza pentru acest produs. Mai jos
> găsești produse echivalente pe care le poți compara.

The second sentence changes depending on whether equivalents exist, so it never promises a
section that is not there. Saying "doar un magazin" for an own-brand product implies we failed to
find the others; saying it for a national brand is honest. **That distinction is the whole point
of the copy.**

---

## What this does not fix

- **The long tail is still the long tail.** 6.3% of the catalog is comparable. This work makes
  the good part findable; it does not make the tail comparable, and Brief 1 measured that adding
  shops barely moves it.
- **Search relevance is untouched.** Gap 2 found that 7 of 20 staples return the wrong *kind* of
  product first (`branza telemea` → a cake mix). That is a separate defect and a bigger one than
  ranking.
- **The 390px horizontal scroll is untouched** — 818px of content in a 390px viewport, from the
  store comparison table on `/lista`. Still the single most likely thing to make a person leave.

---

## A defect found while verifying item 4: `ProductAttribute` is EMPTY

The own-brand sentence reads from `ProductAttribute` where `key = "isPrivateLabel"`, the same
place the substitution engine reads it. Verifying the copy against real data turned up nothing —
so I checked the table:

```
ProductAttribute keys:
  (none)
isPrivateLabel=true rows: 0
```

**The table has no rows at all.** Consequences, in order of importance:

1. **`preferPrivateLabel` in the optimizer can never fire.** `lib/substitution/pick.ts` has
   `else if (ctx.preferPrivateLabel && chosen.product.isPrivateLabel) basis = "PRIVATE_LABEL"`,
   and `load.ts` derives that flag from this table. The branch is unreachable, so a shopper who
   asks to prefer own-brand products gets the ordinary cheapest-per-unit answer and no
   indication that their preference did nothing. **This predates my change.**
2. **My own-brand sentence is correct and currently unreachable.** It is left in place because
   the condition is right and the copy is right; it will start rendering the moment anything
   populates the attribute. It is NOT verified against live data and must not be reported as
   working.
3. The other branch — *"Momentan doar un magazin are un preț…"* — is verified rendering on a
   real page:

   ```
   Lapte de consum integral Napolact, 3.5% grasime, 1.5 l
   ℹ️ Momentan doar un magazin are un preț pe care ne putem baza pentru acest produs.
      Verificăm zilnic — dacă apare în alt magazin, îl vezi aici.
   ```

This is the project's recurring defect in its purest form: **a value never observed, read as an
observation.** Two call sites branch on a flag that is false everywhere, and nothing said so.

## Verification, by rendered output

Screenshots in `logs/flow/b2-*.png`, at 1440 and 390.

```
homepage section order   💸 diferențe → 🧺 Coșul de bază → Categorii → 📉 scăderi → populare
/c/lapte toolbar         "18 produse  ✓ Doar produse comparabile"
first spread card        /p/detergent-grandios-mountain-spring-40-capsule
one-shop copy            renders, in Romanian, on a real product page

390px  /          content 390px in 390px   ok
390px  /c/lapte   content 390px in 390px   ok
390px  /lista     content 390px in 390px   ok  (EMPTY basket)
```

**A correction to the Gap 2 finding, now that it is measured more precisely.** Gap 2 reported
"/lista scrolls sideways at 390px, 818px of content". That is true only once the basket HAS
ITEMS — the store comparison table is what overflows, and it does not render on an empty list.
An empty `/lista` at 390px is fine. The defect is real and the condition was missing.
