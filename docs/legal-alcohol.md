# Alcohol: what I found, and what needs a lawyer

**Status: report only. Nothing has been changed.** Requested alongside the tobacco exclusion,
which *was* acted on because that one is not a close call.

**I am not a lawyer and this is not legal advice.** What follows is the shape of the exposure
as best I can establish it, the specific questions a Romanian lawyer should be asked, and the
mitigations that are cheap enough to do regardless of the answer. Where I am unsure I say so
rather than guessing — the whole point of raising this before launch is to get a real answer.

## What the site currently does

| | |
|---|---|
| Section | `alcohol`, UI label "Alcool", at `/alcool` |
| Catalog | 1,549 products |
| Offers | 1,602, of which **1,577 live** |
| Merchants | carrefour (1,231), finestore (277), lemanoir (94) |
| Age gate | **none anywhere on the site** — grep for age/majorat/18 ani returns nothing |
| Sales | none. CoșMic compares and links out; every transaction happens on the merchant's site |

That last row is the load-bearing fact for most of what follows.

## The distinction that matters: we do not sell

Romanian obligations around alcohol split into two families, and they land on different parties.

**Sale-side.** Selling or serving alcohol to a person under 18 is sanctioned under Legea
61/1991 (public order). The obligation sits on the *seller*. CoșMic is not the seller: the
basket links out, the merchant takes the order, the merchant delivers, and the merchant is
the one who must verify age at delivery. Nothing here transfers that duty to us.

**Communication-side.** Legea 148/2000 on advertising restricts alcohol advertising —
broadly, it must not be directed at minors, must not appear in media aimed at minors, must
not link alcohol to driving, physical performance or social/sexual success, and spirits carry
additional constraints. **This is the family that could plausibly reach us**, because a page
that displays alcohol products with prices is a commercial communication even though we take
no money for the sale.

I could not establish that Romanian law imposes a *general* age-verification requirement on a
website that merely displays alcohol prices. Age gates are common industry practice on RO
retailer sites, but practice is not the same as a statutory duty, and I am not going to assert
one I cannot point to.

## The questions for a lawyer

1. Does a price-comparison listing of alcohol constitute "publicitate" under Legea 148/2000,
   given we receive no payment from the producer and take no part in the sale? If it does,
   which of the content restrictions bind us in practice?
2. Is an age gate legally required, or only good practice? If only practice, does having one
   *reduce* exposure under (1) by evidencing that the communication is not aimed at minors?
3. Do spirits (`bauturi spirtoase`) need the statutory warning text that applies in other
   media, when shown in a listing?
4. Does affiliate revenue change the answer? We do not have affiliate links on alcohol today,
   but `Offer.affiliateUrl` exists in the schema and this is a business the owner intends to
   monetise.
5. Is there anything specific about **showing a discount** on alcohol — the site computes
   drops and a "cheapest" badge — that the advertising rules treat differently from showing a
   plain price?

## What is cheap enough to do anyway

None of these needs a legal answer first, and all of them are reversible.

- **An age confirmation before `/alcool` and alcohol product pages.** A remembered
  yes/no interstitial. Low cost, no effect on grocery, and it is the single most visible
  signal that the section is not aimed at minors.
- **Keep alcohol out of the default basket optimiser and out of any "cheapest this week"
  surface that appears on the homepage.** Someone comparing milk should not be shown spirits.
- **No alcohol in anything that could reach a minor by default** — the PWA push/alerts
  feature, and any future email digest.
- **Do not put a discount badge on spirits** until question (5) is answered. The plain price
  is the comparison; the percentage-off framing is the part that reads as promotion.

## What I would not do

Excluding alcohol the way tobacco was excluded. Tobacco was a clear call — an explicit
statutory prohibition on promotion, and a product a grocery basket optimiser has no reason to
carry. Alcohol is legal to advertise within limits, the section is 1,549 products and a real
part of the shop, and removing it on my own reading of a law I cannot cite precisely would be
the wrong kind of caution.

## Related, and already decided

Tobacco and nicotine are excluded at the pool in `src/lib/excluded-categories.ts`, before
matching, under Legea 349/2002 (tobacco) and Legea 201/2016 (e-cigarettes and refills).
63 products were already in the catalog and are withheld.

One row in that 63 is flagged for the owner as a likely false positive: a farmaciatei nicotine
**replacement** spray, which is a cessation medicine rather than a tobacco product, and which
a one-line carve-out would restore.
