# Golden-set baseline

223 hand-labelled real product pairs. Update this file **only** with the commit that moved
the number, and say what moved it.

## Baseline — 2026-08-30, before the grocery overlap fix (Phase 3)

Matcher unchanged. This is the "before" number.

```
PASS RATE: 65.5%  (146/223)
false MATCHES (dangerous): 70    false misses: 7
```

A **false match** publishes one product's price on another — that is the direction that
lies to shoppers. A **false miss** only costs a comparison.

### By section

| section | pairs | pass | rate | falseMatch | falseMiss |
|---|---|---|---|---|---|
| alcohol | 56 | 48 | 85.7% | 6 | 2 |
| dcneu | 12 | 9 | 75.0% | 2 | 1 |
| cosmetice | 19 | 13 | 68.4% | 6 | 0 |
| grocery | 125 | 74 | **59.2%** | **50** | 1 |
| farmacie | 11 | 2 | **18.2%** | 6 | 3 |

### By category

| category | pairs | pass | rate | falseMatch |
|---|---|---|---|---|
| **branded-grocery-variant** | 46 | 0 | **0.0%** | **46** |
| **farmacie-variant** | 8 | 0 | **0.0%** | 6 |
| cosmetics-variant | 16 | 10 | 62.5% | 6 |
| alcohol-variant | 11 | 7 | 63.6% | 4 |
| dcneu-variant | 11 | 8 | 72.7% | 2 |
| multipack | 12 | 10 | 83.3% | 1 |
| produce-prefix | 17 | 15 | 88.2% | 2 |
| cross-store | 28 | 25 | 89.3% | 0 |
| private-label | 14 | 13 | 92.9% | 1 |
| alcohol-same-brand | 35 | 33 | 94.3% | 2 |
| pack-size | 25 | 25 | **100.0%** | 0 |

## What the baseline says

1. **`branded-grocery-variant` is 0.0% — 46 of 46 wrong.** Every Nivea/Chio variant pair
   matches when it must not. This is the live bug the fan-out audit found (one shower gel
   backing 17 products at three merchants), quantified. The cause is in `decide()`:
   `needsOverlap = section === "grocery" ? !branded && … : true`, so a **branded** grocery
   product skips the Jaccard check entirely and needs only head-noun + size + brand.

2. **`pack-size` is 100%** — the ±6% size guard is solid, and so is the unit-family guard.

3. **`alcohol-same-brand` is 94.3%** — the fix that closed the Zarea 64-way over-match
   holds. Grocery is simply where that same fix was never applied.

4. **`farmacie` is the worst section at 18.2%**, from both directions: dosage variants
   (500 mg vs 1000 mg) wrongly match, while formatting variants ("500mg" vs "500 mg,")
   wrongly miss. Dosage lives in numeric tokens, which the overlap scorer deliberately
   drops — that is a real gap, not noise.

5. **7 false misses** cluster on abbreviation ("comprimate" vs "compr.", "capsule" vs
   "caps") and on polluted brand fields (a Zarea wine carrying `brand="Basilescu"` fails
   the brand gate against the same wine with no brand).

## Targets for Phase 3

- `branded-grocery-variant` from 0.0% to >90%
- overall false matches from 70 to <10
- `cross-store` must NOT regress below 89.3% — the fix must not buy precision with recall

---

## After Phase 3 — the grocery overlap fix (same day)

```
PASS RATE: 97.8%  (218/223)     was 65.5%
false MATCHES: 1                was 70
false misses:  4                was 7
```

| section | before | after |
|---|---|---|
| grocery | 59.2% | **98.4%** |
| cosmetice | 68.4% | **100%** |
| dcneu | 75.0% | **100%** |
| alcohol | 85.7% | **94.6%** |
| farmacie | 18.2% | **90.9%** |

| category | before | after |
|---|---|---|
| **branded-grocery-variant** | **0.0%** | **100%** |
| farmacie-variant | 0.0% | **100%** |
| cosmetics-variant | 62.5% | **100%** |
| alcohol-variant | 63.6% | **100%** |
| dcneu-variant | 72.7% | **100%** |
| alcohol-same-brand | 94.3% | **100%** |
| private-label | 92.9% | **100%** |
| pack-size | 100% | 100% |
| multipack | 83.3% | 91.7% |
| produce-prefix | 88.2% | 94.1% |
| cross-store | 89.3% | 85.7% |

