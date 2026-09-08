// ── SCOPE: CATALOG INTEGRITY ──────────────────────────────────────────────────
// THE SAME PRODUCT, SPLIT ACROSS SEVERAL CATALOG ROWS. READ-ONLY. Nothing is merged.
//
// WHAT NOTHING ELSE DOES. Every matcher in this project compares a STORE ITEM against a CATALOG
// ROW. Nothing compares catalog rows against EACH OTHER, so when two merchants describe one
// product in two vocabularies, `addNew` creates a row from whichever arrived first and the
// second merchant's wording creates another. Both rows are then correct about the shops they
// have, and the shopper sees "1 magazine" on each.
//
//   Napolact Lapte 3.5% 1 L / 1.5 L   11 catalog rows
//   Almette crema de branza           16 catalog rows
//
// THE EXISTING DETECTOR CANNOT SEE THIS. Its criterion, printed in every row it writes, is
// "same token bag and size" — typo-level duplicates like "Salata icre de crap cu ceapa Auchan,
// 70 g" against the same string. Napolact's split is VOCABULARY-level:
// {lapte, consum, integral, napolact, grasime} against {lapte, grasime}. Different question.
//
// ── THE CRITERION HERE, and why each part is needed.
//
//   same BRAND          the anchor. Without it "1 l of milk" merges every dairy in Romania.
//   same UNIT and SIZE  a 1 l and a 1.5 l Napolact are different products.
//   no CONTRADICTING    fat, BIO, lactose, flavour, form. And "contradicting" is the operative
//   discriminator       word: a value on one side and SILENCE on the other is not a
//                       contradiction — that is precisely the asymmetry that split these rows.
//                       3.5% against 1.5% blocks. 3.5% against unstated does not.
//
// It reports and queues. It does not merge, and it must not: merging two rows that are not the
// same product publishes one product's price on another, which is the one error class CLAUDE.md
// ranks above all others.
//
//   npm run audit:catalog-duplicates
//   npm run audit:catalog-duplicates -- --groups=50 --json logs/dups.json

import { PrismaClient } from "@prisma/client";
import { normalizeRo } from "../src/lib/text/normalizeRo";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const MAX_AGE = 14 * 86_400_000;

/** Sizes agree within 2% — the same pack described with different rounding, not a different pack. */
const SIZE_TOL = 0.02;

type Prod = {
  id: number; name: string; brand: string | null; slug: string;
  unit: string; unitSize: number; ean: string | null; section: string;
  shops: Set<string>; priceByShop: Map<string, number>; offerIds: number[];
};

/** Facts that DISTINGUISH two products of the same brand and size, by dimension. */
function discriminators(nameAndBrand: string): Map<string, string> {
  const n = ` ${normalizeRo(nameAndBrand)} `;
  const d = new Map<string, string>();

  // FAT / STRENGTH — the number, when the name states one. "3 5" after normalisation.
  const fat = n.match(/\b(\d{1,2})[ ,.]?(\d)?\s*(?:%|la suta)?\s*grasime|\bgrasime\s*(\d{1,2})[ ,.]?(\d)?/);
  if (fat) {
    const digits = (fat[1] ?? fat[3] ?? "") + (fat[2] ?? fat[4] ?? "");
    if (digits) d.set("fat", digits);
  } else {
    // Bare "3 5" / "1 5" next to milk-ish words, which is how these names are written.
    const bare = n.match(/\b([013])\s([5789])\b/);
    if (bare) d.set("fat", bare[1] + bare[2]);
  }

  if (/\bfara lactoza\b|\bdelactozat/.test(n)) d.set("lactose", "free");
  if (/\b(bio|eco|ecologic|organic)\b/.test(n)) d.set("organic", "yes");
  if (/\bdegresat\b/.test(n)) d.set("skim", "yes");

  // FLAVOUR / VARIANT — the words that name a different product of the same brand and size.
  const flavours = [
    "ciocolata", "vanilie", "capsuni", "capsune", "zmeura", "visine", "caise", "piersici",
    "ceapa", "verdeata", "smantana", "hribi", "iaurt", "usturoi", "marar", "rosii", "busuioc",
    "masline", "sunca", "somon", "cascaval", "branza", "miere", "cacao", "alune", "cocos",
    "portocale", "lamaie", "menta", "afine", "mango", "banana", "para", "mar", "nuca", "fistic",
    "natur", "simplu", "clasic", "light", "picant", "iute", "dulce", "sarat",
  ];
  const found = flavours.filter((f) => new RegExp(`\\b${f}`).test(n));
  if (found.length) d.set("flavour", found.sort().join("+"));

  return d;
}

