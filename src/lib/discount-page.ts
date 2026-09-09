// The rows behind /reduceri-reale and its review surface. Read-only, shared by both, so the
// public page and the page a human reviews can never disagree about what the evidence says.
//
// ── WHICH PRICE THE VERDICT IS ABOUT, which is the whole difficulty.
//
// A merchant quoting two prices has two price HISTORIES, and its published 30-day minimum is a
// minimum over one of them. `audit:discount-truth` measured which, on Penny's 26 offers that
// quote both:
//
//     matches today's SHELF price      4
//     matches today's LOYALTY price   12
//     matches neither (a past price)  10
//
// So their figure sits on the loyalty line, and subtracting it from a shelf price is not a
// harsher comparison or a more cautious one — it is the wrong subtraction, and no careful
// wording on the page repairs a wrong subtraction. The verdict is therefore computed against
// the price on the SAME line as the retailer's figure, and the line is named in the output so
// the page can say "cu cardul Penny" rather than implying everyone pays it.
import { prisma } from "@/lib/db";
import { verifyDiscount, type DiscountEvidence } from "@/lib/discount-verify";

const MAX_AGE = 14 * 86_400_000;
const HISTORY_DAYS = 150;

export type DiscountRow = {
  offerId: number;
  productName: string;
  productSlug: string;
  merchantName: string;
  merchantSlug: string;
  productUrl: string | null;
  /** the price the verdict is about */
  priceBani: number;
  /** which line that price is on — the page must say so */
  priceLine: "SHELF" | "LOYALTY";
  shelfBani: number;
  loyaltyBani: number | null;
  evidence: DiscountEvidence;
};

/**
 * Candidates for the page, newest observation first.
 *
 * `onlyRetailerBacked` is the difference between the public page and the review surface. Our
 * own 30-day floor is not yet fit to speak from: this database's oldest observation is 34 days
 * old, seven merchants have under 11 days, and Penny's own history still mixes three pricing
 * bases (a per-unit figure, a card price, and now a shelf price). A reviewer should see those
 * rows; a shopper should not.
 */
export async function getDiscountRows(opts: { onlyRetailerBacked: boolean; limit?: number }): Promise<DiscountRow[]> {
  const cutoff = new Date(Date.now() - MAX_AGE);
  const histFrom = new Date(Date.now() - HISTORY_DAYS * 864e5);

  const offers = await prisma.offer.findMany({
    where: {
      merchant: { active: true },
      isStale: false,
      // A flagged offer is one whose price a gate refused to trust. It may not appear in a
      // feature whose entire subject is whether a price is what it claims to be.
      flagged: false,
      availability: "in stock",
      lastObservedAt: { gte: cutoff },
      ...(opts.onlyRetailerBacked ? { referencePriceKind: "OMNIBUS_30D" } : {}),
    },
    select: {
      id: true, priceBani: true, price: true, loyaltyPriceBani: true,
      oldPriceBani: true, oldPrice: true, productUrl: true,
      referencePriceBani: true, referencePriceKind: true,
      merchant: { select: { name: true, slug: true } },
      product: { select: { name: true, slug: true } },
      history: { where: { recordedAt: { gte: histFrom } }, select: { priceBani: true, price: true, recordedAt: true } },
    },
    orderBy: { lastObservedAt: "desc" },
    take: opts.limit ?? 400,
  });

  const rows: DiscountRow[] = [];
  for (const o of offers) {
    const shelfBani = o.priceBani ?? Math.round(o.price * 100);
    const omnibus = o.referencePriceKind === "OMNIBUS_30D" ? o.referencePriceBani : null;

    // The retailer's figure is on the loyalty line where one exists — see the note above.
    const useLoyalty = omnibus != null && o.loyaltyPriceBani != null;
    const priceBani = useLoyalty ? (o.loyaltyPriceBani as number) : shelfBani;

    const advertisedWasBani =
      o.oldPriceBani ?? (o.oldPrice != null ? Math.round(o.oldPrice * 100) : null) ??
      (o.referencePriceKind === "STRIKETHROUGH" ? o.referencePriceBani : null);

    const evidence = verifyDiscount({
      currentBani: priceBani,
      advertisedWasBani,
      omnibus30dBani: omnibus,
      history: o.history.map((h) => ({ priceBani: h.priceBani ?? Math.round(h.price * 100), recordedAt: h.recordedAt })),
    });

    rows.push({
      offerId: o.id,
      productName: o.product.name,
      productSlug: o.product.slug,
      merchantName: o.merchant.name,
      merchantSlug: o.merchant.slug,
      productUrl: o.productUrl,
      priceBani,
      priceLine: useLoyalty ? "LOYALTY" : "SHELF",
      shelfBani,
      loyaltyBani: o.loyaltyPriceBani,
      evidence,
    });
  }
  return rows;
}

/**
 * WE CANNOT TELL WHICH PRICE LINE THE RETAILER'S FIGURE IS ON, for a merchant quoting two.
 *
 * The first version of this file asserted it was the loyalty line, on the strength of Penny's
 * LAMÂI (shelf 8,99 · card 5,99 · their figure 6,99 — exactly the card price we recorded on 30
 * August). Measured across all 26 of Penny's offers that quote both prices, that is not what
 * the data says:
 *
 *     matches today's SHELF price      4        BARILLA: their 6,09 IS today's shelf price
 *     matches today's LOYALTY price   12
 *     matches neither (a past price)  10
 *
 * So it is mixed, per row, and the consequence is concrete rather than theoretical. Rendering
 * BARILLA meant publishing "prețul de acum 4,26 este sub 6,09 — economisești 1,83" about Penny,
 * when 6,09 is plausibly the minimum of the SHELF line and the card price may have been 4,26
 * throughout. That is a saving we would have announced and cannot support.
 *
 * A one-price merchant has no such ambiguity, so the rule is not "never publish" — it is
 * "publish only where the subtraction is unambiguous".
 */
export function basisIsAmbiguous(r: DiscountRow): boolean {
  return r.evidence.omnibus30dBani != null && r.loyaltyBani != null && r.loyaltyBani !== r.shelfBani;
}

/**
 * What a shopper may see: a real reduction, backed by the retailer's OWN figure, on a price
 * line we can identify, with nothing queued for review. Deliberately not "everything that isn't
 * obviously wrong" — the default for a page that names a company is silence.
 *
 * THIS FILTER AND `audit:discount-truth` MUST NOT BE ABLE TO DISAGREE. The audit reports
 * PUBLISHABLE: NO while this returned seven Penny rows, and two verdicts that can disagree is
 * how a reader learns to ignore both (CLAUDE.md). The ambiguity rule is what reconciles them:
 * the audit refuses the feature for the same reason this refuses every row.
 */
export function publishable(rows: DiscountRow[]): DiscountRow[] {
  return rows
    .filter((r) => r.evidence.verdict === "REDUCERE_REALA")
    .filter((r) => r.evidence.baselineSource === "RETAILER")
    .filter((r) => !r.evidence.needsReview)
    .filter((r) => !basisIsAmbiguous(r))
    .sort((a, b) => b.evidence.realSavingBani - a.evidence.realSavingBani);
}
