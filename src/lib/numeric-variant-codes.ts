// THE ONE PLACE THAT KNOWS WHAT A "NUMERIC VARIANT CODE" IS.
//
// `scripts/audit-numeric-variant-codes.ts` (measures the blindness) and
// `scripts/withhold-numeric-variant-codes.ts` (acts on it) both need the exact same population —
// re-deriving it twice is how `audit:sitemap` and `audit:rate-limit` went stale (CLAUDE.md, ONE
// NAMED CONCEPT ONE IMPLEMENTATION). One definition, imported by both.
//
// See `scripts/audit-numeric-variant-codes.ts` for the full defect writeup: `overlapTokens()`
// strips a bare numeric token as size noise whether or not it is actually a size, so a shade
// ("613"), a shrimp-count grade ("30/40") or an age statement ("24 luni") is invisible to
// `decide()` — the same shape as the doseTokens regression. THIS MODULE DOES NOT TOUCH
// SIZE_TOKEN OR overlapTokens; it reuses `overlapTokens`'s own output to find what it drops.

import type { PrismaClient } from "@prisma/client";
import { overlapTokens } from "./scrape-util";
import { normalizeText } from "./matching";

/**
 * A stripped bare numeric token that does not plausibly restate the product's own size, AND is
 * not already compared explicitly by `doseTokens()` under a different name. `doseTokens()` reads
 * mg/UI/mcg strengths and `N%` (fat, alcohol, concentration) off the RAW name before punctuation
 * is stripped — so "20% grasime" becomes a bare "20" once normalizeText drops the `%`, but the
 * matcher never loses that discriminator; it sees it via doseTokens instead. Counting it here
 * would overstate the population this project is actually blind to.
 */
export function candidateCodes(name: string, unit: string, unitSize: number): string[] {
  const norm = normalizeText(name);
  const raw = norm.split(/\s+/).filter(Boolean);
  const kept = new Set(overlapTokens(norm));
  const stripped = raw.filter((t) => !kept.has(t) && /^\d{2,4}$/.test(t));
  if (stripped.length === 0) return [];

  // Does this bare number plausibly restate the parsed size, in ANY common scaling? kg->g
  // (x1000), l->ml (x1000), l->cl (x100), or the size itself rounded. A candidate that matches
  // NONE of these is not a restatement of the size the product already carries.
  const plausibleSizeNumbers = new Set(
    [unitSize, unitSize * 1000, unitSize * 100, Math.round(unitSize), Math.round(unitSize * 1000), Math.round(unitSize * 100)]
      .map((n) => String(Math.round(n))),
  );
  // Numbers doseTokens already extracts from the raw (pre-strip) name: N% and N mg/ui/iu/mcg.
  const doseCovered = new Set<string>();
  for (const m of name.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)) doseCovered.add(String(Math.round(parseFloat(m[1].replace(",", ".")))));
  for (const m of name.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:mg|ui|iu|mcg)\b/gi)) doseCovered.add(String(Math.round(parseFloat(m[1].replace(",", ".")))));

  return stripped.filter((t) => !plausibleSizeNumbers.has(String(Number(t))) && !doseCovered.has(String(Number(t))));
}

/** Normalized name with every candidate code removed — what two names look like to the matcher. */
export function withoutCodes(name: string, codes: string[]): string {
  const norm = normalizeText(name);
  const codeSet = new Set(codes);
  return norm.split(/\s+/).filter((t) => !codeSet.has(t)).join(" ");
}

export type NumericCodeClusterOffer = { id: number; priceBani: number | null; price: number };
export type NumericCodeClusterMember = { productId: number; productName: string; code: string; offers: NumericCodeClusterOffer[] };
export type NumericCodeCluster = {
  merchantId: number;
  merchantSlug: string;
  merchantName: string;
  storeName: string;
  physicalScoped: boolean; // already withheld by the flyer-fanout rule — not this cause's to fix
  members: NumericCodeClusterMember[];
};

/**
 * Every live (merchant, storeName) group where 2+ catalog products, EACH carrying a numeric
 * code, collapse to an identical name once their codes are stripped. Clustering — not requiring
 * a WHOLE fan-out group to collapse to one name — matters: the Auchan L'Oreal group has 7
 * members, one of which carries a genuine extra word on top of its shade code, and requiring
 * unanimity across all 7 would hide that the other six differ by nothing but the shade number.
 *
 * This is a LOWER BOUND: a product whose only extra token is a real word (not a code) is not
 * counted, even if the code is still part of why it fanned out.
 */
export async function findNumericCodeClusters(prisma: PrismaClient): Promise<NumericCodeCluster[]> {
  const offers = await prisma.offer.findMany({
    where: { isStale: false, flagged: false, storeName: { not: null } },
    select: {
      id: true, storeName: true, priceBani: true, price: true,
      merchant: { select: { id: true, slug: true, name: true } },
      product: { select: { id: true, name: true, unit: true, unitSize: true } },
    },
  });
  const byStoreItem = new Map<string, typeof offers>();
  for (const o of offers) byStoreItem.set(`${o.merchant.id}::${o.storeName}`, [...(byStoreItem.get(`${o.merchant.id}::${o.storeName}`) ?? []), o]);
  const fanoutGroups = [...byStoreItem.values()].filter((g) => new Set(g.map((o) => o.product.id)).size > 1);

  const physicalMerchants = new Set((await prisma.merchant.findMany({ where: { storeType: "physical" }, select: { slug: true } })).map((m) => m.slug));

  const clusters: NumericCodeCluster[] = [];
  for (const g of fanoutGroups) {
    const uniqueProducts = new Map(g.map((o) => [o.product.id, o.product]));
    const withCodes = [...uniqueProducts.values()]
      .map((p) => ({ p, codes: candidateCodes(p.name, p.unit, p.unitSize), raw: normalizeText(p.name), stripped: withoutCodes(p.name, candidateCodes(p.name, p.unit, p.unitSize)) }))
      .filter((x) => x.codes.length > 0); // only a member carrying a code can be explained by this cause

    const byStripped = new Map<string, typeof withCodes>();
    for (const x of withCodes) byStripped.set(x.stripped, [...(byStripped.get(x.stripped) ?? []), x]);

    for (const cluster of byStripped.values()) {
      const distinctRaw = new Set(cluster.map((x) => x.raw));
      if (distinctRaw.size < 2) continue; // one product, or byte-identical raws (a duplicate catalog row) — not this

      const clusterProductIds = new Set(cluster.map((x) => x.p.id));
      clusters.push({
        merchantId: g[0].merchant.id,
        merchantSlug: g[0].merchant.slug,
        merchantName: g[0].merchant.name,
        storeName: g[0].storeName!,
        physicalScoped: physicalMerchants.has(g[0].merchant.slug),
        members: cluster.map((x) => ({
          productId: x.p.id,
          productName: x.p.name,
          code: x.codes.join(","),
          offers: g.filter((o) => o.product.id === x.p.id).map((o) => ({ id: o.id, priceBani: o.priceBani, price: o.price })),
        })),
      });
    }
  }
  return clusters;
}
