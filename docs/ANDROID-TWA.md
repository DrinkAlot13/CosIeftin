# Android: the TWA route

**Report only. Nothing built.** A Trusted Web Activity wraps the PWA that already exists rather
than reimplementing it. It is blocked on a domain and a host, both of which are after the soak.

---

## 1. What Bubblewrap needs from us

Bubblewrap reads the live manifest (`bubblewrap init --manifest=https://<domain>/manifest.webmanifest`)
and generates an Android project. It needs a **reachable HTTPS URL** — it cannot init from a local
file, which is the first hard blocker.

### Manifest — audited against `public/manifest.webmanifest`

| what Bubblewrap uses | required | ours | verdict |
|---|---|---|---|
| `name` | yes | "CoșMic — compară prețuri la alimente" | ✅ |
| `short_name` | yes (launcher label) | "CoșMic" | ✅ |
| `start_url` | yes | `/lista` | ✅ |
| `scope` | yes | `/` | ✅ — everything on-site stays in-app |
| `display` | `standalone` or `fullscreen` | `standalone` | ✅ |
| `orientation` | optional | `portrait` | ✅ |
| `theme_color` | yes (status bar) | `#16a34a` | ✅ |
| `background_color` | yes (splash ground) | `#ffffff` | ✅ |
| icon ≥512×512 PNG | yes (launcher) | `icon-512.png` | ✅ |
| **maskable** icon ≥512 | yes (adaptive icon) | `icon-512.png`, `purpose: "maskable"` | ✅ |
| `lang` | optional | `ro` | ✅ |
| `id` | recommended | **absent** | ⚠️ add `"id": "/"` — pins PWA identity if `start_url` ever moves |

**Splash screens need no asset.** Bubblewrap composes them from the 512 icon and
`background_color`; there is nothing to draw.

**The manifest is essentially ready.** One optional `id` field is the entire gap, which is the
payoff from having built the PWA properly in session 2.

### Digital Asset Links — the part that is actually missing

