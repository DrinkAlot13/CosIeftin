# CoșMic public read API — v1

**Status: SPECIFICATION. Nothing here is built yet.** Read this before it is, because a
browser extension, a PWA and possibly a native app all consume it, and the cheapest place to
argue about the shape is here.

---

## 0. The measurement that should change one of the endpoints

The brief names `GET /api/v1/lookup?merchant=X&sku=Y` as "the extension's primary call". Measured
against the live database on 2026-09-10, **that call would work for one merchant of sixteen**:

| merchant | live offers | has SKU | has EAN | has deep link |
|---|---|---|---|---|
| dcneu | 10,811 | **96%** | 0% | 100% |
| sezamo | 8,172 | 0% | 7% | 100% |
| mega-image | 6,886 | 0% | 10% | 100% |
| auchan | 5,611 | 0% | **95%** | 100% |
| metro | 5,439 | 0% | 8% | 100% |
| carrefour | 5,279 | 0% | 13% | 100% |
| freshful | 3,156 | 0% | 9% | 100% |
| glovo-kaufland | 2,257 | 0% | 8% | **0%** |
| farmaciatei | 2,021 | 0% | 0% | 100% |
| glovo-profi | 1,121 | 0% | 21% | **0%** |
| glovo-penny | 676 | 0% | 16% | **0%** |
| finestore | 279 | 0% | 0% | 100% |
| kaufland | 269 | 0% | 10% | **0%** |
| lemanoir | 94 | 0% | 0% | 100% |
| penny | 29 | 0% | 0% | 100% |
| selgros | 25 | 0% | 4% | 100% |

**19.9% of live offers carry an SKU, and 96% of those are one discounter.** EAN is no better as a
join: only Auchan publishes one at scale, and CLAUDE.md already records that no two grocery
merchants publish an EAN for the same product.

**What we DO have on twelve merchants is the product URL, at 100%.** And the extension is, by
definition, standing on that URL. So:

> **`url` is the primary lookup key, `sku` is the secondary, `name+size` is the fallback.**

This is a change to the brief and it is the main thing to disagree with if you are going to
disagree with something. Everything else follows from it.

