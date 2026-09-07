# Data sources — what's reachable, what isn't, and why

Findings from live reconnaissance on 2026-08-30. Re-verify before relying on any of it;
retail sites change.

## The rule

Prefer sources in this order. Each step down costs more to maintain and carries more legal
exposure:

1. **Official / public-sector** — Monitorul Prețurilor (mandatory retailer reporting).
2. **Embedded JSON / internal API** — server-rendered state or a search endpoint. 10–50×
   faster than rendering a page and far less brittle. **Always check for this first.**
3. **Weekly flyers** — where the real promo savings are, with `validFrom`/`validTo`.
4. **HTML scrape with Playwright** — last resort.

## Live status

| Source | Status | How | Notes |
|---|---|---|---|
| **Kaufland** | ✅ **live** | embedded JSON | `window.SSR[…]` on the weekly-offers page carries ~410 offers with numeric prices, promo dates, old price, and **Kaufland Card** loyalty price. Plain `fetch`, one request, no browser. |
| **Penny** | ✅ live | Playwright DOM | `[data-test="product-tile"]` on the current-week offers page. |
| Auchan, Carrefour, Mega Image, Metro, Sezamo, Freshful, DCNeu, Farmacia Tei, FineStore, Le Manoir | ✅ live | existing scrapers | see `scripts/scrape-*.ts` |
| **Lidl** | ❌ **no prices published** | — | `/p/api/gridboxes/RO/ro` returns real products but **empty price objects** — Lidl RO's assortment is in-store only ("În magazin"), and its pagination is fake (same 25 items on every page). There is nothing to scrape. Lidl must come from an aggregator, Monitorul, or flyers. |
| **Monitorul Prețurilor** | ⚠️ unreachable here | — | DNS resolution failed for every variant tried (`monitorulpreturilor.info`/`.ro`, ±`www`, `api.`) while `consiliulconcurentei.ro` resolved fine — so it's the host, not the network. `scripts/scrape-monitorul.ts` probes candidates and **writes nothing** unless a payload parses. Finish it by capturing one real request from the web/mobile app. |
| **Glovo** | ✅ **live** (Kaufland Bucharest) | ~2,200 | Delivery address created once, stored client-side in our own cookie; nothing written to Glovo. Playwright over RSC. Prices carry a **+11.5% median markup** and are `DELIVERY_PLATFORM`, excluded from everything user-facing by default. **See "Glovo, RESOLVED" at the foot of this file — it supersedes the two recon sections below.** |
| **Selgros** | ⚠️ adapter exists, pools 0 | never run | **Re-diagnosed 2026-09-08 — the old note was wrong.** See below. |
| **Profi** | ❌ blocked | — | HTTP 403 to plain requests. |
| **Douglas** | ⛔ **dropped deliberately** | — | Yielded 5 products behind aggressive anti-bot. Beating it meant residential proxies, which turns a manageable legal question into a real one. Not worth it. |

## Aggregator prices are not shelf prices

Delivery apps (Glovo/Bolt/Wolt) mark up over shelf price, and assortment varies by city.
Every `Offer` carries `priceSource` (`shelf` | `delivery` | `aggregator`) and the UI labels
non-shelf prices. Never let a marked-up delivery price silently win a "cheapest" comparison
against a shelf price — see invariant 9 in `CLAUDE.md`.

## Legal posture

Prices as facts aren't copyrightable, but the EU *sui generis* database right
(Legea 8/1996) covers substantial extraction, and ToS is separate exposure.

- Prefer official and public-sector sources.
- Respect `robots.txt` and rate limits; identify honestly.
- Always deep-link back to the merchant.
- **Prefer hotlinking to rehosting images** — self-hosted images are the highest-risk
  artifact here, more than the prices themselves.
- Pursue affiliate programs for the online-delivery stores (Freshful, Sezamo): that turns
  them from adversaries into partners.
- Get a Romanian IP lawyer's hour before adding the major chains at scale.

---

