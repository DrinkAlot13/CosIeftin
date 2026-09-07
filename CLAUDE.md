# CoșMic — project rules for Claude Code

## What this is
Romanian grocery price-comparison + basket optimizer. Next.js 14 App Router,
TypeScript, Prisma, SQLite (migrating to Postgres), Playwright scrapers.

Five sections, by `Product.section` / `Category.section` key:
`grocery` (UI label "Alimentare"), `alcohol`, `dcneu`, `cosmetice`, `farmacie`.

> Two corrections against the original draft of this file, so nobody codes to a wrong map:
> the grocery section key is **`grocery`**, not `alimentare` ("Alimentare" is only the
> Romanian UI label); and the **`makeup` section no longer exists** — it was removed along
> with the Douglas scraper (5 products behind aggressive anti-bot; beating it required
> residential proxies, which turns a manageable legal question into a real one). Do not
> reintroduce either without a deliberate decision.

Paths: this project keeps its libraries under `src/lib/…` with the `@/lib/…` alias.
So `lib/price/parsePrice.ts` in these rules means `src/lib/price/parsePrice.ts`.

## Non-negotiable invariants

### Prices
- ALL price parsing goes through one function: `src/lib/price/parsePrice.ts`.
  Never call `parseFloat` on a scraped string anywhere else.
- `parsePrice` must handle: `"12,99"` (RO decimal comma), `"2.033,39"` (RO thousands),
  `"2,033.39"` (US thousands), `"12.99 lei"`, `"12,99 RON"`, non-breaking spaces,
  and thin spaces. It returns `null` on anything ambiguous. **Never returns 0.**
- Every price written to the DB is in **bani (integer)**, not lei (float).
- A price that deviates >70% from the same product's cross-store median, or
  >50% from its own last recorded price, is NOT written. It is flagged into
  a `PriceAnomaly` table for review.
- **A GATE DEFERS; IT NEVER DISCARDS.** A gate anchored on stored history can only ever be
  as right as the data it compares against, and it is most likely to fire at exactly the
  moment a wrong value is being corrected. Auchan offer 1905 held 28,14 from 6 August, moved
  to 12,00 on 30 August — a 57% drop, past the gate — and re-scraped independently today
  reads 11,69. **28,14 was the anomaly; 12,00 was the correction.** A discarding gate would
  have thrown away the right answer and kept the wrong one, silently. So every refusal is
  recorded with the refused value, the value kept instead, `rawPriceText` and the reason.
- **`src/lib/record-refusal.ts` is the ONLY writer of `PriceAnomaly`**, and it is called from
  inside `matchPoolToCatalog`, so no merchant path can skip it. This rule was in this file
  from session one and held for one merchant of twelve, because a rule enforced only by
  documentation is enforced by nothing. It is now guarded by `tests/gates-defer.test.ts`.
- **Availability is read BEFORE the price.** A store that marks an item unavailable
  legitimately carries no price — VTEX writes `Price: 0`, which is 16.4% of Auchan's catalog,
  and across 304 sampled products `Price===0` and `IsAvailable===false` agreed with no
  exceptions either way. Parsing first turns every one of those into a "null price" and trips
  the 5% tripwire on a healthy run. Exempting them without a bound would disable the tripwire
  instead, so unavailable items are counted separately AND capped at 60%: "everything is
  unavailable" is what a broken availability read looks like too.

### Scraping
- **Persist `rawPriceText` on every write.** Without the exact source string, no parser
  change can be verified against history — that is why a strikethrough diff was once
  impossible to run. `matchPoolToCatalog` refuses a pool where under 95% carry it.
- **`StoreProduct` is THE contract. Build it at the read site and pass the pool UNMAPPED.**
  Never `pool.map((c) => ({ …fields… }))` at the matcher call. A narrower object literal is a
  valid `StoreProduct`, so the compiler cannot object — and that one line is how Metro and
  Mega Image lost `productUrl` and `rawPriceText`, and Carrefour lost its reference prices,
  on every offer they wrote. Guarded by `tests/pool-contract.test.ts`.
- **Each product's price comes from ITS OWN element.** Never scan a fixed-size window of
  raw HTML: DCNeu did that and shipped 5,969 fabricated prices (73 products at one price),
  including systematically reading the "Fără TVA" figure instead of the real one.
- A card missing its own price or link is DROPPED and counted, never given a neighbour's.
- A run where >2% of LINKED products share an identical (price, url) is refused outright.
- Never delete on re-scrape. Offers upsert, `PriceHistory` appends **on CHANGE
  ONLY** (not nightly), missing items are marked stale with `lastSeenAt`.
- If a scraper returns <60% of its previous run's offer count, abort that
  store's write and raise. A site redesign must not wipe data.
