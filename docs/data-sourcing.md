# Data sourcing for grocery prices

Unlike electronics (affiliate feeds via 2Performant/Profitshare), **grocery chains do
not publish affiliate product feeds**. Real prices have to come from **scraping**
online-grocery / delivery catalogs. This is the make-or-break part of the project.

## How the pipeline is built to accept real data

The MVP ships a **sample generator** (`scripts/generate-sample.ts`) that writes per-chain
NDJSON to `data/scraped/*.ndjson` — the exact shape a real scraper would output:

```json
{"store":"kaufland","name":"Lapte Zuzu 3.5% 1L","brand":"Zuzu","price":6.09,"packLabel":"1 L","url":"https://www.kaufland.ro","availability":"in stock"}
```

`scripts/ingest.ts` reads those files and calls `ingestItemsForMerchant()`
(`src/lib/ingest-core.ts`), which:
1. parses the pack size ("1,5 L", "500 g", "6x0,5 L") into a base unit,
2. matches the item to a pre-set catalog Product by EAN → **size-guarded fuzzy match**,
3. computes **price-per-unit** and upserts the Offer + a price-history point.

**A real scraper just has to emit the same NDJSON** — no other code changes.

## Real sources (start with the most reachable)

Online-grocery / delivery catalogs with public prices: **Freshful (eMAG)**, **Auchan
online**, **Carrefour online / Bringo**, **Kaufland**, **Tazz / Glovo** groceries.
Recommended: **Python (Scrapy + Playwright)**, one module per platform, starting with 1–2.

## Guardrails (do this properly)

- Respect **robots.txt** and each site's **Terms of Service**; keep a **per-source on/off**
  switch and real **rate limits**; identify your bot with a contactable User-Agent.
- **Public price data only** — no logins, no personal data, no bulk catalog copying (EU
  **database rights**; scraping a *substantial part* of a DB can infringe even if each price
  is public).
- **Legal review by a Romanian IT/IP lawyer before scraping the major chains.**
- Big retailers use anti-bot (Cloudflare); residential proxies cost money and **do not remove
  the legal exposure** — they only help at volume. Keep scraping minimal and defensible.

## Alternatives / complements

- **Crowdsourced prices** (users submit) — legal and cheap, but sparse/stale.
- **Official APIs / partnerships** where a chain offers one.
- **Weekly flyer (promo) data** for the "cele mai mari scăderi" section.

**Bottom line:** the pre-set-items scope keeps this tractable (~100–300 items × a few
chains). Ship demo data first, add scrapers one careful source at a time.

---

## Live scraper status (as built)

Run scrapers from your own machine/IP (polite, low-volume), then the pipeline attaches
real offers onto the pre-set catalog.

| Store | Stack | Status | How |
|-------|-------|--------|-----|
| **Auchan** | VTEX | ✅ **working** — `npm run scrape:auchan` | Public catalog API `/api/catalog_system/pub/products/search?ft=…` (not robots-disallowed). One query per pre-set item, rate-limited 1.5s, browser UA. Picks the size- + head-noun- (+ brand-) matching result. **~29/48 items** get real price + EAN + deep link. |
| **Freshful** | Next.js | ✅ **working** — `npm run scrape:freshful` | Products are SSR'd into `__NEXT_DATA__` on **category pages** (allowed; the `/api/v2/shop` JSON API is robots-**disallowed**, so we parse the page). Fetches ~10 department pages (`/c/{id-slug}`), pools ~1000 products, matches ours. **~20/48** items. Also captures image URLs. |
| **Carrefour** | Magento | ⚠️ blocked | Homepage returns **403** to plain requests (WAF). Needs a real browser (Playwright) or the Bringo backend; do this carefully / later. |

### Images — `npm run download-images`
Both scrapers capture the store's product image URL onto `Product.image`. `download-images`
then fetches those and saves them to `public/product-images/{slug}.jpg`, rewriting `Product.image`
to the local path so images are **self-hosted** (rendered via `ProductImage`). ~31 real photos so far.

### Two real stores = real comparison
After `scrape:auchan` + `scrape:freshful`: **7 stores, 49 real offers, 18 items priced by BOTH
Auchan and Freshful** (e.g. Pâine albă 500g: Auchan 5,79 vs Freshful 5,49). The other chains stay
sample data until scraped. Run order for a full refresh:
`npm run setup && npm run scrape:auchan && npm run scrape:freshful && npm run download-images`.

### Auchan scraper (`scripts/scrape-auchan.ts`)
- Clears Auchan's sample offers, then for each pre-set item queries the VTEX API,
  filters candidates to **same head noun + compatible size** (and brand if the item is
  branded), takes the cheapest available, and writes a real `Offer` (+ price point) and
  the real **EAN** onto the catalog product.
- Precision knobs to improve coverage past ~60%: better per-item query terms, read more
  result pages, relax/҂tune the size tolerance, handle loose-weight produce (kg) specially.
- **Guardrails honored:** robots.txt (only the public data API, which isn't disallowed;
  no `/busca/`, no query-param page URLs), rate limit, browser UA, low volume. Keep a
  per-store on/off; add a scheduled refresh (cron) in production.

