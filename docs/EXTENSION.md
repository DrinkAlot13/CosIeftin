# The browser extension

Shows our other-shop prices while someone is on a retailer's own product page. Manifest V3,
Chrome and Firefox from one codebase.

---

## 1. The per-merchant table — measured before any adapter was written

`npm run probe:extension-ids` fetches one real product page per merchant and reads what is
actually on it. Run 2026-09-10:

| merchant | live offers | we store | on the page | verdict |
|---|---|---|---|---|
| auchan | 5,611 | url + ean | JSON-LD `sku`, canonical, og:url | url → exact |
| carrefour | 5,279 | url | JSON-LD `sku`, canonical | url → exact |
| dcneu | 10,811 | url + **sku** | JSON-LD `sku`, `itemprop=sku`, canonical | **sku → exact** |
| farmaciatei | 2,021 | url | *robots.txt blocked our probe* | url → exact |
| finestore | 279 | url | JSON-LD `sku`, canonical | url → exact |
| freshful | 3,156 | url | canonical, og:url | url → exact |
| lemanoir | 94 | url | canonical, og:url | url → exact |
| mega-image | 6,886 | url | JSON-LD Product (no id), canonical, og:url | url → exact |
| metro | 5,439 | url | URL only | url → exact |
| penny | 29 | url | canonical | url → exact |
| selgros | 25 | url | JSON-LD `sku`, canonical, og:url | url → exact |
| sezamo | 8,172 | url | JSON-LD `sku`, canonical, og:url | url → exact |
| **glovo-kaufland** | 2,257 | — | **no per-product page** | **impossible** |
| **glovo-penny** | 676 | — | **no per-product page** | **impossible** |
| **glovo-profi** | 1,121 | — | **no per-product page** | **impossible** |
| **kaufland** | 269 | — | **flyer only, no per-product page** | **impossible** |

**11 merchants are usable, covering 45,781 live offers. Four cannot be covered at all** — the
Kaufland flyer and the three Glovo storefronts publish no per-product page, so there is nothing
for a content script to stand on. That is declared in `lib/source-capabilities.ts`, not inferred
from a null count.

### The finding that made this smaller than the brief assumed

**Every usable merchant is identifiable by URL alone**, and our API takes URL as its primary key
(`docs/API.md` §0). So there is **no per-merchant identifier adapter**. The brief called this
"the hard part"; the measurement says it does not exist. What is per-merchant is only *where on
the page* to place the panel, and the panel is position-fixed, so at present that is nothing
either.

`dcneu` is the one merchant where SKU would also work — it is the only one of sixteen storing
one (96%; everyone else is 0%). URL works there too, so the extension uses one path for all.

On **farmaciatei**: `robots.txt` blocked our *probe*, which is a rule for crawlers. A person's
own browser rendering a page they navigated to is not crawling, and the extension sends only
that URL to our API. Listed as usable, with the distinction stated rather than glossed.

---

## 2. Chrome vs Firefox — what actually differs

Both run the same `manifest.json`, `content.js` and `panel.css`. The differences are small and
all of them are handled:

| | Chrome / Edge | Firefox |
|---|---|---|
| API namespace | `chrome.*` | `browser.*` (promise-based) and `chrome.*` |
| MV3 background | `service_worker` | event pages — **we ship no background script at all**, so this does not arise |
| `browser_specific_settings` | ignored | **required** for an id and a minimum version |
| host permissions | granted at install for listed hosts | **user must grant per site** on first use |
| storage | `chrome.storage.local` | same API |

`content.js` aliases `browser ?? chrome` in one line, which is the entire cross-browser layer.

**The one real behavioural difference**: Firefox treats listed `host_permissions` as *optional*
and may ask the user per site. The extension already handles being absent — it simply does not
run — so a declined permission degrades to "no panel", never to an error.

Firefox also requires `browser_specific_settings.gecko.id` for signing; it is
`cosmic@cosmic.ro` and it is in the manifest.

---

## 3. Permissions, and why each one

| permission | why |
|---|---|
| `storage` | remembering that you closed the panel, for 24 hours. Nothing else. |
| 13 `host_permissions` | one entry per shop domain. **Never `<all_urls>`** — the extension cannot work anywhere else, because there is no comparison to show for a site whose prices we do not hold. |

No `tabs`, no `webRequest`, no `scripting`, no `cookies`, no `activeTab`. A permission that
cannot be justified is one that should not be asked for, and each of those would let the
extension see something it has no reason to see.

---

## 4. Privacy — the claim, and the code that has to match it

`extension/PRIVACY.md` is the user-facing statement. In one sentence: **it sends the address of
the product page you are looking at, and nothing else.**

What makes that true in the code rather than only in the document:

- The only network call is `fetch(API + "/api/v1/lookup?url=" + encodeURIComponent(location.href))`.
  There is exactly one `fetch` in the file.
- `credentials: "omit"` — no cookie is ever attached, so there is no session to correlate.
- The script reads `location.href`. It does not read the DOM's text, the cart, the account, or
  form fields.
- No id is generated or stored, so two visits from one browser are indistinguishable server-side.
- It is not injected outside the thirteen listed domains, so there is no page it *could* read.

---

## 5. The five rules the panel obeys

1. **Never modify the merchant's page.** One fixed-position element appended to `<body>`; no
   price rewritten, nothing hidden, no style injected into their tree. Every CSS selector is
   namespaced under `#cosmic-panel`.
2. **Never cover the price or the buy button.** Bottom-right, bounded, and on screens under
   520px it becomes a short bottom bar — because on a narrow layout the buy button is usually
   exactly where a floating card would land.
3. **One API call per product page.** Guarded by `window.__cosmicRan` and by a conservative
   product-page test, so browsing a category does not ask about every tile. An extension that
   walks a listing on the user's connection is a crawler wearing a user's IP address.
4. **"Nu avem un preț de comparație pentru acest produs" is a clean answer**, with a second line
   saying we find it at one shop only. 89% of priced products have exactly one shop — this is
   the common case, and rendering nothing would be a bug that looks like working.
5. **If the API is down or slow, say nothing and disappear.** 4-second abort, and any non-OK
   response returns silently. The panel must never break the page it sits on.

Plus the one inherited from the site: **never claim a comparison we would withhold.** The API
does not emit withheld rows under any parameter, and a `review`-grade match returns
`product: null` — the extension renders neither, so it cannot assert what we decline to.

---

## 6. Not done yet

- **Not loaded into a real browser.** The code is written and reviewed; it has not been
  installed in Chrome or Firefox, because that needs a human at a browser. Everything above
  about placement and behaviour is design intent, not observed behaviour.
- **`API` points at `https://cosmic.ro`**, which does not exist yet. It is one constant at the
  top of `content.js` and must be set at packaging time.
- **CORS**: `/api/v1/lookup` returns `access-control-allow-origin: *` for public GETs, so the
  extension needs no allow-list entry. Verified by `probe:api`.
- **No store submission.** Both stores want screenshots, a description and a privacy
  disclosure; the privacy disclosure must match `PRIVACY.md` and `/confidentialitate` exactly.