`https://<domain>/.well-known/assetlinks.json`, served over HTTPS, `content-type:
application/json`, **no redirect**, publicly readable:

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "ro.cosmic.app",
    "sha256_cert_fingerprints": ["<SHA-256 of the APP SIGNING key>"]
  }
}]
```

This is what removes the address bar. Without it the app still runs — as a Custom Tab, with a URL
bar across the top, which looks like a browser someone skinned.

**We serve no `.well-known` at all today** — there is no such directory in `public/` and no route
for it. Two ways to add it, and the second is safer: a static file at
`public/.well-known/assetlinks.json`, or a route handler at
`src/app/.well-known/assetlinks.json/route.ts`. The route handler is preferable because some
hosts and CDNs refuse to serve dot-directories, and this failing is invisible — the app just
quietly shows an address bar.

**The gotcha that catches nearly everyone**: the fingerprint must be the **Play App Signing**
certificate, not the upload key. Google re-signs on their side, so the cert the device sees is
theirs. It is available in Play Console → Setup → App integrity, **only after the first upload**.
That forces an ordering:

1. build and upload with the upload key,
2. read the app-signing SHA-256 out of Play Console,
3. publish `assetlinks.json` with it,
4. only then does the address bar disappear.

Between (1) and (3) the app is verifiably yours but still shows the bar. Expect that and do not
debug it.

## 2. What breaks in a TWA that works in a browser tab

Honestly, and the first two are the ones that matter:

1. **The first launch needs network, and our whole in-shop story assumes it does not.** A TWA
   uses Chrome's engine, so `sw.js` works — but the service worker is not installed until a first
   successful load. Someone who installs from Play in the car park and opens it in the aisle on a
   dead signal gets `offline.html`. `/lista/in-magazin` was built precisely for that moment.
   Mitigation is a first-run online requirement, which is a real product wart.
2. **Every merchant deep link leaves the app.** "Vezi în magazin" points at `auchan.ro`,
   `mega-image.ro` and eleven others — all outside `scope`, so Android opens a Custom Tab with an
   address bar. That is correct and expected TWA behaviour, and it is also the app's most-used
   action, so the seam is visible constantly.
3. **Clearing Chrome's site data wipes the shopping list, silently.** A TWA shares Chrome's
   profile for its origin, so `localStorage` (`cosmic_carts`, `cosmic_basket_cache_v1` — where the
   entire basket lives) is the same storage the browser uses. Good: a list started on the website
   is already there in the app. Bad: "clear browsing data" is a destructive action on app data,
   taken outside the app, with no warning from us.
4. **Verification fails open, not closed.** A malformed or unreachable `assetlinks.json`
   downgrades to a Custom Tab with no error anywhere. It looks like a design choice.
5. **The Android back button is history, not navigation.** At `start_url` it exits the app. Any
   screen a user reaches by replacing state rather than pushing it becomes a trap.
6. **Cold start is Chrome starting.** Slower than a native app, noticeably on cheap hardware —
   which is a real share of the audience for a price-comparison app.
7. **Chrome must be present and ≥72.** On devices shipping without Play Services this falls back
   to a plain browser.
8. **Play's minimum-functionality policy is a genuine rejection risk.** A TWA that is only a
   website in a shell gets rejected under "apps that provide no functionality beyond a web page".
   The install-time shortcuts, the offline mode and the in-shop screen are the defence, and they
   are real — but it is a judgement call by a reviewer, not a checkbox we can pre-satisfy.

**Not a problem, contrary to expectation:** web push works in a TWA on Android (unlike an iOS
PWA), so price alerts would not need native. That capability is available and unevidenced —
`PriceAlert` holds 0 rows.

## 3. Play Store requirements

| requirement | status |
|---|---|
| Developer account, $25 once | not enrolled |
| **Identity verification** (personal accounts) | not done — needs real ID and an address |
| **20 testers × 14 days closed testing** before production, for new personal accounts | **not started, and it is 2 weeks of calendar time** |
| Privacy policy at a live public URL | page exists at `/confidentialitate`, **no host** — see below |
| Data safety form | must match the policy exactly; see below |
| Content rating (IARC) | the `alcohol` section needs a deliberate answer |
| Target API level | Play requires a recent API for new apps and raises it every August. Bubblewrap's generated project must be bumped at each submission — one chore a year, forever |
| App icon 512×512 32-bit PNG | ✅ `public/icons/icon-512.png` |
| Feature graphic 1024×500 | **does not exist** |
| Phone screenshots, min 2 | **do not exist** |
| Account deletion, in-app **and** at a web URL | **not built** — see `docs/ACCOUNT-DELETION.md` |

### What the data safety form would have to claim

Grounded in the schema, not in memory of what we built:

- **Email address** — collected, required for an account, linked to identity. `User.email`.
- **Password** — `User.passwordHash`. Declared as credentials; hashed, not reversible.
- **Telegram chat id** — `PriceAlert.chatId`, only if someone links the bot. Deliberately **not**
  linked to the account, which the form has to express as a separate, unlinked collection.
- **Shopping lists** — **not collected.** They live in `localStorage`. `GroceryList` exists in the
  schema and is dormant; nothing in `src/` writes it, and the schema comment says so in as many
  words. Wiring up list sync would make both this form and the policy false the day it lands.
- **No location, no contacts, no device id, no advertising id, no analytics SDK.**

**Does the draft support this? Yes, and it is unusually well positioned** — `/confidentialitate`
was written from an audit of persisted fields rather than from memory, and it already names the
Telegram chat id as separate data with its own erasure route. Two caveats: it is **a draft that
has not had a lawyer's hour**, and it names a hosting processor that does not exist yet, because
we have no host. The data safety form cannot be filled in before the hosting decision, since
"who processes this data" is an answer on the form.

## 4. Account deletion

Google now requires it in-app **and** at a web URL reachable without installing the app — that
second half is the one people miss, and a TWA satisfies it trivially because the TWA *is* the
website. One route serves both stores.

Full design in **`docs/ACCOUNT-DELETION.md`**. Not built. The short version: session-authenticated,
re-asks for the password, typed confirmation, and it must call the same `eraseUserById()` the
operator script calls rather than reimplementing "everything attached to a person".

## 5. Signing, and where the key lives

- Bubblewrap generates an **upload keystore** (`android.keystore`, alias `signingKey`, two
  passwords).
- **Opt in to Play App Signing.** Google then holds the app signing key. If the upload key is
  lost, Google can reset it. If you opt *out* and lose the app signing key, the package name is
  permanently unpublishable — there is no recovery and no appeal.
- **The keystore never enters the repo.** `.gitignore` currently has no entry for `*.keystore`,
  `*.jks` or `android/` — those need adding *before* `bubblewrap init` runs, not after, because
  the first commit that includes a keystore has published it whatever happens next.
- Where it lives: the password manager, plus one offline copy that is not on this machine. The
  two keystore passwords go with it. Losing all copies of the upload key is recoverable via
  Google; losing the password manager is not, so treat them as one artefact.
- `assetlinks.json` needs the **app signing** SHA-256, not the upload one. See §1.

## 6. TWA vs Expo — the comparison

The scanner is dead (2.5% via OFF, 19% via our own EANs, and `docs/EAN-COVERAGE.md` establishes
there is nothing to harvest). Push has no evidence: 0 alert rows. So the two features that
normally justify a native codebase both currently justify nothing.

| | TWA (Bubblewrap) | Expo / React Native |
|---|---|---|
| codebase | **none** — wraps the deployed site | a second full app; every screen reimplemented |
| effort to first submission | ~1–2 days, almost all store assets and config | weeks, then ongoing |
| iOS | **none.** No TWA equivalent; Apple rejects thin webview wrappers under 4.2 more readily than Google | both platforms from one codebase — the real argument for it |
| shipping a fix | deploy the website; the app is already updated | store review, or EAS Update for JS-only changes |
| offline | the existing service worker, with the first-launch caveat | genuine native storage, no first-run requirement |
| barcode scanning | via `getUserMedia`, and pointless at 19% | native and fast, and **still pointless at 19%** |
| push | web push works on Android | native push both platforms |
| maintenance | one target-API bump a year | dependency churn, two store review cycles, native build breakage |
| rejection risk | minimum-functionality policy | lower |

**What separates them is not features, it is iOS and update latency.** Expo buys iOS presence and
nothing else we can currently measure. TWA buys an Android listing for roughly the cost of the
store assets, and keeps the single codebase that makes a fix reach users the moment it deploys.

**What would change the answer:** iOS demand we can point at, or a scanner that works — and the
second is now measured closed at both routes.

## 7. Order of operations, when it is time

1. Domain, then host, then HTTPS. Everything else is blocked on this.
2. `SITE_URL` / `TRUST_PROXY`, deploy, confirm the PWA installs from the real origin.
3. Add `"id": "/"` to the manifest; add the `.well-known/assetlinks.json` route (empty array is
   fine until the fingerprint exists).
4. Build the account-deletion route — needed for submission either way.
5. `.gitignore` the keystore patterns, **then** `bubblewrap init`.
6. Upload, read the app-signing fingerprint, publish `assetlinks.json`, verify the address bar is
   gone on a real device.
7. Identity verification and the 20-tester/14-day closed test — start this early, it is the long
   pole and it is calendar time, not work.