The four merchants at 0% deep links (Kaufland's flyer, the three Glovo storefronts) publish no
per-product page at all — `lib/source-capabilities.ts` already declares this, so their absence is
a known shape rather than a gap. **No extension can work on those four**, because there is no
product page to stand on.

---

## 1. Versioning

Every route lives under `/api/v1/`. A shipped extension that nobody updates keeps working when
v2 arrives; v1 is frozen the day v2 opens and removed only after a deprecation window announced
in `/api/v1/meta`.

The existing unversioned routes (`/api/basket`, `/api/suggest`, `/api/alternatives`, …) stay
exactly where they are. They are the website's own internals, not a contract, and moving them
would be a breaking change for no one's benefit. **v1 is additive.**

---

## 2. Shared response conventions

### 2.1 Every price carries its own observation date

Non-negotiable. Every offer object includes:

```jsonc
{
  "priceBani": 899,              // integer bani, never a float
  "price": "8,99",               // preformatted RO string, for clients that just render
  "observedAt": "2026-09-10T04:12:33.000Z",
  "observedAgeHours": 7.4        // computed server-side so a client cannot get it wrong
}
```

`observedAgeHours` is redundant and deliberate: a client that forgets to compute it renders
"acum" for a six-day-old price, and that is precisely the failure this field exists to stop.

### 2.2 Nothing is silently mixed

Every offer carries the flags that decide whether it should be believed:

```jsonc
{
  "availability": "in stock",
  "isStale": false,
  "priceSource": "SHELF",           // SHELF | ONLINE | DELIVERY_PLATFORM | FLYER
  "requiresLoyaltyCard": false,     // the price needs the merchant's card
  "loyaltyPriceBani": null          // a CHEAPER card price alongside, or null
}
```

**Withheld offers (`flagged = true`) are never returned at all**, in any endpoint, under any
parameter. They are rows a gate refused to trust; there is no flag that makes them safe to hand
to a client, and an API that returns them invites a client to render them.

`DELIVERY_PLATFORM` offers are **excluded by default** and included only with
`?includeDeliveryPlatform=true`. Measured median markup is +11.5%, so mixing them into a
comparison silently is a wrong answer, not a fuller one.

### 2.3 "No comparison" is a shape, not an empty array

89.3% of priced grocery products have exactly one shop. That is the common case and the clients
must render it honestly, so it has its own field rather than being inferred from `offers.length`:

```jsonc
{
  "comparison": {
    "status": "single-shop",       // "comparable" | "single-shop" | "no-price"
    "shopCount": 1,
    "reason": "Doar un magazin are un preț pentru acest produs acum."
  }
}
```

- `comparable` — two or more shops with a current price
- `single-shop` — exactly one; the client shows the price and says so
- `no-price` — the product exists in the catalog but nothing current is priced

### 2.4 A deep link is the real one or `null`

`productUrl` is the merchant's own page for that product, or `null`. **Never a homepage, never a
category page.** Where a merchant publishes none, the response says so explicitly rather than
leaving the client to guess:

```jsonc
{ "productUrl": null, "productUrlAbsent": "merchant-publishes-none" }
```

`merchant-publishes-none` comes from `lib/source-capabilities.ts`; anything else is `"unknown"`
and is a bug on our side, reported as such rather than disguised.

### 2.5 Errors

One shape, always:

```jsonc
{ "error": { "code": "not_found", "message": "…", "details": {} } }
```

| code | HTTP | when |
|---|---|---|
| `bad_request` | 400 | missing or malformed parameter — `details` names it |
| `not_found` | 404 | no such product / merchant |
| `rate_limited` | 429 | over budget; `Retry-After` header set |
| `server_error` | 500 | our fault; never carries internals |

**A "no confident match" is NOT an error.** It is a 200 with `match.status = "none"` — see §3.3.

---

## 3. Endpoints

### 3.1 `GET /api/v1/product/{slug}`

The item page as JSON.

**Response**

```jsonc
{
  "product": {
    "slug": "lapte-zuzu-1-5-l",
    "name": "Lapte Zuzu 1,5% 1 L",
    "brand": "Zuzu",
    "unit": "l", "unitSize": 1,
    "image": "https://…",          // may be a third-party host; see /confidentialitate
    "section": "grocery",
    "category": { "slug": "lactate-oua", "name": "Lactate și ouă" }
  },
  "comparison": { "status": "comparable", "shopCount": 3 },
  "summary": { "lowestBani": 749, "highestBani": 899, "savingsBani": 150 },
  "offers": [ /* §2.1 + §2.2 + §2.4, sorted cheapest first */ ],
  "unitPrice": { "lowestBani": 749, "unit": "l" }
}
```

`404` when the slug does not exist. A product with no current offers returns `200` with
`comparison.status = "no-price"` and `offers: []` — it exists, and saying so is different from
saying it does not.

### 3.2 `GET /api/v1/lookup?url=…` — the extension's primary call

Given the URL of a merchant's product page, return our product and every shop's price.

| parameter | required | notes |
|---|---|---|
| `url` | yes | the merchant page URL, percent-encoded |
| `includeDeliveryPlatform` | no | default `false` |

Matching is by **exact stored `productUrl`**, then by a normalised form (scheme, `www.`, trailing
slash, tracking query parameters `utm_*`/`gclid`/`fbclid` stripped). It is not fuzzy — a URL
either identifies a row or it does not.

> **Needs an index.** `Offer.productUrl` has none today (`Offer` carries
> `@@unique([productId, merchantId])`, `@@index([isStale, isExpired])`, `@@index([flagged])`).
> A lookup by URL over 52,125 rows without one is a table scan per request. Add
> `@@index([productUrl])` in the same change that ships this endpoint.

**Response** — the `product/{slug}` body plus what was matched and how:

```jsonc
{
  "match": { "status": "exact", "by": "url", "merchant": "sezamo", "confidence": 1 },
  "product": { … }, "comparison": { … }, "offers": [ … ]
}
```

`match.status = "none"` with `product: null` when the URL is not one of ours — a **200**, because
"we do not have this product" is an answer.

### 3.3 `GET /api/v1/lookup?merchant=…&sku=…` — secondary

Works only where we store an SKU. Per §0 that is **DCNeu and nothing else**, so the endpoint
exists for completeness and for merchants we may later capture one from. `match.by = "sku"`.

When `merchant` is one we hold no SKUs for, the response is explicit rather than an empty result:

```jsonc
{ "match": { "status": "unsupported", "reason": "no-sku-stored-for-merchant" }, "product": null }
```

### 3.4 `GET /api/v1/lookup?name=…&size=…&merchant=…` — fallback

Runs **the same `decide()` path as ingestion**, not a second matcher. That is the whole point:
the extension gets exactly the answer the catalog would have given, including the refusals.

```jsonc
{
  "match": {
    "status": "confident",         // "confident" | "review" | "none"
    "by": "name+size",
    "score": 0.71,
    "reason": "name+size",         // the machine-readable reason decide() returns
    "threshold": 0.62
  },
  "product": { … }, "offers": [ … ]
}
```

- `score >= AUTO_MATCH_THRESHOLD (0.62)` → `confident`
- `score >= REVIEW_THRESHOLD (0.42)` → `review`, and **`product` is still null**. A client must
  not render a match a human has not confirmed; the status exists so it can say "possibly this"
  without our asserting it.
- below → `none`

**Must be able to answer "no confident match" rather than guessing** — this is the requirement
that makes the fallback safe, and `review` returning `product: null` is how it is met.

### 3.5 `GET /api/v1/search?q=…`

The existing `searchCatalog` ranker, as JSON.

| parameter | required | default |
|---|---|---|
| `q` | yes | — |
| `limit` | no | 20, max 50 |
| `section` | no | `grocery` |

```jsonc
{
  "query": "lapte",
  "kind": "results",               // "results" | "empty" | "brand-miss"
  "missing": [],                   // brands asked for that we do not carry
  "results": [ { "product": {…}, "comparison": {…}, "lowestBani": 749, "score": 0.83 } ]
}
```

`brand-miss` is preserved from the existing ranker: it means "we have the category but not that
brand", and flattening it into an empty result would throw away the one thing that lets a client
say something useful.

### 3.6 `POST /api/v1/basket/optimize`

**Request**

```jsonc
{
  "items": [ { "slug": "lapte-zuzu-1-5-l", "qty": 2 } ],
  "options": {
    "stores": ["auchan", "kaufland"],   // optional allow-list
    "useLoyalty": false,
    "substitution": "EQUIVALENT",       // EXACT | SAME_BRAND | EQUIVALENT | CHEAPEST
    "includeDeliveryPlatform": false
  }
}
```

Max 100 items. Slugs, never ids — ids are internal and would leak our row numbering into a
client contract.

**Response**

```jsonc
{
  "storeTotals": [ {
    "merchant": { "slug": "auchan", "name": "Auchan" },
    "goodsBani": 12750, "deliveryBani": 0, "depositBani": 250, "totalBani": 13000,
    "itemsFound": 9, "itemsMissing": 1,
    "usesLoyalty": false,
    "minOrderBani": null, "needForMinOrderBani": null, "needForFreeDeliveryBani": null
  } ],
  "split": { "totalBani": 12100, "perStore": [ … ] },
  "bestComplete": { "merchant": "auchan", "totalBani": 13000 },
  "perItem": [ {
    "slug": "…", "qty": 2,
    "chosen": { "merchant": "auchan", "priceBani": 899, "observedAt": "…" },
    "substitution": { "of": "…", "reason": "same need, cheaper pack", "mode": "EQUIVALENT" },
    "unavailableAt": ["kaufland"]
  } ],
  "unavailable": [ { "slug": "…", "reason": "no current price at any selected shop" } ]
}
```

**Substitutions always carry a reason.** A basket that quietly swaps a product for a cheaper one
and reports only the total is telling the shopper something false about what they are buying.

### 3.7 `GET /api/v1/meta`

Lets a client show honest freshness without guessing.

```jsonc
{
  "catalog": { "products": 56609, "pricedProducts": 21892, "liveOffers": 52125 },
  "merchants": [ {
    "slug": "auchan", "name": "Auchan", "storeType": "hybrid",
    "liveOffers": 5611,
    "lastObservedAt": "2026-09-10T04:12:00.000Z",
    "publishesDeepLinks": true,
    "publishesLoyaltyPrice": false
  } ],
  "comparability": { "grocery": { "comparable": 0.107, "singleShop": 0.893 } },
  "apiVersion": "v1",
  "deprecation": null              // ISO date once v2 lands, else null
}
```

`comparability` is the honest headline and it is deliberately in the meta endpoint: any client
that wants to say "we compare prices across 16 shops" can read here that **89.3% of products
have exactly one**, and phrase itself accordingly.

---

## 4. What is NOT exposed, and why

| not exposed | why |
|---|---|
| **withheld / flagged offers** | a gate refused to trust the price. No flag makes that safe to hand out. |
| `rawSourceBlob`, `rawPriceText` | the merchant's own payload, kept for parser forensics. Republishing it is republishing their data wholesale, which is a different act from quoting a price. |
| internal row ids | slugs are the contract; ids would leak our numbering and pin us to it. |
| `PriceHistory` series | deferred, not refused — it is the input to `/reduceri-reale`, which `audit:discount-truth` currently reports as **not publishable**. Exposing the series before the page that interprets it is settled invites clients to make the claim we are declining to make. |
| `MatchOverride`, `PendingMatch` | our review queue. Operational, not public. |
| anything user-scoped | lists, favourites, alerts, accounts. **This is a read API for the catalog.** A client wanting a user's list uses the site's own authenticated routes; putting them here would mean designing auth for a contract that does not need it. |
| `ProductAddCount` | an aggregate that ranks the homepage. Harmless, but it is a popularity signal we would then be committing to keep stable. |

---

## 5. Rate limits

New named limits in `lib/rate-limit.ts`, reusing the existing limiter exactly — `LIMITS` is the
one definition and `audit:rate-limit` derives its expectation from it rather than restating it
(see CLAUDE.md on the audit that reported "NO LIMIT FIRED" about a working limiter).

| limit | max / window | shared | rationale |
|---|---|---|---|
| `apiRead` | 300 / 60 s | 3,000 | product, search, meta. An extension makes one call per page view. |
| `apiLookup` | 120 / 60 s | 1,200 | tighter: this one runs the matcher. |
| `apiOptimize` | 30 / 60 s | 300 | the most expensive call by far. |

Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; a 429
carries `Retry-After`.

**The limiter cannot see an IP unless `TRUST_PROXY=1`** (`clientIp` returns `null` otherwise, by
design, because a spoofable `x-forwarded-for` is worse than none). Until that is set in
production every caller shares the `sharedMax` bucket. That is a deployment-checklist item, and
the API spec depends on it — worth stating here because a per-IP limit that cannot see an IP is
a global one wearing a per-IP name.

---

## 6. CORS

| origin | allowed | why |
|---|---|---|
| the extension | yes | `chrome-extension://<id>` and `moz-extension://<uuid>` once the ids are known. |
| our own site | not needed | same-origin. |
| `*` for `GET` | **yes**, for `product`, `search`, `meta` | these are public catalog reads. Refusing them buys nothing: anyone can fetch the HTML page. |
| `*` for `POST /basket/optimize` | **no** | it is the expensive call and an open one is a free compute service. Allow-listed origins only. |

No credentials, ever: `Access-Control-Allow-Credentials` is never set, because no v1 endpoint is
user-scoped (§4) and enabling it on a `*` origin is the classic hole.

---

## 7. Caching

Matched to the nightly cadence, not guessed:

| endpoint | `s-maxage` | `stale-while-revalidate` |
|---|---|---|
| `product`, `search` | 3600 | 86400 |
| `meta` | 900 | 3600 |
| `lookup` | 3600 | 86400 |
| `basket/optimize` | `no-store` | — |

Prices change once a night. An hour of shared cache with a day of stale-while-revalidate means a
client is never more than an hour behind the nightly, and `observedAt` in the payload tells the
truth regardless of what any cache did.

---

## 8. OpenAPI, generated

`docs/openapi.json` is **generated from the route definitions**, never hand-written. Each route
exports its Zod schemas (CLAUDE.md already requires Zod at every trust boundary), and
`npm run gen:openapi` walks them.

A hand-written spec drifts from the code the first time someone adds a field, and this project
has paid for that shape three times — `audit:sitemap`'s copied predicate, `audit:rate-limit`'s
recomputed budget, three implementations of head noun. `check:concepts` would register it.

## 9. Tests, and a probe

- **Per-endpoint unit tests**: response shape, error cases, and specifically the three that are
  easy to get wrong — a withheld offer never appears, a single-shop product returns
  `status: "single-shop"` rather than a bare array, a `review`-grade match returns
  `product: null`.
- **`npm run probe:api`**: calls every endpoint over HTTP against a running server and validates
  each response against `openapi.json`. A spec nothing checks is a document, not a contract —
  the same reason `probe:sitemap` exists.
- The probe **fails on a zero-check run**, per CLAUDE.md's rule for oracles: a run that checked
  nothing is a failure, not a pass.

---

## 10. Open questions for the reader

1. **`url` as the primary key instead of `sku`** (§0). This is the substantive change to the
   brief. If you want `sku` primary, the answer is that it works for DCNeu only.
2. **Four merchants can never be covered by an extension** — Kaufland's flyer and the three
   Glovo storefronts publish no per-product page. Worth knowing before the extension's
   per-merchant table is drawn up.
3. **`PriceHistory` stays unexposed** until `/reduceri-reale` is publishable. Say if you would
   rather ship the series and let clients interpret it.
4. **CORS `*` on GET.** I think refusing it is security theatre for public catalog data, but it
   is a decision, not a fact.