## Delivery platforms — robots, and the Glovo blocker (2026-08-30)

**robots.txt permits crawling store catalogs on all three.** Checked directly:

| platform | `User-agent: *` rules | verdict |
|---|---|---|
| **Glovo** | `Allow: /`, disallowing only `/embedded-web-views/*`, `/*/order-tracking/*/share`, `/*/password-recovery` | store + product pages allowed |
| **Bolt Food** | disallows only `/*/dine-in/p/` | store pages allowed |
| **Wolt** | `Disallow:` (empty) | everything allowed |

robots is only one dimension — each platform's **Terms of Service** is a separate question and
has not been reviewed here. Do that before any production run.

### Glovo recon, 2026-09-02 — the blocker is now precisely located

Supersedes the 2026-08-30 note below, which concluded "reverse-engineer the app auth flow". That
was too pessimistic in one way and too optimistic in another. Re-verified live:

**robots.txt is unchanged and permits this.** Fetched 2026-09-02T15:44Z:
`User-Agent: *` / `Allow: /`, disallowing only `/embedded-web-views/*`,
`/*/order-tracking/*/share`, `/*/password-recovery`. PetalBot is blocked; we are not PetalBot.

**The store slugs are real and discoverable.** The old note's URL
`/ro/ro/bucuresti/kaufland-buc/` now 302s through `/legacy-url-handler` to
`/ro/ro/bucuresti/stores/kaufland-buc`. The RO sitemaps carry only city/category pages and no
store pages at all, but one page enumerates them —
`/ro/ro/glovo-delivery/categories/supermarket` links:

    /ro/ro/bucuresti/stores/kaufland-buc      /ro/ro/bucuresti/stores/penny-buc
    /ro/ro/bucuresti/stores/carrefour-buc     /ro/ro/bucuresti/stores/mega-image-buc
    /ro/ro/bucuresti/stores/freshful-buc      /ro/ro/bucuresti/stores/carrefour-supermarket-buc

So store discovery is solved and needs no reverse engineering.

**The gate is a delivery address, and only that.** Every store page renders
"Această pagină nu există" until one is set. Two GUEST endpoints already work unauthenticated:

    GET /v3/addresslookup/pub/coordinates?latitude=..&longitude=..&allowFallback=true
        -> { placeId, cityCode: "BUC", fullAddress, addressComponents }
    GET /customer_profile/api/v1/guest/address_book/delivery_point_info?latitude=..&longitude=..
        -> { valid: true, fullGlovoPlaceId: "cad%3A44.4268%0A26.1025%0A...", action: "GO_TO_ADDRESS_CREATION" }

`GO_TO_ADDRESS_CREATION` is the whole remaining blocker: the guest has no stored address, and
creating one is a **write to Glovo's customer_profile service**. That is a different act from
crawling — robots.txt permits reading their pages; it does not authorize creating records in
their user database as a synthetic customer. **Not attempted deliberately.** It needs an explicit
decision and a ToS review, which has still never been done.

> **SUPERSEDED 2026-09-02.** This paragraph is wrong. Creating the address through the ordinary
> web UI writes nothing to Glovo — it is a cookie on our own browser. See the foot of this file.

**There is no JSON product API to prefer over rendering.** Control experiment, same method
against a fully-served market:

| route | renders | store links | product JSON API calls |
|---|---|---|---|
| `/es/es/madrid/` (control) | yes | 2 | 0 |
| `/es/es/madrid/stores/superglovo-mad` | yes | – | 0 (only `features/query`) |
| `/ro/ro/bucuresti` | **404** | 0 | 0 |
| `/ro/ro/timisoara` | yes | – | 0 |

Madrid works with the identical script, so the method is sound and the difference is the address,
not our approach. And even in Madrid the web client never calls a product JSON endpoint — the
catalog is server-rendered React Server Components. So the answer to "JSON API or rendered?" is
**rendered**, and any adapter would be Playwright-based, against RSC payloads, behind an
account-bound address.