### What changed in the matcher

1. **Every section now requires name overlap.** The `!branded &&` exemption that let branded
   grocery products skip the Jaccard check is gone — that exemption was the entire bug.
2. **Mutual distinction** (the decisive rule, and structural rather than a word list):
   if EACH side carries a significant token the other lacks, they make different claims and
   are different products. `sare` vs `paprica`, `Deep Clean` vs `Energy`. Enumerating every
   flavour and shade would never have finished.
3. **Variant markers** for the one-sided case (`Neon`, `Magnum`, `Cutie Cadou`, `Forte`),
   with wine styles (`Brut`/`Rose`/`Alb`) scoped to non-grocery — in grocery "zahăr alb" is
   description, not a variant.
4. **Dose signature**: `500 mg` vs `1000 mg`, `2000 UI` vs `4000 UI`, `1,5%` vs `3,5%`, and
   `mărimea L` vs `M` compared explicitly, because strength is a NUMBER and the overlap
   scorer deliberately drops numbers. Only a *contradiction* disqualifies — one side being
   silent about strength is not disagreement.
5. **Fuzzy token equality**: `comprimate`/`compr.`, `capsule`/`caps`, `paprica`/`paprika`
   count as the same token (prefix ≥3 chars, or a single-char typo at ≥6 chars). Scoring
   those as disjoint was rejecting identical products across stores.

### Remaining 6 failures, all understood

- **2 false matches**: eggs `mărimea L` vs `M` in one phrasing, and `ECO Avocado` vs
  `ECO Avocado 90 Gr+` (a size grade expressed as free text).
- **4 misses**: 2 are the **brand-pollution data bug** — Zarea wines carry
  `brand="Basilescu"`, `"Piper-Heidsieck"`, even `"Paw Patrol"`, so the brand gate correctly
  rejects a match the data makes impossible. Fixing that is a data cleanup, not a matcher
  change. 1 is `Vin Explicit Merlot DOC Sec` vs the same wine with `rosu` added. 1 is a
  farmacie phrasing.

`cross-store` at 85.7% is 3.6 points under baseline — the cost of the precision gain, and
concentrated in the brand-pollution rows rather than in matcher logic.

---

## Follow-up: alphanumeric variant names (same day, after the fan-out re-audit)

The fan-out audit found one remaining over-match group after the Phase 3 fix, and it was a
distinct bug worth naming:

**`overlapTokens` dropped every token containing a digit.** That is right for size noise
(`250ml`, `1kg`) but wrong for names that happen to contain a number.
`WELLAFLEX FIXATIV PAR 250ML 2VOLUME 4` lost `2volume` — its *only* distinguishing token —
and collapsed to a generic `wellaflex fixativ par` that all 8 Wellaflex variants matched.
Same class of loss for `3in1`, `5+`, `12yo`.

Fix: drop only **pure size tokens** (`/^\d+([.,]\d+)?(ml|l|kg|g|gr|cl|mg|mcg|ui|iu|buc|x)?$/`),
keeping alphanumeric names. Dosage units are in that list because `doseTokens` compares
strength explicitly — leaving `2000ui` in the overlap set made it a phantom distinguishing
token against a name that wrote the same dose as `2000 UI`.

Net effect on the golden set: **97.3% held, false matches still 2**, and the DCNeu
fragrance/fixative fan-out closed.

## Fan-out, after every store was re-scraped

| store | before | after |
|---|---|---|
| Kaufland | 319 | **5** |
| DCNeu | 73 | **11 → re-scraping with the token fix** |
| Freshful | 20 | **3** |
| Mega Image | 17 | **3** |
| Metro | 17 | **5** |
| Sezamo | 15 | **5** |
| Penny | 17 | **2** |
| Carrefour | 11 | **4** |

**grocery p95 = 2 (target ≤ 3) — met.**


---

