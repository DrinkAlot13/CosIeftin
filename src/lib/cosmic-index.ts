// Indexul CoșMic — a fixed, representative Romanian basket priced every day from our own
// price history. Unlike the per-user basket snapshot (localStorage, client-side), this is
// server-side and identical for everyone, so it is:
//   • the retention hook — "coșul meu lunar" compared against the national index
//   • the press hook — a monthly inflation number outlets can quote and link back to
//
// The basket follows the INS "coș de consum" logic: staples a household buys every week,
// priced at the CHEAPEST available offer per item (what a smart shopper would actually pay).

import { prisma } from "./db";

/** The fixed basket: head-noun searches + the pack size we price. Deliberately generic so
 *  it keeps resolving as the catalog changes — never pinned to one brand or one store. */
export const INDEX_BASKET: { key: string; label: string; match: string; unit: string; unitSize: number }[] = [
  { key: "lapte",    label: "Lapte 1L",             match: "lapte",    unit: "l",  unitSize: 1 },
  { key: "paine",    label: "Pâine 500g",           match: "paine",    unit: "kg", unitSize: 0.5 },
  { key: "oua",      label: "Ouă 10 buc",           match: "oua",      unit: "buc", unitSize: 10 },
  { key: "ulei",     label: "Ulei floarea-soarelui 1L", match: "ulei", unit: "l",  unitSize: 1 },
  { key: "faina",    label: "Făină 1kg",            match: "faina",    unit: "kg", unitSize: 1 },
  { key: "zahar",    label: "Zahăr 1kg",            match: "zahar",    unit: "kg", unitSize: 1 },
  { key: "orez",     label: "Orez 1kg",             match: "orez",     unit: "kg", unitSize: 1 },
  { key: "unt",      label: "Unt 200g",             match: "unt",      unit: "kg", unitSize: 0.2 },
  { key: "branza",   label: "Brânză telemea 400g",  match: "branza",   unit: "kg", unitSize: 0.4 },
  { key: "iaurt",    label: "Iaurt 400g",           match: "iaurt",    unit: "kg", unitSize: 0.4 },
  { key: "pui",      label: "Piept de pui 1kg",     match: "piept de pui", unit: "kg", unitSize: 1 },
  { key: "cartofi",  label: "Cartofi 1kg",          match: "cartofi",  unit: "kg", unitSize: 1 },
  { key: "rosii",    label: "Roșii 1kg",            match: "rosii",    unit: "kg", unitSize: 1 },
  { key: "mere",     label: "Mere 1kg",             match: "mere",     unit: "kg", unitSize: 1 },
  { key: "cafea",    label: "Cafea 250g",           match: "cafea",    unit: "kg", unitSize: 0.25 },
];

export type IndexLine = {
  key: string;
  label: string;
  price: number | null;
  productName: string | null;
  productSlug: string | null;
  storeName: string | null;
};

export type CosmicIndex = {
  total: number;
  covered: number;
  of: number;
  lines: IndexLine[];
  computedAt: Date;
};

/** Price the fixed basket right now: cheapest in-stock offer per line. */
export async function computeCosmicIndex(): Promise<CosmicIndex> {
  const lines: IndexLine[] = [];
  let total = 0;
  let covered = 0;

  for (const spec of INDEX_BASKET) {
    // size window ±25%: the index tracks a typical pack, not one exact SKU
    const lo = spec.unitSize * 0.75;
    const hi = spec.unitSize * 1.25;
    const candidates = await prisma.product.findMany({
      where: {
        section: "grocery",
        unit: spec.unit,
        unitSize: { gte: lo, lte: hi },
        OR: [{ nameNorm: { contains: spec.match } }, { name: { contains: spec.match } }],
        offers: { some: { availability: "in stock", flagged: false } },
      },
      select: {
        name: true,
        slug: true,
        unitSize: true,
        offers: {
          where: { availability: "in stock", flagged: false },
          select: { price: true, merchant: { select: { name: true } } },
          orderBy: { price: "asc" },
          take: 1,
        },
      },
      take: 60,
    });

    // normalize each candidate to the index pack size, then take the cheapest
    let best: IndexLine | null = null;
    for (const c of candidates) {
      const o = c.offers[0];
      if (!o || !(o.price > 0) || !(c.unitSize > 0)) continue;
      const normalized = (o.price / c.unitSize) * spec.unitSize;
      if (!best || normalized < best.price!) {
        best = { key: spec.key, label: spec.label, price: normalized, productName: c.name, productSlug: c.slug, storeName: o.merchant.name };
      }
    }
    if (best) { total += best.price!; covered++; lines.push(best); }
    else lines.push({ key: spec.key, label: spec.label, price: null, productName: null, productSlug: null, storeName: null });
  }

  return { total, covered, of: INDEX_BASKET.length, lines, computedAt: new Date() };
}

/** Persist today's index value (idempotent — one row per day). */
export async function saveCosmicIndex(idx: CosmicIndex) {
  const day = idx.computedAt.toISOString().slice(0, 10);
  const payload = {
    total: idx.total,
    covered: idx.covered,
    ofItems: idx.of,
    lines: JSON.stringify(idx.lines.map((l) => ({ key: l.key, label: l.label, price: l.price, storeName: l.storeName }))),
  };
  await prisma.indexSnapshot.upsert({ where: { day }, update: payload, create: { day, ...payload } });
}

export type IndexTrend = {
  latest: { day: string; total: number } | null;
  series: { day: string; total: number }[];
  /** % change vs the earliest point in the window */
  changePct: number | null;
  /** % change vs ~30 days ago, the headline "monthly inflation" number */
  monthChangePct: number | null;
};

/** The public series behind "Indexul CoșMic". */
export async function getIndexTrend(days = 180): Promise<IndexTrend> {
  const rows = await prisma.indexSnapshot.findMany({ orderBy: { day: "asc" }, take: days, select: { day: true, total: true } });
  if (rows.length === 0) return { latest: null, series: [], changePct: null, monthChangePct: null };
  const latest = rows[rows.length - 1];
  const first = rows[0];
  const changePct = first.total > 0 && rows.length > 1 ? ((latest.total - first.total) / first.total) * 100 : null;
  // nearest snapshot at least 28 days old
  const cutoff = new Date(Date.now() - 28 * 864e5).toISOString().slice(0, 10);
  const monthAgo = [...rows].reverse().find((r) => r.day <= cutoff);
  const monthChangePct = monthAgo && monthAgo.total > 0 ? ((latest.total - monthAgo.total) / monthAgo.total) * 100 : null;
  return { latest, series: rows, changePct, monthChangePct };
}
