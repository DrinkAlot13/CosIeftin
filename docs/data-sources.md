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
| **Glovo** | ⚠️ needs a session | — | Store pages load (`/ro/ro/bucuresti/kaufland-buc/`) but render **no catalog** until a delivery address is set; only identity/features XHR fire. Needs address-state reverse-engineering. Would unlock Kaufland+Lidl+Profi at once — highest-leverage remaining integration. |
| **Selgros** | ⚠️ selectors unresolved | — | Cards are `a.product-item[data-product-id]`, but the category listing renders client-side and category slugs aren't in the HTML. Adapter exists (`scripts/adapters/selgros.ts`); the price selector yields nothing, so the runner refuses to write. Needs one more recon pass. |
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
