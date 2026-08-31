// Basket optimizer, rebuilt on top of the substitution resolver.
//
// Every line is resolved PER MERCHANT, so "cheapest" accounts for what each store can
// actually supply — not just what it prices. Money is integer bani throughout.
//
// The honesty rules that make the answer trustworthy:
//   • delivery fees and free-delivery thresholds are IN the comparison
//   • a store below its minimum order is not an option
//   • a basket that cannot supply an EXACT-mode line is reported INCOMPLETE, never
//     silently cheaper for having skipped it
//   • splitting pays delivery at every online store it touches

import { resolveLine, type ListLine, type OfferLike, type Resolution, type UserContext } from "../substitution/resolve";
import type { Bani } from "../price/parsePrice";

export type MerchantInfo = {
  id: number;
  slug: string;
  name: string;
  storeType: string | null;
  deliveryFeeBani: Bani;
  freeDeliveryOverBani: Bani | null;
  minOrderBani: Bani | null;
};

export type MerchantBasket = {
  merchant: MerchantInfo;
  resolved: { line: ListLine; resolution: Resolution }[];
  substituted: { line: ListLine; resolution: Resolution }[];
  unavailable: { line: ListLine; resolution: Resolution }[];
  subtotalBani: Bani;
  deliveryFeeBani: Bani;
  totalBani: Bani;
  meetsMinimum: boolean;
  minOrderShortfallBani: Bani | null;
  needForFreeDeliveryBani: Bani | null;
  /** false when any line could not be supplied — such a basket is NOT comparable as cheaper */
  complete: boolean;
  /** an EXACT-mode line that this store cannot supply; the strongest form of incomplete */
  missingExactLines: number;
};

export type OptimizeOptions = {
  maxStores?: number;
  allowedMerchantTypes?: string[];
  requireAllItems?: boolean;
  preferPrivateLabel?: boolean;
};

export type SplitAssignment = { merchantId: number; line: ListLine; resolution: Resolution };

export type BasketResult = {
  perMerchant: MerchantBasket[];
  bestSingle: MerchantBasket | null;
  /** cheapest complete basket ignoring the minimum-order block, so the UI can say how much more to add */
  bestSingleBlockedByMinimum: MerchantBasket | null;
  split: {
    assignments: SplitAssignment[];
    storesUsed: number;
    goodsBani: Bani;
    deliveryBani: Bani;
    totalBani: Bani;
    complete: boolean;
  };
  /** what each extra store is worth: "adding Lidl saves 23,40 lei" */
  marginalStoreValue: { merchantId: number; name: string; savesBani: Bani }[];
  savingsVsSingleBani: Bani | null;
};

function deliveryFor(m: MerchantInfo, subtotal: Bani): Bani {
  if (m.deliveryFeeBani <= 0) return 0;
  if (m.freeDeliveryOverBani != null && subtotal >= m.freeDeliveryOverBani) return 0;
  return m.deliveryFeeBani;
}

/** Resolve every line at one merchant and price the resulting basket honestly. */
export function buildMerchantBasket(
  merchant: MerchantInfo,
  lines: ListLine[],
  offers: OfferLike[],
  ctx: UserContext,
  now = new Date(),
): MerchantBasket {
  const resolved: MerchantBasket["resolved"] = [];
  const substituted: MerchantBasket["substituted"] = [];
  const unavailable: MerchantBasket["unavailable"] = [];
  let subtotalBani = 0;
  let missingExactLines = 0;

  for (const line of lines) {
    const resolution = resolveLine(line, merchant.id, ctx, offers, now);
    if (resolution.status === "UNAVAILABLE") {
      unavailable.push({ line, resolution });
      if (line.substitutionMode === "EXACT") missingExactLines++;
      continue;
    }
    subtotalBani += resolution.totalBani;
    if (resolution.status === "SUBSTITUTED") substituted.push({ line, resolution });
    else resolved.push({ line, resolution });
  }

  const deliveryFeeBani = deliveryFor(merchant, subtotalBani);
  const carries = resolved.length + substituted.length;
  const meetsMinimum = merchant.minOrderBani == null || carries === 0 || subtotalBani >= merchant.minOrderBani;

  return {
    merchant,
    resolved,
    substituted,
    unavailable,
    subtotalBani,
    deliveryFeeBani,
    totalBani: subtotalBani + deliveryFeeBani,
    meetsMinimum,
    minOrderShortfallBani: meetsMinimum || merchant.minOrderBani == null ? null : merchant.minOrderBani - subtotalBani,
    needForFreeDeliveryBani:
      merchant.freeDeliveryOverBani != null && deliveryFeeBani > 0 ? Math.max(0, merchant.freeDeliveryOverBani - subtotalBani) : null,
    complete: unavailable.length === 0,
    missingExactLines,
  };
}