**foodpanda.ro now redirects to `glovoapp.com/ro/ro`** — Glovo is the Romanian operator, so this
is the only aggregator door for Kaufland/Penny/Profi, not one of several.

**Recommendation unchanged, and now better evidenced:** Monitorul Prețurilor is mandatory-reporting
SHELF data across the same chains, with no markup to model, no address gate, and no ToS exposure.
Glovo is reachable only by creating a customer address record, and it yields marked-up prices we
would then have to hide by default anyway.

### Glovo is blocked on more than a delivery address

Two serious attempts, both failing at the same wall:

1. Plain navigation to `glovoapp.com/ro/ro/bucuresti/kaufland-buc/` — page loads (correct
   title, "Livrare Kaufland în București"), **zero product tiles**.
2. Full browser session: Bucharest geolocation granted, cookie banner accepted, a real
   Bucharest address typed into the address field and submitted — still **zero product
   tiles, and no catalog API call at all**.

The only API traffic in either case is `identity/v4/devices` (HTTP 201), `features/query`
and `seo-content`. A 201 on device registration suggests the catalog sits behind a
device/session handshake the web page never completes on its own — so this is not "set an
address", it is reverse-engineering the app's auth flow.

**Recommendation:** this is app-API reverse-engineering, not adapter work, and it should be
scoped as such. Capturing one authenticated session from the Android app through a proxy
would answer it in minutes; guessing at it from the web page will not.

**Monitorul Prețurilor remains the better investment** for the same coverage goal: it is
mandatory-reporting shelf data across Kaufland, Lidl, Penny, Selgros, Carrefour, Mega and
Auchan, with no markup to justify and no ToS exposure.

---

## Glovo, RESOLVED — 2026-09-02 (supersedes the two sections above)

Address creation was authorised, and the answer changed three of the conclusions above. They are
left in place because being wrong in a documented way is how the correction is legible.

### 1. Creating the address wrote NOTHING to Glovo's servers

The recon called this "a write to Glovo's customer_profile service" and declined to attempt it.
**That was wrong.** The address created through the ordinary web UI lives entirely in a
first-party cookie on our own browser, `glovo_delivery_address` on `glovoapp.com`:

    {"latitude":44.4164141,"longitude":26.0481675,"cityCode":"BUC","countryCode":"RO",
     "cityName":"București","text":"Aleea Meseriașilor, 3","details":"",
     "placeId":"ChIJPa4eDikAskAR_dBX4RmzB1s","isVerified":true,"postalCode":null}

Every request to Glovo across the whole session was a GET, with exactly one exception:
`POST /identity/v4/devices`, the Incognia device fingerprint that fires on ANY page load of the
site including the front page, before any address exists. No account, no credentials, no
`address_book` POST, no customer record. **Nothing was written to their user database**, so the
ToS concern the recon raised does not arise in the form it was raised.

Confirmed by watching every non-GET request for the entire run, not by reading the code that
sends them. No 401, 403, 429 or challenge was returned at any point, before or since.

Place type is **"Casă"**, not "Apartament": under Apartament, Etaj and Apartament are both marked
`(obligatoriu)`, and the supplied address has neither. Inventing a floor and flat number at a
real Bucharest residential address is not a form field, so the house type was used instead.

Session persisted at `config/glovo-session.json` — **one address, created once, reused by every
run**. It is not recreated per run, per merchant or per session.

### 2. It was never an app-API reverse-engineering problem

The recon concluded the catalog sat behind "a device/session handshake the web page never
completes" and recommended proxying the Android app. **Also wrong.** The web page completes it
fine. The catalog renders for an ordinary browser with an ordinary address, and a plain
Playwright adapter reads it. No proxy, no app, no auth flow.

### 3. The city slug is `bucharest`, not `bucuresti`

`/ro/ro/bucuresti/...` 302s into a soft 404 — which is the "**404**" row in the control-experiment
table above, misread at the time as an address problem. The live path is the ENGLISH city slug:

    https://glovoapp.com/ro/ro/bucharest/stores/kaufland-buc

