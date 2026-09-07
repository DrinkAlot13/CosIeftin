// The stored series, split by basket version.
//
// ── WHY THIS READS SNAPSHOTS AND NOT PriceHistory.
//
// `basketSeries()` rebuilds v1 from PriceHistory by carrying each pinned product's last
// observation forward. That works because a pinned slug is the same product on every day, so a
// past day can be re-priced from the record.
//
// v2 cannot be replayed that way. A class resolves to whichever product was cheapest AT A SHOP
// ON A DAY, and the class's membership changes as the catalog and the rules change — so
// re-pricing a past day today would answer "what would this basket cost if last Tuesday's
// prices met today's class rules", which is not a question anybody asked. The snapshot written
// on the day is the only honest record of what v2 cost that day.
//
// ── AND THE TWO VERSIONS NEVER JOIN.
//
// They are returned as separate arrays and drawn as separate segments. A single array with a
// version field would eventually be sorted, mapped and plotted as one line by somebody who did
// not read this comment, and the step between two different baskets would be published as a
// price movement. Making them two values makes that mistake require effort.

import { prisma } from "@/lib/db";

export type StoredPoint = {
  day: string;
  /** Lei. The shopping-around total: cheapest per line from anywhere. */
  total: number;
  covered: number;
  of: number;
  complete: boolean;
};

export type PerShopPoint = {
  merchantSlug: string;
  merchantName: string;
  found: number;
  of: number;
  totalBani: number;
};

export type VersionedSeries = {
  v1: StoredPoint[];
  v2: StoredPoint[];
  /** The most recent v2 day's per-shop breakdown, straight from the snapshot. */
  latestPerShop: PerShopPoint[];
  /** The last v1 day and the first v2 day, so the page can name the break. */
  boundary: { lastV1: string | null; firstV2: string | null };
};

export async function versionedSeries(): Promise<VersionedSeries> {
  const rows = await prisma.indexSnapshot.findMany({
    select: { day: true, version: true, total: true, covered: true, ofItems: true, perShop: true },
    orderBy: { day: "asc" },
  });

  const toPoint = (r: (typeof rows)[number]): StoredPoint => ({
    day: r.day,
    total: r.total,
    covered: r.covered,
    of: r.ofItems,
    complete: r.covered === r.ofItems,
  });

  const v1 = rows.filter((r) => r.version === 1).map(toPoint);
  const v2rows = rows.filter((r) => r.version === 2);
  const v2 = v2rows.map(toPoint);

  let latestPerShop: PerShopPoint[] = [];
  const latest = v2rows[v2rows.length - 1];
  if (latest?.perShop) {
    try {
      latestPerShop = JSON.parse(latest.perShop) as PerShopPoint[];
    } catch {
      // A malformed snapshot is an empty breakdown, never a guessed one.
      latestPerShop = [];
    }
  }

  return {
    v1,
    v2,
    latestPerShop,
    boundary: {
      lastV1: v1.length ? v1[v1.length - 1].day : null,
      firstV2: v2.length ? v2[0].day : null,
    },
  };
}

/** Percentage change between two points of the SAME version. Refuses anything else. */
export function changeWithin(points: StoredPoint[], days: number): { pct: number; from: string; to: string } | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const target = new Date(last.day);
  target.setDate(target.getDate() - days);
  const cutoff = target.toISOString().slice(0, 10);
  // The oldest point at or after the cutoff — never reaching past the start of the series.
  const earlier = points.find((p) => p.day >= cutoff && p.day < last.day);
  if (!earlier || earlier.total <= 0) return null;
  // Only compare days that priced the SAME number of lines. A 37-line total against a 40-line
  // total is the composition error this whole file exists to prevent, one level down.
  if (earlier.covered !== last.covered) return null;
  return { pct: ((last.total - earlier.total) / earlier.total) * 100, from: earlier.day, to: last.day };
}