export function optimizeBasket(
  merchants: MerchantInfo[],
  lines: ListLine[],
  offers: OfferLike[],
  ctx: UserContext,
  opts: OptimizeOptions = {},
  now = new Date(),
): BasketResult {
  const maxStores = opts.maxStores ?? 3;
  const allowed = opts.allowedMerchantTypes;
  const pool = allowed ? merchants.filter((m) => allowed.includes(m.storeType ?? "")) : merchants;
  const effCtx: UserContext = { ...ctx, preferPrivateLabel: opts.preferPrivateLabel ?? ctx.preferPrivateLabel };

  const perMerchant = pool
    .map((m) => buildMerchantBasket(m, lines, offers, effCtx, now))
    .sort((a, b) => Number(b.complete) - Number(a.complete) || a.totalBani - b.totalBani);

  // A store that cannot supply everything is NOT a cheaper option — it is a different,
  // smaller basket. Only complete baskets compete for "best single store".
  const completeUsable = perMerchant.filter((b) => b.complete && b.meetsMinimum && (!opts.requireAllItems || b.unavailable.length === 0));
  const bestSingle = completeUsable[0] ?? null;
  const blocked = perMerchant.filter((b) => b.complete && !b.meetsMinimum);
  const bestSingleBlockedByMinimum = bestSingle ? null : blocked[0] ?? null;

  // ── split: cheapest source per line, capped at maxStores ───────────────────────────
  // Greedy by necessity — the exact set-cover is NP-hard and the practical answer is
  // "which few stores should I actually visit".
  const bestPerLine = new Map<ListLine, { merchantId: number; resolution: Resolution }>();
  for (const line of lines) {
    let best: { merchantId: number; resolution: Resolution } | null = null;
    for (const m of pool) {
      const r = resolveLine(line, m.id, effCtx, offers, now);
      if (r.status === "UNAVAILABLE") continue;
      if (!best || r.totalBani < best.resolution.totalBani) best = { merchantId: m.id, resolution: r };
    }
    if (best) bestPerLine.set(line, best);
  }

  // cap the number of stores: keep the ones carrying the most value, reassign the rest
  const byMerchant = new Map<number, number>();
  for (const b of bestPerLine.values()) byMerchant.set(b.merchantId, (byMerchant.get(b.merchantId) ?? 0) + b.resolution.totalBani);
  const keep = new Set([...byMerchant.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxStores).map(([id]) => id));

  const assignments: SplitAssignment[] = [];
  for (const line of lines) {
    const first = bestPerLine.get(line);
    if (!first) continue;
    if (keep.has(first.merchantId)) {
      assignments.push({ merchantId: first.merchantId, line, resolution: first.resolution });
      continue;
    }
    // re-source this line from the kept stores only
    let best: SplitAssignment | null = null;
    for (const id of keep) {
      const r = resolveLine(line, id, effCtx, offers, now);
      if (r.status === "UNAVAILABLE") continue;
      if (!best || r.totalBani < best.resolution.totalBani) best = { merchantId: id, line, resolution: r };
    }
    if (best) assignments.push(best);
  }

  const splitByMerchant = new Map<number, number>();
  for (const a of assignments) splitByMerchant.set(a.merchantId, (splitByMerchant.get(a.merchantId) ?? 0) + a.resolution.totalBani);
  const goodsBani = [...splitByMerchant.values()].reduce((a, b) => a + b, 0);
  // splitting pays delivery at EVERY online store it touches — the real cost of splitting
  let deliveryBani = 0;
  for (const [id, sub] of splitByMerchant) {
    const m = pool.find((x) => x.id === id);
    if (m) deliveryBani += deliveryFor(m, sub);
  }
  const splitComplete = assignments.length === lines.length;

  // ── marginal value of each additional store ───────────────────────────────────────
  const marginalStoreValue: BasketResult["marginalStoreValue"] = [];
  if (bestSingle) {
    for (const m of pool) {
      if (m.id === bestSingle.merchant.id) continue;
      let goods = 0;
      const pair = [bestSingle.merchant.id, m.id];
      let ok = true;
      const subs = new Map<number, number>();
      for (const line of lines) {
        let best: { id: number; total: number } | null = null;
        for (const id of pair) {
          const r = resolveLine(line, id, effCtx, offers, now);
          if (r.status === "UNAVAILABLE") continue;
          if (!best || r.totalBani < best.total) best = { id, total: r.totalBani };
        }
        if (!best) { ok = false; break; }
        goods += best.total;
        subs.set(best.id, (subs.get(best.id) ?? 0) + best.total);
      }
      if (!ok) continue;
      let del = 0;
      for (const [id, sub] of subs) {
        const mm = pool.find((x) => x.id === id);
        if (mm) del += deliveryFor(mm, sub);
      }
      const saves = bestSingle.totalBani - (goods + del);
      if (saves > 0) marginalStoreValue.push({ merchantId: m.id, name: m.name, savesBani: saves });
    }
    marginalStoreValue.sort((a, b) => b.savesBani - a.savesBani);
  }

  const splitTotal = goodsBani + deliveryBani;
  return {
    perMerchant,
    bestSingle,
    bestSingleBlockedByMinimum,
    split: { assignments, storesUsed: splitByMerchant.size, goodsBani, deliveryBani, totalBani: splitTotal, complete: splitComplete },
    marginalStoreValue,
    // never claim a negative saving
    savingsVsSingleBani: bestSingle && splitComplete ? Math.max(0, bestSingle.totalBani - splitTotal) : null,
  };
}
