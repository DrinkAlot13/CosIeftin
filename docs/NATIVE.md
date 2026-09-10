# Native apps — the measurement that comes first

**Status: NOT STARTED, deliberately, on two independent grounds.** Neither is a scheduling
excuse; both are conditions the brief itself set.

---

## 1. The scanning gate — measured, and it fails

`npm run audit:off-hitrate` — 200 real barcodes from products we carry, against Open Food Facts,
2026-09-10.

The brief set the bar: *"report the hit rate. If it is under 50%, scanning is not worth shipping
and we should say so."*

### Route 2 — scan → EAN → Open Food Facts → name → our matcher

| outcome | n | share |
|---|---|---|
| **HIT** — the matcher landed on the product the barcode came from | 5 | **2.5%** |
| **WRONG** — the matcher was confident and picked a *different* product | 1 | 0.5% |
| NO_MATCH — OFF gave a name, our matcher refused every candidate | 38 | 19.0% |
| NO_NAME — OFF has the record, no usable name | 4 | 2.0% |
| ABSENT — OFF has never heard of this barcode | 152 | **76.0%** |

**2.5%, against a bar of 50%.** It fails by a factor of twenty.

Two independent causes, and the first is the larger:

- **OFF does not have Romanian groceries.** It knew 48 of 200 barcodes. Three quarters of what a
  Romanian shopper would scan is simply not in the database.
- **When it does, its `quantity` is unusable.** Diagnosed on real records: `quantity: "1,5"` with
  no unit, or absent entirely. `decide()` rejects on `size-unit` before it looks at anything
  else — correctly, because a size it cannot read is a size it must not assume. Of the 48 OFF
  knew, 38 died here.

### Route 1 — the barcode is already ours

**This was not in the brief and it is the better route.** The brief reasons that "no second
grocery merchant publishes an EAN, so a scanned barcode has nothing to match against". That is
true of using an EAN to *join two merchants' offers*, which is what `audit:ean` measured. It is
not the question a scanner asks. A scanner asks **"which product am I holding"**, and our own
stored EAN answers that exactly — no OFF, no matcher, no threshold, no wrong answers.

**6,269 of 32,944 priced grocery products — 19.0% — carry an EAN we stored.** And it is one
merchant carrying it:

| merchant | live grocery offers | product has an EAN | share |
|---|---|---|---|
| **auchan** | 5,606 | 5,341 | **95.3%** |
| glovo-profi | 1,116 | 238 | 21.3% |
| carrefour | 4,075 | 662 | 16.2% |
| glovo-penny | 676 | 105 | 15.5% |
| kaufland | 265 | 26 | 9.8% |
| mega-image | 6,881 | 665 | 9.7% |
| freshful | 3,153 | 286 | 9.1% |
| glovo-kaufland | 2,253 | 190 | 8.4% |
| metro | 5,433 | 425 | 7.8% |
| sezamo | 8,169 | 580 | 7.1% |
| selgros | 25 | 1 | 4.0% |
| penny | 27 | 0 | 0.0% |

Auchan is at 95.3% because it publishes an EAN per product and we read it. **Every other
merchant is at or below 21.3%** — and Sezamo, our largest by live offers, is at 7.1%. This is
the number to raise if scanning is ever wanted, and it is a scraping target rather than a
matching one.

### The combined honest estimate

A shopper scanning a random product we carry is identified about **one time in five**, and the
OFF contribution to that is under three points. Four scans in five would return *"nu știu"*.

### The one WRONG case is the reason this cannot ship at any hit rate

```
5203149006215   score 0.84
  ours:    Smantana de gatit Olympus, 20% grasime, 200 ml
  OFF:     Smântână lichidă pentru gătit
  matched: Smantana lichida pentru gatit UHT 20% grasime 200ml
```

OFF's name dropped the brand, so the matcher confidently placed it on a **different
manufacturer's** cream of the same size. A scanner showing that would state one product's price
for another, in a shop, to someone about to buy it. One in 200 confident answers being wrong is
worse than the 2.5% hit rate, because the shopper cannot tell which kind they got.

### Verdict

**Do not build the scanner.** If it is ever revisited, the route is route 1 — raise our own EAN
coverage above 19% by capturing the EANs merchants already publish — not OFF. That is a
scraping problem with a measurable target, and it makes the answer *exact* rather than probable.

---

## 2. Native is blocked on the PWA regardless

The brief: *"Do NOT start this until the PWA has been in real use and we know people open it in
a shop."*

The PWA's in-shop screen was built today (`/lista/in-magazin`, session 2). It has been in real
use for zero days by zero people. **The precondition is not met**, and the loop it is supposed
to prove — does anyone actually open this in an aisle — cannot be short-circuited by building
the native app that was meant to depend on the answer.

The two features that justify native are also weaker than they look now:

- **Barcode scanning** — measured above at 2.5% via OFF, 19% via our own EANs. This was the
  headline reason for native, and it does not currently work.
- **Push notifications for price alerts** — real, and genuinely something the PWA cannot do
  reliably on iOS. But `PriceAlert` currently holds **0 rows**, so there is no evidence anyone
  wants the alerts we already have, on any platform.

That leaves "proper offline storage rather than a service worker cache" — which the PWA already
does through `localStorage`, and which nobody has yet reported as insufficient.

---

## 3. What each store will ask for that we do not have

Reported now because it is cheap to know and expensive to discover late.

| requirement | status |
|---|---|
| Apple Developer Program, $99/year | not enrolled |
| Google Play Developer, $25 once | not enrolled |
| A privacy policy URL | **have it** — `/confidentialitate`, drafted and lawyer-unreviewed |
| Apple privacy "nutrition label" | must match `/confidentialitate` **exactly**. Today that means declaring: email address (account), and nothing linked to identity. A label that overstates collection is as much a problem as one that understates. |
| Google Play Data Safety form | same, plus a declaration for the camera permission scanning would need |
| Camera permission justification | **not applicable while scanning is not shipped** — and asking for a camera an app does not use is a rejection |
| Account deletion **in-app** | **A HARD BLOCKER.** Apple requires apps with account creation to offer account deletion *inside the app*. We have `erase:user` (an operator script) and an e-mail route. That satisfies GDPR; it does not satisfy App Store Review Guideline 5.1.1(v). |
| Support URL and marketing contact | `contact@cosmic.ro` — the mailbox is unconfirmed |
| Screenshots per device class | none exist |
| Age rating questionnaire | the alcohol section will need a deliberate answer |

**The account-deletion requirement is the one to note.** It is the same gap the privacy audit
found, at a higher bar: GDPR accepts "write to us", Apple does not.

---

## 4. If it is ever picked up

One Expo / React Native codebase, both platforms, consuming `/api/v1` — which is why the API was
specified before any client existed. Nothing in `docs/API.md` needs to change to support a native
client; `product`, `search`, `lookup` and `basket/optimize` are the whole surface it would use.