Glovo's own `/ro/ro/glovo-delivery/categories/supermarket` page links the `bucuresti` form, so
the site links URLs that do not work. Trusting a site's own links cost a whole recon pass.
Asserted in `tests/delivery-platform.test.ts`.

### What the adapter is

`scripts/adapters/glovo.ts`, driven by config rows in `src/lib/platform/config.ts` — one adapter,
six discovered storefronts, **one enabled**. Rate limits are config, not code: 4 s between
category pages, 1.2 s between scroll steps, 40 scroll ceiling per category.

- No product JSON API exists (re-confirmed) — the catalog is RSC, so the DOM is the source.
- Tiles are selected by CSS-module PREFIX (`[class*="ItemTile_itemTile"]`). The hash suffix
  changes every deploy. `data-test-id="product-tile"` exists only on the landing carousels, not
  in category views — matching on it harvested 0 products from 20 opened categories.
- **`productUrl` is null and stays null.** A Glovo tile has no ancestor or descendant `<a>`;
  there is no per-product permalink to record. Pointing it at the category page instead tripped
  the fabrication guard at 71.7% — correctly, since every product in a category then shared
  `(price, url)`. `audit-db`'s deep-link invariant now scopes to sources that publish links.
- `rawSourceBlob` carries `offerId`, the key `audit-db` reads to identify a store product when
  there is no deep link. Omitting it made the audit fall back to `url|price` and report a
  20-way matcher fan-out that was really 20 different Dove shower gels priced 31,99 in one
  category. The audit now declares when it is using that fallback.

### Robots

Re-checked at the start of the run, as instructed: `Allow: /`, disallowing only
`/embedded-web-views/*`, `/*/order-tracking/*/share`, `/*/password-recovery`. Unchanged, and
store and category pages remain allowed.

### The prices are marked up, and are hidden by default

Glovo's own Kaufland header claims **"Preț ca în magazin"**. Measured against the cheapest
non-platform price for the same catalog product, on 269 overlapping products:

| | |
|---|---|
| median markup | **+11.6%** (median absolute +0,56 lei) |
| spread | p10 −6.3% · p25 0.0% · p75 +35.7% · p90 +63.0% |
| dearer / cheaper / identical | 174 / 59 / 36 |

Two independent scrapes a few hours apart gave +11.5% and +11.6% on ~270 pairs, so the figure is
the assortment's, not one run's.

So the claim is false at the median, though a quarter of the assortment does match shelf price
exactly. The largest premiums are all measured against Metro, a cash-and-carry whose prices are
not a fair consumer comparison — read that tail with that caveat.

Comparability (a product priced by 2+ merchants) is **7.5%** with platform rows excluded and
**8.2%** with them included, of 26,272 products — the platform adds ~1,900 single-merchant
products to the denominator while lifting the numerator, which is why turning it on flatters the
number without making a single extra product genuinely comparable on shelf terms.

`npm run audit:markup` re-measures this. It reads platform rows regardless of visibility, which
is the only reason it can measure the gap at all.

**A DELIVERY_PLATFORM price is excluded from everything user-facing by default** — optimizer,
item pages, deals, counts, search, comparability. One definition, `deliveryPlatformWhere()` in
`src/lib/platform/visibility.ts`, expressed as a `NOT` rather than an allow-list so a future
fifth price source stays visible instead of silently vanishing. Enabled only by
`SHOW_DELIVERY_PLATFORM=1` or a per-request `?dp=1`. **Off in production.**


---

## Selgros — why it is excused from the nightly, re-diagnosed 2026-09-08

The previous note said the listing "renders client-side" and "the price selector yields
nothing". Both halves were checked and the first is wrong.

**Has it ever run?** No. There is no `Merchant` row for Selgros and no `ScraperRun`. It has
contributed nothing, ever.

