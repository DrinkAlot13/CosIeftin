# Gap 2 — the user flows, performed

`npm run flow:user` · 2026-09-09 · **nobody had ever used this site**

Driven in a real browser at 1440px and 390px. The harness performs and records; the judgements
below are mine, read from the evidence in `logs/flow/`.

---

## First, what works — because it is more than I expected

**The recipe flow is the best thing on the site.** It previews before committing, and every line
says what it chose *and why*:

```
Albert Oua consum M 10 buc cod 2      — cel mai ieftin pe unitate (1,40 lei/buc) · 4 alternative
Paine alba cu maia Auchan, 500 g      — cel mai ieftin pe unitate (8,60 lei/kg) · 13 alternative
Lapte UHT integral Prodlacta, 3.5%    — cel mai ieftin pe unitate (6,99 lei/L) · 10 alternative
```

The notice reads correctly in Romanian and states the precedence honestly: *"favoritele tale au
prioritate, apoi cel mai ieftin pe unitate — și abia după aceea adaugi în coș."* Favourites do
take precedence, and the copy says so before you commit rather than after.

**The per-shop basket page is honest about what it did.** Three distinct messages, all correct:

```
Exact ce ai cerut, la Mega Image.
Nu am găsit Paine alba feliata Vel Pitar, 500 g la Mega Image. Am ales Paine rustica…
Nu se găsește la Mega Image.
```

**The account flow works end to end.** Register → `/cont`, loyalty card survives a reload, log
out → `/`, log back in → `/cont`. No console errors anywhere in the session.

---

## What would make a person give up

### 1. The emphasised card shows the worse deal

```
🏪 Cel mai ieftin într-un magazin    Mega Image   267,16 RON   are 16/20 · lipsesc 4
🧩 Cel mai ieftin împărțit           7 magazine   436,03 RON   ← this is the highlighted card
```

The split basket is **63% more expensive** than one shop, is labelled *"cel mai ieftin
împărțit"*, and carries the `best` CSS class that visually emphasises it. 111,50 RON of that is
delivery — seven online shops, seven delivery fees.

No "economisești" note appears, because the saving is negative. So the page shows two numbers,
highlights the larger one, and says nothing about why a shopper should ignore it.

**And the two numbers are not comparable anyway.** 267,16 is for **16 of 20** products; 436,03
is for **20 of 20**. Nothing on either card says they describe different baskets. A shopper
reading "one shop is cheaper" is reading a comparison that was never made.

### 2. The two pages disagree about the same basket at the same shop

Same run, same list, same merchant:

| page | coverage | total |
|---|---|---|
| `/lista` store table | **16/20** (lipsesc 4) | 267,16 RON |
| `/lista/magazin/mega-image` | **14/20** (6 lipsesc, 5 înlocuite) | 118,32 lei |

Substitution explains part of the price gap — the shop page prices the swaps, which are cheaper
— but it does not explain the **coverage** disagreement. One page says Mega Image stocks 16 of
the 20 products and the other says 14. Both cannot be right, and a shopper who clicks through
sees the number change under them.

### 3. Search returns the wrong *kind* of product for common staples

The first suggestion for a plain Romanian staple, typed the way a person types it:

| typed | first suggestion | what it is |
|---|---|---|
| `branza telemea` | Dr. Oetker Mix pentru pandispan… cu branza telemea, 175 g | **a cake mix** |
| `zahar` | Zahar pudra cu aroma de vanilie, 80 g | vanilla icing sugar, not sugar |
| `ulei floarea soarelui` | aro Ulei Floarea Soarelui **6 x 1 L** — 43,19 | a catering pack |
| `piept de pui` | Piept Pui **Crispy** cca. 2 Kg ❄ | frozen breaded, not fresh breast |
| `cafea` | Lavazza Cafea **boabe**, 1 kg — 99,99 | a kilo of whole beans |
| `apa plata` | Aqua Carpatica **Kids**, 0.25 l | a 250 ml children's bottle |
| `cartofi` | Cartofi albi **eco** 500g — 7,99 | 16 lei/kg organic, not a 2 kg bag |

Seven of twenty. `lapte`, `oua`, `paine`, `unt`, `faina`, `orez`, `rosii` and the rest are fine.
But a person building a weekly shop has to fight the box on a third of their list, and the
basket that results is not one anybody would buy.

### 4. "Similar" suggestions are ranked by price, not by similarity

Rendered under each item, with an `+ adaugă` button next to it:

```
Unt Albalact, 82% grasime, 200 g
   💡 similar: MUNTE LACT Creminos cu Unt 60% 200 g la Metro · 4,23 RON   ← a cheese spread
Lapte de consum integral Olympus, 1 l
   💡 similar: aro Bautura cu Lapte 3.2% grasime 1 L la Metro · 4,23 RON  ← a milk drink
aro Ulei Floarea Soarelui 6 x 1 L
   💡 similar: aro Bautura Carbogazoasa Aroma Lamaie si Lime 12 x 0,5 L    ← lemonade, for oil
```

Three unrelated suggestions all at **exactly 4,23 RON**. I checked whether that was a shared or
fabricated price — it is not: only 8 Metro offers sit at 4.23 (0.15%), each with its own URL and
`rawPriceText`, and 11.56 is far more common with 54. **The suggestions are simply the cheapest
thing that vaguely matched.** Offering a shopper a cheese spread as a cheaper butter, with a
one-click add, is worse than offering nothing.

### 5. One substitution swaps the vegetable

```
Cartofi albi eco România 500g  →  ECO Cartofi dulci ambalati 500 g
```

White potatoes replaced with **sweet potatoes**. The copy is honest about having swapped, which
is exactly why this matters: the page says "am ales" confidently and a shopper who trusts it
gets the wrong vegetable. (`Paste … Cornetti 500 g → penne 400 g ×2` is defensible; it doubles
the quantity, which the line does state.)

### 6. The page scrolls sideways on a phone

```
390px viewport, content 818px wide
```

**Twice the width of the phone.** The whole basket flow requires horizontal scrolling — the
store comparison table is the culprit. This produces no error anywhere and is the single most
likely thing to make a person close the tab.

Fifteen interactive elements are also under 32px, including the ones that matter most in a list:
`×` remove at **20×28**, `+ adaugă` at **53×19**, `Redenumește` at 90×23.

### 7. Autocomplete takes up to eight seconds

```
detergent vase 8012ms · hartie igienica 4085ms · cafea 3714ms · apa plata 2213ms
```

Not cold-start — these are queries 17 through 20, after the index is warm. A person types into
an empty box and waits with no spinner in the suggestion area.

### 8. Two rows offer a basket of two items

```
Kaufland          21,47 RON    3/20 (lipsesc 17)   Completează coșul la Kaufland
Kaufland (Glovo)  11,38 RON    2/20 (lipsesc 18)   Completează coșul la Kaufland (Glovo)
```

Sorted into the same table as shops carrying 16, with the same call to action. A row offering 2
of 20 products is noise in a comparison.

---

## A correction to this document's own method

**Three of the first "findings" were the harness, not the site**, and all three would have been
serious false claims. Recorded because the pattern is the same one this project keeps
cataloguing — a measurement reporting its own limitation as a property of the thing measured:

| first claimed | actually |
|---|---|
| "`lapte`, `oua`, `detergent vase` return NO suggestion" | a flat 700 ms wait. `/api/suggest` returns results for all three |
| "no 'adaugă' button on /retete" | the button says `🛒 Vezi ce alegem (5)`; "Adaugă" appears only after the preview |
| "the loyalty card is GONE after reload" | the harness typed into the **header search box** — the first non-hidden `input` on every page — and never saved a card |
| "log back in FAILED" | `/login` has **three** forms; form 0 is the header search |

Each was fixed by targeting the real control, and the site passed every one.

---

## Ranked

| # | finding | severity |
|---|---|---|
| 1 | 390px scrolls sideways — 818px in a 390px viewport | **would make a person give up** |
| 2 | The highlighted card is the more expensive option, and the two totals describe different baskets | **would make a person distrust the answer** |
| 3 | Search returns the wrong kind of product for 7 of 20 staples | **the basket is not one anyone would buy** |
| 4 | `/lista` and the shop page disagree on coverage (16/20 vs 14/20) | wrong data, visible |
| 5 | "Similar" suggests a cheese spread for butter, lemonade for oil | actively misleading, one click to accept |
| 6 | Sweet potatoes substituted for white potatoes | wrong product in a confident sentence |
| 7 | Autocomplete up to 8 s | slow enough to abandon |
| 8 | Tap targets under 32px; 2-item shop rows in the comparison | friction |

Nothing errored. No console exceptions, no broken page, no failed flow. **Every problem above is
a judgement about whether the answer is useful**, which is exactly the category the brief said
nothing had ever measured.