- Prefer JSON-LD or the site's internal JSON API over DOM scraping.
  Only use headless Chromium when there is no other way.
- Every scraper must have offline fixtures in `tests/fixtures/<store>/` and
  must be testable with zero network access.
- **A scraper module must not run on import.** Guard `main()` behind an
  "invoked directly" check, or importing it for a test triggers a live scrape.

### Romanian text normalization
- Before ANY tokenization, matching or search indexing, run
  `src/lib/text/normalizeRo.ts` which: lowercases, folds ș/ş/s, ț/ţ/t, ă/â/a, î/i,
  collapses whitespace, strips punctuation.
- The comma-below vs cedilla Unicode variants (U+0219/U+015F, U+021B/U+0163)
  are BOTH present in scraped data. Always fold them. This is a real bug source.

### Matching
- Matching produces a confidence score plus a machine-readable reason, never
  a bare boolean.
- **EVERY section requires name overlap**, grocery included. The old
  `!branded &&` exemption let a branded grocery product match on brand +
  head-noun + size alone, which is a product FAMILY, not a product: one Nivea
  shower gel backed 17 products across three merchants. Golden-set score for
  that category was **0%** before the fix.
- **Mutual distinction is the decisive rule**, and it is structural rather than
  a word list: if EACH side carries a significant token the other lacks, they
  are different products (`sare` vs `paprica`). Enumerating every flavour,
  scent and shade is a game you lose.
- One-sided extras are allowed (a fuller description of the same product)
  UNLESS the extra is a variant marker (`Neon`, `Magnum`, `Cutie Cadou`).
  Wine styles (`Brut`/`Rose`/`Alb`) count only outside grocery — "zahăr alb"
  is description, not a variant.
- **Strength is a number, so compare it explicitly**: 500 mg vs 1000 mg,
  2000 UI vs 4000 UI, 1,5% vs 3,5%, mărimea L vs M. The overlap scorer drops
  numeric tokens on purpose, so dosage must be checked separately. Only a
  CONTRADICTION disqualifies — silence is not disagreement.
- Token equality is fuzzy: `comprimate`/`compr.`, `capsule`/`caps`,
  `paprica`/`paprika`. Treating those as distinct rejected identical products.
- Human decisions in `MatchOverride` (CONFIRMED / REJECTED) always win and must
  survive a full catalog rebuild.
- Any change to the matcher must pass `tests/golden/matching.test.ts` before merge, and
  must not lower the pass rate recorded in `tests/golden/BASELINE.md` (currently **97.8%**,
  1 false match). A false MATCH publishes one product's price on another; a false miss
  only costs a comparison. They are not equally bad.

## Units
- Canonical units: `G`, `ML`, `BUC`. Everything normalizes to these.
- **`src/lib/units/parseQuantity.ts` is the ONLY size parser.** `parseSize` in `ingest-core.ts`
  is a thin adapter over it (kg/l/buc, because that is what the Product schema stores) and must
  stay one. Two parsers for one question means one is wrong and nothing says which — they
  disagreed on 1.78% of the catalog before being merged, including a `unitSize` of **zero**.
- Multipacks (`"6x1.5L"`, `"3 buc x 100g"`, `"24 plicuri x 15 g"`) must expand to total quantity
  AND retain the pack shape. Do not silently treat 6x1.5L as 1.5L.
- **Promotional packs are their own thing.** `(7+1) x 125 g`, `2+1 gratis`, `3 la prețul de 2`
  all expand to what the shopper takes home, and set `isPromoPack` with `paidCount`/`freeCount`
  kept apart. `packCount === paidCount + freeCount` always.
- **A bare `N+M` is NOT a promotion.** `Omega 3+6+9`, `90 Gr+`, `3+ ani` are not offers. A promo
  must attach a pack size (`4+2 x 125 g`) or carry a free-word (`2+1 gratis`). Inventing one
  corrupts a real quantity, which is worse than missing a label.
- **`isPromoPack` disqualifies a shrinkflation finding.** A promo ending shrinks the pack and
  raises the per-unit price — it clears every numeric bar and it is not shrinkflation.

## Style
- TypeScript strict. No `any`. Zod at every trust boundary (scraper output,
  API route input).
- Money math never uses floats.
- User-facing strings are Romanian. Code, comments and identifiers are English.
- Do not add dependencies without asking.

## Migrations and backfills

- **A migration or backfill script may not verify its own work.** Verification lives in
  `scripts/audit-db.ts`, which imports only `PrismaClient`, and any new backfill must ship with
  an invariant there. A script that reports its own success is reporting that it agrees with
  itself.

  This has now happened four times. Most recently `backfill-phase1` counted only the uppercase
  half of a two-vocabulary column, printed a green line, and under-reported by 19,000 offers.

