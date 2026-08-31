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

### Scraping
- **Persist `rawPriceText` on every write.** Without the exact source string, no parser
  change can be verified against history — that is why a strikethrough diff was once
  impossible to run.
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
  must not lower the pass rate recorded in `tests/golden/BASELINE.md` (currently **97.3%**,
  2 false matches). A false MATCH publishes one product's price on another; a false miss
  only costs a comparison. They are not equally bad.

## Units
- Canonical units: `G`, `ML`, `BUC`. Everything normalizes to these.
- Multipacks (`"6x1.5L"`, `"3 buc x 100g"`) must expand to total quantity AND
  retain the pack shape. Do not silently treat 6x1.5L as 1.5L.

## Style
- TypeScript strict. No `any`. Zod at every trust boundary (scraper output,
  API route input).
- Money math never uses floats.
- User-facing strings are Romanian. Code, comments and identifiers are English.
- Do not add dependencies without asking.

## Workflow
- Small commits. Run `npm run test` before finishing any task.
- When you change the data model, write the Prisma migration AND a backfill
  script AND a verification script that compares row counts and checksums.

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