**What does it pool?** Zero. `POOL_ONLY=1 npm run scrape:selgros` reports
`0/0 prices parsed, 0 null` and refuses to touch the database — which is the correct
behaviour, not the bug.

**Why zero, precisely** (`npm run probe:selgros`, headless Chromium, the same engine the
adapter uses):

| route | cards found | verdict |
|---|---|---|
| `https://www.selgros.ro/` | **48** `a.product-item[data-product-id]` | the card selector is CORRECT and the cards are server-rendered — a plain curl sees 24 of them in the raw HTML |
| `.../exploreaza-sortimentul-selgros` | 0 | genuinely empty; this route is dead weight |

So the cards are found. What fails is everything after:

- **The name selectors all miss.** `.product-title`, `h3`, `[class*="title"]`, `.product-name`
  each return nothing. The name is in the card (`TRANSGOURMET QUALITY COZI CREVETI ...`) but
  under none of them, so every card is dropped for having no name — which is why the pool is
  0 rather than 48.
- **The price is SPLIT ACROSS ELEMENTS.** `[class*="price"]` reads `per BUC. 39` for a product
  priced 39,99: the lei and the bani are separate nodes. Wiring this up naively would write
  **39 lei instead of 39,99** on every row — a fabricated price, which is worse than no
  merchant. Any fix must read the whole price container and hand the joined string to
  `parsePrice`, never the first numeric node.

**And a reason to think it is low-value anyway.** Selgros is cash & carry (Transgourmet). The
home-page assortment is catering packs — 750 g of shrimp, cases — carrying a validity window
(`01/09/2026 - 30/09/2026`). Those are not the packs a household shops for, so most of what it
would contribute cannot join a retail comparison even once it parses. Metro, the other cash &
carry, already shows this: 1,626 of its products are own-brand and every one is single-shop.

**robots.txt permits it** (`User-agent: *` with no disallow covering these paths).

**Verdict: not a nightly candidate until someone fixes the name selector AND the split price.
The work is small; the payoff is doubtful. Excusing it remains correct.**

---

## EAN on detail pages — per merchant, 2026-09-08 (`npm run probe:ean`)

Asked because an EAN settles a match without argument. Sampled live products per merchant and
opened each product's OWN url, looking in four places: JSON-LD, meta tags, a labelled spec row,
and any embedded JSON payload.

| merchant | offers | carry a url | already have an EAN | detail page yields one | how |
|---|---|---|---|---|---|
| **auchan** | 9,937 | 100% | **9,693 (98%)** | 3/3 | embedded json — but there is nothing left to gain |
| **farmaciatei** | 2,898 | 100% | **0 (0%)** | **4/4** | **`json-ld` `gtin13`** |
| mega-image | 8,712 | 100% | 2,675 (31%) | 0/3 | nothing in any of the four places |
| freshful | 4,736 | 100% | 1,598 (34%) | 0/3 | nothing |
| metro | 6,624 | 99% | 1,343 (20%) | 0/4 | nothing |
| carrefour | 5,978 | 99% | 1,292 (22%) | 0/3 | nothing |
| sezamo | 9,504 | 99% | 1,130 (12%) | — | every sampled url was a 404; see below |
| dcneu | 13,005 | 100% | 0 (0%) | 0/3 | nothing |
| penny | 81 | 100% | 23 (28%) | 0/3 | nothing |
| kaufland | 655 | **0%** | 72 (11%) | — | stores no productUrl at all, so there is no page to open |

**The answer to "what would comparable products become": nothing.** The brief's condition was
"if two or more can supply one". Exactly one merchant can — Farmacia Tei — and Auchan, which
also can, is already at 98%. An EAN raises comparability only when a SECOND shop can be matched
to a FIRST by it, and no second grocery merchant publishes one. Harvesting Farmacia Tei is still
worth doing on its own merits (2,898 offers, 0 EANs, one JSON-LD field, one page per product),
but it is a `farmacie`-section improvement, not a grocery comparability one.
