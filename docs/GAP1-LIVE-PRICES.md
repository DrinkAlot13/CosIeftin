# Gap 1 — the live price comparison

`npm run probe:live-prices` · 2026-09-09 · **never run before this session**

The brief: *"Internal consistency is proven: 46,414 of 46,414 prices re-derive from their own
`rawPriceText`. That says nothing about whether they match what the shop charges today."*

---

## The headline

**22 of 23 comparable offers agree with the shop's own page. 95.7%.**

```
  merchant          agree  DISAGREE  unread  skipped   accuracy
  dcneu                 7         0       0        0   100% of 7
  sezamo                5         0       0        0   100% of 5
  mega-image            3         1       0        0    75% of 4
  carrefour             3         0       0        0   100% of 3
  auchan                3         0       0        0   100% of 3
  finestore             1         0       0        0   100% of 1
  metro                 0         0       4        0   not measured
  freshful              0         0       2        0   not measured
  farmaciatei           0         0       0        1   not measured
```

**7 of the 30 contributed nothing either way** — 6 pages published no structured price, 1 path is
disallowed by `robots.txt`. Those are reported separately and never counted as agreement. A page
we could not read is unmeasured, and folding it into a pass rate is how a check comes to mean
nothing.

**Metro and Freshful are entirely unmeasured.** Neither publishes a structured price a crawler
can read, so this oracle is blind to two merchants and 8,227 live offers. That is a limit of the
instrument, not a finding about them.

## How it avoids being a mirror

**It does not use any scraper's selectors.** Reading a price back with the code that wrote it
proves only that the code agrees with itself — CLAUDE.md's corollary about a scraper reporting
"0 rejected". The price is read from the structured data merchants publish for search engines:
JSON-LD `Product`, `product:price:amount`, `itemprop="price"`. Those are written for Google, and
a merchant that changes its DOM rarely changes them the same day.

`parsePrice` *is* used for string → bani, deliberately: one price parser is a project rule, and a
second one here would be the defect this codebase has already paid for twice. What is independent
is **where the string comes from**, which is the thing under test.

30 requests, one host at a time, 2 s apart, `robots.txt` fetched and honoured first.

---

## The one disagreement, diagnosed — and it is not staleness

```
offer 480057 [mega-image]   ours 25.19   theirs 35.99   observed 0.8 days ago
Fleica fara os si fara soric, marinata
```

The obvious diagnosis is a price change we have not re-scraped. It is not. Mega Image's own
stored payload — the record we captured at scrape time — carries **both numbers**:

```
PriceLabel1: "+/- 25.19 LEI"     PriceLabel2: "+/- 0.700 Kg"     Price: 35.99

35.99 lei/kg  ×  0.700 kg  =  25.193  →  25.19
```

**It is a variable-weight product.** 35.99 is the price per kilogram; 25.19 is the approximate
price of a typical ~700 g piece. Neither number is wrong. We stored the piece price against a
product whose size is `1 buc`, with `pricePerUnit` at 0.

Why that is worse than a wrong number would be:

- the shopper sees `25,19 lei` with nothing saying it is roughly 700 g, or that what they pay
  depends on the piece they are handed at the counter;
- **it cannot be compared.** Another shop quotes pork belly per kilogram. A `buc` with no weight
  is outside the per-unit comparison this entire site exists to perform.

### Blast radius — `npm run audit:variable-weight`

```
live offers carrying a source payload            48,616
...whose payload says "+/-" (approximately)         263   (0.54%)

  mega-image   174      ALL of them: no unit price, filed as "buc"
  auchan        89      weight parsed correctly from the name ("+/- 300 g" → 0.3 kg)
```

Auchan states the approximate weight in the product name and our size parser reads it. Mega Image
puts it in a payload field nothing reads. **174 live offers**, one merchant, one field.

Not fixed here. What a variable-weight offer should show — quote per kilo, show the approximate
weight, or withhold it from comparison — is a product decision, and those three are not
equivalent.

---

## Two further defects, found by pulling on that thread

### `npm run audit:unit-price-sanity` — 28 impossible per-unit prices, live now

The per-unit price is what this site is for, and 28 of them are numbers no one could believe.

```
   86,500,000 /kg    86.50 lei for 0.000001 kg   Spray oral cu nicotina, 1 mg
   14,153,846 /kg   184.00 lei for 0.000013 kg   Colagen Lichid hidrolizat, 12.500 mg
    9,500,000 /kg    19.00 lei for 0.000002 kg   Solutie contra aftelor, 2,425 mg/21,34 mg/ml
       71,160 /kg    17.79 lei for 0.00025 kg    Barilla Tortellini "0,25 g"     ← it is 250 g
         0.04 /kg     9.89 lei for 250 kg        Muller Iaurt simplu "250 kg"    ← it is 250 g
         0.01 /l     12.19 lei for 1200 l        Fino Saci Pt Gunoi Ld120L*10 Buc
```

**Nothing caught these, and correctly so.** `audit:price-truth` verifies that `pricePerUnit` is
internally *consistent* — that price ÷ ppu yields a real size. It does, every time: 19.00 lei
divided by 0.000002 kg really is 9,500,000. The arithmetic is right and the **size** is nonsense.
A consistency check cannot see this by construction, because both halves agree.

This is a bound on the **world**, not on our arithmetic. Two systematic shapes:

| shape | example | what the parser did |
|---|---|---|
| a DOSE read as a weight | `Spray oral cu nicotina, 1 mg` | 1 mg → 0.000001 kg |
| a CAPACITY read as a volume | `SACI MENAJ LDPE 320L` | a bin bag became 320 litres of product |

**A judgement, and it is mine rather than the rule's:** not every hit is a defect. Saffron at
0.15 g really does work out near 123,000 lei/kg — correct, and useless. The ones I verified as
genuinely wrong are the tortellini, the yoghurt, and every bin bag.

### `npm run audit:slug-size` — a reading aid, not an instrument

The merchant's URL slug is a second statement of pack size, written independently of the name.
Where they disagree, one is wrong.

It found the tortellini. It is also **noisy** — 6.26% of 21,759, and the top of the list is
contaminated by product codes read as sizes (`JO2564532` → "2564.5 l"). Kept, labelled as a
reading aid, and deliberately not promoted to a verdict: CLAUDE.md's rule about not turning a
reading aid into an instrument was written for exactly this.

**Its first run claimed 17.75% and almost all of it was its own bug.** Auchan writes `0-275l` for
0.275 l, and replacing every hyphen with a space read that as a **275-litre** cider. Fixed; the
honest number is 6.26% and still noisy.

---

## What this measures, and what it does not

- **95.7% is over 23 offers.** It is the first external estimate of price accuracy this project
  has ever had, and it is a small sample. The per-merchant figures below 5 comparisons are
  reported and should not be read as rates.
- **Two merchants are invisible** to the instrument entirely.
- **The one disagreement was not a price error.** On this sample, the price we publish matched
  the shop's own in every case where both numbers described the same quantity.
- **The defects are in SIZE, not price.** All three findings — variable weight, impossible unit
  prices, slug disagreement — are about the quantity a price refers to. That is consistent with
  `audit:price-truth`'s result and sharpens it: prices are sound; the quantities they attach to
  are where the errors live.