- **Add and backfill in one migration; drop in the next.** A rename is a destructive migration
  wearing a harmless name. The sequence is add → backfill → verify → switch reads → drop, and
  collapsing any two of those steps is how `lastObservedAt` lost 43,765 observation dates in a
  single `db push`.

- **Never write a parent's value onto its children.** `backfill-phase1` stamped
  `merchant.lastScrapeAt` onto every offer of that merchant, turning "the run happened" into
  "this row was observed" and corrupting 10,388 rows with a plausible value for weeks. If a
  child's real value is unknown, leave it null: a null is a question, an invented value is an
  answer nobody checked.

- **One vocabulary per column, defined in TypeScript.** `Offer.priceSource` held five spellings
  of a four-value field because two writers disagreed on case, and two live read sites compared
  against a string literal. Give an enum-valued column a module (see `lib/price-source.ts`) with
  the union type, the mapper, and a translation function at any boundary where a different
  vocabulary meets it. SQLite cannot express enums, so the type system and `audit-db` are the
  enforcement.

## Writing code through a shell

Do NOT write regex-bearing or escape-bearing code through a heredoc, `node -e` or `python -c`.
One layer of backslashes is eaten on the way through, and the result is frequently VALID CODE
THAT COMPILES AND IS WRONG. Use the Write/Edit tools for anything containing an escape.

This rule was in this file for several sessions and was broken four times in one day, so it
is now enforced by `npm run check:hygiene`, which is part of `verify:code` and therefore of
the pre-commit hook. It fails on a literal backspace, vertical tab, form feed, NUL or ESC
anywhere in source, and on a meaningless escape in a regex context.

It found a live bug on its first run. `doseTokens()` in `scrape-util.ts` carries the regex
that compares garment and egg sizes — the very thing this file demands be compared explicitly
("mărimea L vs M"). Its whitespace class had become a literal letter and its word boundary an
actual 0x08 backspace, making the pattern unsatisfiable. It had never matched anything, and
the cost was sitting in the golden set the whole time as a false match on eggs. Repairing it
took the golden set from 97.3% to 97.8% and false matches from 2 to 1.

## Workflow
- Small commits. Run `npm run test` before finishing any task.
- `npm run verify:code` = typecheck + tests, and is what the pre-commit hook runs.
  `npm run verify` adds `audit:db`. They are separate on purpose: a commit changes CODE and
  cannot change the state of the database, so gating a code commit on legacy rows makes the
  hook impossible to satisfy. Data quality is gated by the nightly and by CI.
- When you change the data model, write the Prisma migration AND a backfill
  script AND a verification script that compares row counts and checksums.
- **`prisma/schema.postgres.prisma` is GENERATED.** Edit `schema.prisma`, then
  `npm run gen:postgres`. Hand-maintaining it let it fall 11 models behind.

## A PEER-RELATIVE CHECK FLAGS DISAGREEMENT, NOT GUILT

Every check that compares a row against its peers — cross-store median deviation, MAD bands,
unit-price spread, any outlier detector — rests on one assumption: **that the peers are peers.**
When a product's offer set contains false matches, they are not, and the check inverts.

A false match does not merely add a wrong row. It *moves the median*. Cluster three false
matches into a group of five and the median migrates onto them, and the check then indicts the
two correct rows. The output reads exactly the same either way.

**The worked example — `Gelatina foi Dr. Oetker 10 g`, product #2971.** The audit reported
"Carrefour 5,79 vs median 1,59 of 3". Every instinct says withhold the 5,79. The truth:

| offer | store's own name | verdict |
|---|---|---|
| Auchan 6,85 | `Gelatina foi Dr. Oetker 10 g`, matched by **EAN** | correct |
| Carrefour 5,79 | `Foi de gelatina Dr.Oetker 10 g` | correct — and this is the row that got flagged |
| Sezamo 1,59 | `Dr.Oetker Gelatina` — brand, no **format** | powder, not sheets |
| Mega Image 1,49 | `Gelatina 10g` — no brand, no format | powder, not sheets |
| Freshful 1,49 | *no source payload at all* | unverifiable |

Dr. Oetker sells gelatine as sheets AND as powder. Three of the five rows were the powder, the
median sat at 1,59, and acting on the flag would have **withheld the two prices that were right
and kept the three that were wrong.** The same inversion produced "Sezamo mici 35,50 vs 17,99",
where Sezamo was the artisanal product it claimed to be and the two cheap rows were unbranded
supermarket mici matched at 0.67 on head-noun plus size.

So the rules:

- **A peer-relative check may not name a culprit.** Its output is the GROUP: how many offers,
  how many DISTINCT store-name token bags, and every row with its own name and price. Naming one
  row as "the outlier" encodes an answer the method cannot supply.
- **Divergent store names inside a group are the tell.** Same product, one vocabulary. When the
  token bags disagree, suspect a MISMATCH before suspecting a misprice — that is the cheapest
  available discriminator and it does not depend on the prices at all.