## 2026-09-01 — 97.3% -> 97.8%, false matches 2 -> 1

The eggs false match (`Oua de gaina marimea L, 10 bucati` against `...marimea M, 10 bucati`)
is gone, and the fix was not to the matcher.

`doseTokens()` carries a regex for garment/egg size codes, precisely so that `marimea L` and
`marimea M` are compared explicitly rather than dropped as single-character unit noise. That
regex had NEVER MATCHED ANYTHING. It was written through a shell heredoc that ate a layer of
backslashes, so the whitespace class became a literal letter s, and the trailing word
boundary became an actual BACKSPACE character, 0x08 — which no product name contains,
making the whole pattern unsatisfiable. It compiled and ran and returned nothing for as
long as it existed.

(This paragraph first described those escapes literally, was itself written through a
heredoc, and so `check:hygiene` failed on it too — the check catching its own
documentation of the bug it was written to catch.)

Found by `npm run check:hygiene`, added the same day to enforce a rule about shell escaping
that CLAUDE.md had stated for several sessions and that kept being broken anyway. It found
this on its first run, in a file nobody was looking at.

The remaining false match is `ECO Avocado 1 buc` against `ECO Avocado  90 Gr+ 1 buc`.

---

## 2026-09-10 — 97.8% → 95.0%, and the number had gone stale unnoticed

**The matcher did not regress. The set got harder, and nothing recorded it.**

```
PASS RATE: 95.0%  (228/240)     was 97.8% (218/223)
false MATCHES: 1                was 1      ← unchanged, and it is the SAME pair
false misses:  11               was 4
```

17 pairs were added across two commits, both of which added them *before* the fix they were
meant to grade, which is the right way to do it:

| commit | branded-grocery-variant | cross-store | pack-size |
|---|---|---|---|
| `609225c` descriptor exemption | +2 | +7 | +1 |
| `c149ac7` head noun / flavour folding | +4 | +3 | — |

All 6 new `branded-grocery-variant` pairs pass. The 10 new `cross-store` pairs are where the
7 extra misses come from — `cross-store` moved 85.7% → 71.1% purely by absorbing them. Every
one is a private-label-vs-branded or abbreviation case (`Salam de Sibiu Agricola` ~ `Salam de
Sibiu, feliat`; `Nurofen 200 mg, 24 comprimate` ~ `Nurofen 200mg 24 comprimate filmate`), and
they are targets rather than defects.

**The one false match is unchanged**: `ECO Avocado 1 buc` ~ `ECO Avocado  90 Gr+ 1 buc`, the
size-grade-as-free-text case named in the Phase 3 entry above. The dangerous direction has not
moved at all.

### The actual finding: the floor was enforced by nothing

CLAUDE.md said *"must not lower the pass rate recorded in `tests/golden/BASELINE.md` (currently
97.8%, 1 false match)"*. `matching.test.ts` opened with *"This file does NOT assert a fixed pass
rate"*, and asserted only the three named regressions and the size guard. So the rate moved by
2.8 points, this file went stale, CLAUDE.md went stale, and **every run stayed green**. That is
the same shape as `record-refusal` — a rule stated in this repo from session one that held for
one merchant of twelve, because a rule enforced by documentation is enforced by nothing.

### What now enforces it

`tests/golden/baseline.json`, written only by `npm run golden:baseline -- --write`, and three
assertions in `matching.test.ts`:

1. **false matches may never rise above the recorded number** — asserted separately, because a
   fall in misses may not pay for a rise in matches;
2. **no pair that passed at the baseline may start failing** — recorded as a SET of pair keys,
   not as a rate. A rate cannot tell "the matcher got worse" from "the set got harder"; the set
   can, and adding a hard pair can no longer mask an old one breaking;
3. **a baseline naming a pair that no longer exists is a failure**, so the record cannot decay
   into the thing it guards against — the same rule `check:concepts` applies to its register.

All three were proved red with decoys before being committed: removing a known failure from the
baseline, adding an orphan key, and lowering the false-match ceiling each produce exactly one
failing test.

New pairs are still free to fail. That is the point of writing them before the fix.