/** Do two products CONTRADICT? Only when both state a value in the same dimension and differ. */
function contradicts(a: Map<string, string>, b: Map<string, string>): string | null {
  for (const [dim, va] of a) {
    const vb = b.get(dim);
    if (vb != null && vb !== va) return `${dim}: ${va} vs ${vb}`;
  }
  return null;
}

function brandKeyOf(p: { brand: string | null; name: string }, vocab: Set<string>): string | null {
  const b = (p.brand ?? "").trim();
  if (b && b.toLowerCase() !== "non-brand" && b !== "(bucata)") return normalizeRo(b);
  // The brand column is empty on many rows that carry the brand IN THE NAME — #46085
  // "Napolact Lapte 3.5% PET 1,5 l" has brand=null. Recover it from the catalog's own brand
  // vocabulary rather than guessing.
  for (const t of normalizeRo(p.name).split(/\s+/)) {
    if (t.length >= 4 && vocab.has(t)) return t;
  }
  return null;
}

async function main(): Promise<void> {
  const nGroups = Number((process.argv.find((a) => a.startsWith("--groups=")) ?? "--groups=50").split("=")[1]);
  const cutoff = new Date(Date.now() - MAX_AGE);
  const live = {
    merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
    NOT: { priceSource: "DELIVERY_PLATFORM" }, lastObservedAt: { gte: cutoff },
  } as const;

  const rows = await prisma.product.findMany({
    select: {
      id: true, name: true, brand: true, slug: true, unit: true, unitSize: true, ean: true, section: true,
      offers: { where: live, select: { id: true, priceBani: true, merchant: { select: { slug: true } } } },
    },
  });

  // The catalog's own brand vocabulary, so a null brand column can be recovered from the name.
  const vocab = new Set<string>();
  for (const r of rows) {
    const b = (r.brand ?? "").trim();
    if (!b || b.toLowerCase() === "non-brand") continue;
    for (const t of normalizeRo(b).split(/\s+/)) if (t.length >= 4) vocab.add(t);
  }

  const products: Prod[] = rows.map((r) => {
    const shops = new Set<string>();
    const priceByShop = new Map<string, number>();
    for (const o of r.offers) {
      if (o.priceBani == null || o.priceBani <= 0) continue;
      shops.add(o.merchant.slug);
      const prev = priceByShop.get(o.merchant.slug);
      if (prev == null || o.priceBani < prev) priceByShop.set(o.merchant.slug, o.priceBani);
    }
    return {
      id: r.id, name: r.name, brand: r.brand, slug: r.slug, unit: r.unit, unitSize: r.unitSize,
      ean: r.ean, section: r.section, shops, priceByShop, offerIds: r.offers.map((o) => o.id),
    };
  }).filter((p) => p.shops.size > 0); // a row with no live price cannot change comparability

  // ── GROUP: brand + unit + size, then split by contradiction.
  const buckets = new Map<string, Prod[]>();
  for (const p of products) {
    const bk = brandKeyOf(p, vocab);
    if (!bk) continue;
    // Round the size so 0.5 and 0.499 land together; SIZE_TOL then re-checks within the bucket.
    const key = `${p.section}|${bk}|${p.unit}|${p.unitSize.toPrecision(3)}`;
    buckets.set(key, [...(buckets.get(key) ?? []), p]);
  }

  type Group = { key: string; brand: string; unit: string; size: number; members: Prod[]; union: Set<string> };
  const groups: Group[] = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    // Within a bucket, partition into sets that do not contradict each other.
    const parts: Prod[][] = [];
    for (const m of members) {
      const dm = discriminators(`${m.brand ?? ""} ${m.name}`);
      let placed = false;
      for (const part of parts) {
        const clash = part.some((q) => {
          const dq = discriminators(`${q.brand ?? ""} ${q.name}`);
          return contradicts(dm, dq) != null || contradicts(dq, dm) != null;
        });
        const sizeOk = part.every((q) => Math.abs(q.unitSize - m.unitSize) <= m.unitSize * SIZE_TOL);
        if (!clash && sizeOk) { part.push(m); placed = true; break; }
      }
      if (!placed) parts.push([m]);
    }
    for (const part of parts) {
      if (part.length < 2) continue;
      const union = new Set<string>();
      for (const m of part) for (const s of m.shops) union.add(s);
      const [, brand, unit] = key.split("|");
      groups.push({ key, brand, unit, size: part[0].unitSize, members: part, union });
    }
  }

  // ── THE UPPER BOUND. Report before anything is done with it.
  const comparableNow = products.filter((p) => p.shops.size >= 2).length;
  const inGroup = new Set<number>();
  for (const g of groups) for (const m of g.members) inGroup.add(m.id);
  const comparableOutsideGroups = products.filter((p) => !inGroup.has(p.id) && p.shops.size >= 2).length;
  const groupsThatWouldCompare = groups.filter((g) => g.union.size >= 2).length;
  const upperBound = comparableOutsideGroups + groupsThatWouldCompare;

  // How many of the grouped rows are single-shop TODAY — the ones a merge would rescue.
  const rescued = groups
    .filter((g) => g.union.size >= 2)
    .reduce((n, g) => n + g.members.filter((m) => m.shops.size === 1).length, 0);

  console.log("═".repeat(110));
  console.log("CATALOG ROWS THAT MAY BE THE SAME PRODUCT — brand + unit + size, no contradicting discriminator");
  console.log("═".repeat(110));
  console.log(`  live products (with a price)              ${products.length}`);
  console.log(`  groups of 2+ rows that could be one       ${groups.length}`);
  console.log(`  rows inside such a group                  ${inGroup.size}`);
  console.log(`  groups whose merged shops would be 2+     ${groupsThatWouldCompare}`);

  console.log(`\n${"─".repeat(110)}`);
  console.log("THE UPPER BOUND — what comparability WOULD become if every group merged");
  console.log("─".repeat(110));
  console.log(`  comparable in 2+ shops, TODAY                       ${comparableNow}`);
  console.log(`  comparable if EVERY group merged (upper bound)      ${upperBound}`);
  console.log(`  change                                              ${upperBound - comparableNow >= 0 ? "+" : ""}${upperBound - comparableNow}`);
  console.log(`  single-shop rows a merge would rescue               ${rescued}`);
  console.log(`\n  THIS IS A CEILING, NOT A FORECAST. It assumes every group is genuinely one`);
  console.log(`  product, which is exactly what has not been verified — that is what the review`);
  console.log(`  queue is for. The real number is lower and only reading them says how much.`);

  console.log(`\n${"─".repeat(110)}`);
  console.log(`WORST ${Math.min(nGroups, groups.length)} GROUPS, by how many shops a merge would unite`);
  console.log("─".repeat(110));
  const ranked = [...groups].sort((a, b) => b.union.size * b.members.length - a.union.size * a.members.length);
  for (const g of ranked.slice(0, nGroups)) {
    console.log(`\n  ${g.brand} · ${g.size} ${g.unit} · ${g.members.length} rows → ${g.union.size} shops {${[...g.union].join(" ")}}`);
    for (const m of g.members.sort((a, b) => b.shops.size - a.shops.size)) {
      const prices = [...m.priceByShop.entries()].map(([s, b]) => `${s} ${(b / 100).toFixed(2)}`).join("  ");
      console.log(`    #${String(m.id).padEnd(7)} ${String(m.shops.size).padStart(2)} shop  ${m.name.slice(0, 52).padEnd(52)} ${prices}`);
      if (m.ean) console.log(`             ean ${m.ean}`);
    }
  }

  emitJson({
    liveProducts: products.length,
    groups: groups.length,
    rowsInGroups: inGroup.size,
    comparableNow,
    upperBound,
    delta: upperBound - comparableNow,
    rescued,
    worst: ranked.slice(0, 100).map((g) => ({
      brand: g.brand, unit: g.unit, size: g.size, shops: [...g.union],
      members: g.members.map((m) => ({ id: m.id, name: m.name, shops: [...m.shops], ean: m.ean })),
    })),
    pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
