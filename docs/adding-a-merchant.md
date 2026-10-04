# Adding a new merchant

A merchant is a declarative config (`scripts/adapters/<slug>.ts`), not a bespoke script. Every
adapter shares one fetch → parse → normalize → validate pipeline (`scripts/adapters/runner.ts`),
so a fix to that pipeline fixes every merchant at once. The full shape is in
`scripts/adapters/types.ts` — read the comments there first, they explain *why* each field exists,
usually by naming the real bug it was added to prevent.

## Before writing any code

1. **Check if the site even has real prices online.** This session found three dead ends by
   checking first: Profi is behind a Cloudflare bot-challenge, Cora's online store shut down and
   redirects to Carrefour, Lidl RO has a browsable catalog but genuinely shows no prices anywhere
   (it's a "what we stock" page, not a shop). A scraper for a site with no real price data is a
   scraper for nothing.
2. **Check for a JSON API before planning a DOM scraper.** `mode: "json"` is 10–50× faster and far
   less brittle than `mode: "dom"`. Open the site's network tab and look for an XHR/fetch call
   that returns the product list as JSON — most Romanian grocery sites (VTEX-based ones
   especially) have one.
3. **Check the site's terms of service** for language about automated access, scraping, or
   storing/retransmitting content. Selgros's terms explicitly prohibit both, which is why this
   project doesn't attempt their wholesale catalog beyond what their public homepage already
   shows.

## Writing the adapter

- Start from the closest existing adapter in shape: a VTEX JSON API (`auchan.ts`), a DOM scraper
  with an unusual price layout (`selgros.ts`), or a site with no fixed route
  (`penny.ts`'s `discoverRoutes`, for a URL that carries a calendar week or campaign id).
- `routes` can be hardcoded, OR discovered at run time via `discoverRoutes()`. Prefer discovery
  for anything in the URL that expires (a week number, a season, a campaign id) — Penny's adapter
  exists as the example of what a hardcoded expiring URL costs (it 404'd silently every Monday
  for weeks before anyone noticed).
- `refine()` is the escape hatch for anything that needs cleanup after the generic field-mapping —
  unit normalization, a price that needs a unit-of-sale judgement call (see `selgros.ts`'s
  `selgrosRefine` for the fullest example: a per-kilo price is not a pack price unless the pack
  *is* a kilo).

## Non-negotiables (CLAUDE.md, "Scraping" section — read it in full)

- `rawPriceText` persisted on every write, unmapped — build `StoreProduct` at the read site, never
  `pool.map((c) => ({ ...fields }))` at the matcher call.
- Each product's price must come from its OWN element — never a fixed-size HTML window scan.
- A card missing its own price or link is dropped and counted, never given a neighbour's price.
- Never delete on re-scrape; offers upsert, history appends on change only, missing items are
  marked stale.
- A run returning under 60% of the previous run's offer count aborts and raises rather than
  silently wiping data.
- The module must not scrape on import — guard `main()` behind an "invoked directly" check.
- Offline fixtures in `tests/fixtures/<store>/`, testable with zero network access.

## After it's live

- `npm run audit:db` — the full invariant suite. A new merchant's offers must clear the same bars
  as every other merchant's.
- Check the fan-out audit specifically (`audit:db`'s "Matching" section): a generic source listing
  matched to many catalog products is a real, recurring bug shape — see the Mega Image coffee case
  in the commit history (one generic "Cafea boabe Espresso 1kg" listing backing 16 different
  catalog products across 6 brands, all at the same price).
- Add the merchant to `src/lib/source-capabilities.ts` if it genuinely cannot carry a per-product
  URL, or to `LIMITED_CATALOG_MERCHANTS` in the same file if it's a weekly-flyer/homepage-deals
  source rather than a real catalog — both exist so a real limitation reads as an explained one
  instead of a bug.