- **Never withhold on a peer-relative flag alone.** Resolve it against something outside the
  group: an EAN, the merchant's own `storeName`, its published unit price, the pack size in its
  payload. In the gelatine case Auchan's EAN settled it in one query.
- This is a LIMIT, not a bug. Do not "fix" it by tightening thresholds — a tighter band flags
  more correct rows, not fewer wrong ones.

## A SCRIPT THAT ASSIGNS MUST BE ABLE TO UNASSIGN

Any script that assigns, flags, or classifies must be able to CLEAR ITS OWN PAST OUTPUT. A
tightened rule that cannot unassign what the old rule assigned is a rule that never takes
effect: the next run proposes the same corrected answer, writes it over rows that already have
it, and leaves every wrong row exactly where it was. Nothing fails. The output looks like the
new rule. It is the old one.

**The order is always clear-then-write, and the clear is scoped to what the rule now refuses** —
not to everything, and not to "whatever this run did not propose". An assigner is conservative
by design, so the absence of a proposal is not evidence against an existing assignment; the
evidence is that the CURRENT rule rejects the CURRENT row.

**Both of this project's assigners had this bug, and the fix sat in one of them for months while
the other silently ignored every tightening.**

| script | symptom |
|---|---|
| `assign-categories` | adult incontinence pads stayed under Bebeluși > Scutece after the rule that put them there was removed. Fixed; the comment there says "A CORRECTION MUST BE ABLE TO REMOVE A WRONG ASSIGNMENT". |
| `propose:equivalence` | `Ceapa granulata Kamis 20g` — a 20 g jar of dried seasoning — kept pricing the Index's "ceapă galbenă, la kg" line after `granulat` was excluded and a 150 g floor added. A 100x size spread inside one class, surviving every subsequent run. |

Two scripts, one shape, and nothing connected them. So it is a rule here rather than a lesson in
one file's comments: **when you add or tighten a membership rule, the same change must teach the
writer how to let go.** `audit:basket-classes` and `audit:categories` exist to catch it from the
other side — they report what each rule actually resolved to, which is the only way to see a
correction that did not land.

## Measure the blast radius; do not assume it

Every serious bug in this project was found by running the new code and the old code over the
**whole catalog** and diffing them — never by a passing test. A test proves the case you thought
of. A diff over 34,000 real names finds the ones you did not.

So: before changing any parser or matcher, write the read-only audit that compares old and new
across the live data, and report the result per merchant. `audit:promo`, `audit:ean`,
`audit:bands`, `audit:search-curve` and `audit:images` all exist because of this rule.

Corollary: **a scraper reporting "0 rejected" only means its own validator agreed with its own
parser.** Verification has to come from code that does not share the assumption.

## Rendering and caching
- A page must not declare `revalidate` under an ancestor layout that declares
  `dynamic = "force-dynamic"`: segment config inherits downward, so the page is never cached and
  the declaration is a lie. Guarded by `tests/route-config.test.ts`.
- A `force-dynamic` layout disables caching for **every** route beneath it. If you add one, say
  why in a comment directly above it.

---

## Known parser traps (each one shipped as a real bug; all are regression tests)

Romanian retail pages carry numbers that look like prices and are not. `parsePrice`
handles all four — do not "simplify" it back into a bare number scan.

| Trap | Looks like | What it did |
|---|---|---|
| US comma-thousands | `data-price="2,033.39"` | `parseFloat` stopped at the comma → a **2 lei** Dom Pérignon |
| Promo validity dates | `de mi 26.08.2026 până ma 01.09` | `26.08` parsed as a price |
| 30-day reference price | `preț minim ultimele 30 de zile: 7,99 LEI` | EU Omnibus forces **every** RO retailer to print it; read as the price it understates half the catalog |
| Footnote markers | `11,99 LEI1` | "smallest number in the block" picked the **1** — wrote 1 leu onto real products |

`parsePrice` strips dates and reference prices, then prefers amounts **attached to the
currency word**. Never reintroduce a bare "smallest number in the block" rule.

## Known matching regressions (in the golden set — never let these come back)

- **Carrefour "Vin Zarea Sânge de Taur"** (15 lei) backed **64 unrelated wines**
  (Kendall-Jackson, Lacerta, Metamorfosis) because brand + head-noun + size is far too
  loose in a catalog where one brand spans dozens of distinct products.
- **Dom Pérignon priced at 32,49 lei** — one generic "Dom" bottle backing every DP variant.
- Short tokens carry the variant (`Brut` vs `Rose`, `Cuvée I` vs `IX`), so the overlap
  score must NOT drop tokens under 3 characters. Blocking uses long tokens; **scoring uses
  short ones too**.
