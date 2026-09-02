// ── SCOPE: USER-FACING ────────────────────────────────────────────────────────
// Counts ONLY rows that reach a page — unit prices on live pages.
// A withheld, flagged, stale-and-hidden or quarantined row is on no page and cannot
// mislead anyone, so counting it reports a defect the site does not have. Three checks
// did exactly that and returned 8,822, 22 and 46 phantom failures; an audit that does
// not share the display's definition of "shown" trains you to ignore it, which is as
// dangerous as one that misses real defects.
// Unit price: is it computed from the offer's OWN size, or from the catalog product's?
//
// This is the bug that CONCEALS every other matching error, which is why it gets its own audit.
// A 2 L Pepsi Cola wrongly matched onto a "6 x 0.33 l zmeura" catalog entry was displayed at
// 10.49 / 1.98 = 5.30 lei/L. That is a completely plausible number. Divided by its own 2 L it is
// 5.25 — and the fact that the two sizes disagree at all is the signal that the match is wrong.
// Dividing by the catalog size threw the signal away and printed a believable price on the
// wrong product.
//
// Read-only. Run: npm run audit:unitprice

import { PrismaClient } from "@prisma/client";
import { nameBag } from "../src/lib/outlier";
import { parseQuantity } from "../src/lib/units/parseQuantity";

const prisma = new PrismaClient();
const SIZE_TOLERANCE = 0.06;

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

/** The offer's own size, in the same kg/l/buc scale Product.unitSize uses. */
function ownSizeOf(name: string): { unit: string; unitSize: number } | null {
  const q = parseQuantity(name);
  if (!q) return null;
  if (q.unit === "BUC") return { unit: "buc", unitSize: q.value };
  return { unit: q.unit === "G" ? "kg" : "l", unitSize: q.value / 1000 };
}

async function main(): Promise<void> {
  const offers = await prisma.offer.findMany({
    // `flagged: false` matters as much as `isStale`. A withheld offer is not on any page,
    // so counting it makes the audit report a defect the site does not have — the same gap
    // that let isCurrent() treat withheld rows as live.
    where: { isStale: false, flagged: false, merchant: { active: true } },
    select: {
      id: true, price: true, pricePerUnit: true, flagged: true,
      storeName: true, ownUnit: true, ownUnitSize: true,
      merchant: { select: { slug: true } },
      product: { select: { id: true, name: true, unit: true, unitSize: true, section: true } },
    },
  });

  type Row = { total: number; wrongPpu: number; sizeDisagrees: number; unparseable: number; noOwnIdentity: number };
  const byMerchant = new Map<string, Row>();
  const get = (k: string): Row => {
    let r = byMerchant.get(k);
    if (!r) { r = { total: 0, wrongPpu: 0, sizeDisagrees: 0, unparseable: 0, noOwnIdentity: 0 }; byMerchant.set(k, r); }
    return r;
  };

  let wrongPpu = 0;
  let disagree = 0;
  const worstDisagreements: string[] = [];

  for (const o of offers) {
    const r = get(o.merchant.slug);
    r.total++;
    // The offer's OWN size is the only honest basis for its unit price. Prefer what the
    // scrape stored; fall back to parsing the store's own name; only as a last resort use the
    // catalog name, and count those separately because they cannot detect the bug at all —
    // if we are re-deriving from the catalog name we are asking the wrong question.
    const own =
      o.ownUnit && o.ownUnitSize ? { unit: o.ownUnit, unitSize: o.ownUnitSize } :
      o.storeName ? ownSizeOf(o.storeName) : null;
    if (!own) { r.unparseable++; r.noOwnIdentity++; continue; }

    const expected = own.unitSize > 0 ? o.price / own.unitSize : 0;
    // A ppu computed from the CATALOG size instead of the offer's own differs whenever the two
    // sizes differ, which is exactly the case this audit exists to surface.
    if (Math.abs(o.pricePerUnit - expected) > Math.max(0.01, expected * 0.001)) {
      wrongPpu++; r.wrongPpu++;
    }
    const bad =
      own.unit !== o.product.unit ||
      Math.abs(own.unitSize - o.product.unitSize) > o.product.unitSize * SIZE_TOLERANCE + 1e-9;
    if (bad) {
      disagree++; r.sizeDisagrees++;
      if (worstDisagreements.length < 12) {
        worstDisagreements.push(
          `    [${o.merchant.slug}] offer ${o.id}: own ${own.unitSize} ${own.unit} vs catalog ` +
          `${o.product.unitSize} ${o.product.unit} — ${o.product.name.slice(0, 54)}`,
        );
      }
    }
  }

  console.log("\n════ UNIT PRICE INTEGRITY ════════════════════════════════════════════════");
  console.log(`  live offers checked: ${offers.length}`);
  console.log(`  stored pricePerUnit DISAGREES with the offer's own size: ${wrongPpu}  (${((wrongPpu / offers.length) * 100).toFixed(1)}%)`);
  console.log(`  offer's own size disagrees with its catalog product:     ${disagree}  (${((disagree / offers.length) * 100).toFixed(1)}%)`);
  console.log("\n  BY MERCHANT");
  console.log(`  ${pad("merchant", 16)}${lp("offers", 9)}${lp("wrong ppu", 12)}${lp("size clash", 12)}${lp("no own id", 11)}`);
  for (const [k, r] of [...byMerchant.entries()].sort((a, b) => b[1].noOwnIdentity - a[1].noOwnIdentity)) {
    console.log(`  ${pad(k, 16)}${lp(r.total, 9)}${lp(r.wrongPpu, 12)}${lp(r.sizeDisagrees, 12)}${lp(r.noOwnIdentity, 11)}`);
  }
  const noId = [...byMerchant.values()].reduce((n, r) => n + r.noOwnIdentity, 0);
  if (noId > 0) {
    console.log(
      `\n  ⚠ ${noId} of ${offers.length} offers carry NO OWN IDENTITY (storeName/ownUnitSize` +
      "\n    are null), so the invariant cannot be checked on them yet. Those columns were added" +
      "\n    with this fix and are populated by the next scrape. Until then this audit" +
      "\n    UNDER-REPORTS: it cannot see the bug on rows that lack the data to detect it.",
    );
  }
  if (worstDisagreements.length) {
    console.log("\n  SIZE DISAGREEMENTS (these are wrong matches, not wrong sizes)");
    console.log(worstDisagreements.join("\n"));
  }

  // ── unit-price spread per catalog product ───────────────────────────────────────
  //
  // Offers on ONE product that disagree about lei/L by more than 2x are almost certainly not
  // the same product. This is the cheapest detector we have for the Pepsi failure mode.
  const byProduct = new Map<number, { name: string; rows: { m: string; ppu: number; price: number; name: string; storeName: string | null }[] }>();
  for (const o of offers) {
    const own = ownSizeOf(o.product.name);
    const ppu = own && own.unitSize > 0 ? o.price / own.unitSize : 0;
    if (ppu <= 0) continue;
    const e = byProduct.get(o.product.id) ?? { name: o.product.name, rows: [] };
    e.rows.push({ m: o.merchant.slug, ppu, price: o.price, name: o.product.name, storeName: o.storeName });
    byProduct.set(o.product.id, e);
  }

  const spreads: { id: number; name: string; ratio: number; rows: { m: string; ppu: number; price: number; storeName?: string | null }[] }[] = [];
  for (const [id, e] of byProduct) {
    if (e.rows.length < 2) continue;
    const ppus = e.rows.map((r) => r.ppu);
    const ratio = Math.max(...ppus) / Math.min(...ppus);
    if (ratio > 1.0001) spreads.push({ id, name: e.name, ratio, rows: e.rows });
  }
  spreads.sort((a, b) => b.ratio - a.ratio);

  const over2x = spreads.filter((s) => s.ratio >= 2).length;
  console.log("\n════ UNIT-PRICE SPREAD PER CATALOG PRODUCT ══════════════════════════════");
  console.log(`  products with 2+ live offers: ${[...byProduct.values()].filter((e) => e.rows.length >= 2).length}`);
  console.log(`  offers disagree on lei/unit by 2x or more: ${over2x}`);
  console.log("");
  console.log("  A SPREAD IS A DISAGREEMENT, NOT A VERDICT — see CLAUDE.md, \"a peer-relative");
  console.log("  check flags disagreement, not guilt\". This audit cannot say which row is wrong.");
  console.log("  Every member is printed with the STORE'S OWN NAME plus the tokens only some of");
  console.log("  them carry: differing tokens point at a mismatch, identical tokens at a real");
  console.log("  price gap. Resolve against an EAN or the payload's own size before withholding.");
  console.log("\n  WORST 100");
  for (const s of spreads.slice(0, 100)) {
    const bags = s.rows
      .map((r) => new Set(nameBag(r.storeName).split(" ").filter(Boolean)))
      .filter((b) => b.size > 0);
    let diff: string[] = [];
    if (bags.length >= 2) {
      const union = new Set<string>();
      for (const b of bags) for (const t of b) union.add(t);
      diff = [...union].filter((t) => !bags.every((b) => b.has(t))).sort();
    }
    const verdict = s.rows.some((r) => !r.storeName)
      ? "a row has NO store name — cannot be judged on names"
      : diff.length === 0
        ? "same store-name tokens — a real unit-price gap"
        : `not all rows carry: ${diff.slice(0, 6).join(", ")} — CHECK FOR A MISMATCH first`;
    console.log(`\n  ${s.ratio.toFixed(1)}x  ${s.name.slice(0, 72)}`);
    console.log(`        ${verdict}`);
    for (const r of s.rows.sort((a, b) => a.ppu - b.ppu)) {
      console.log(`        ${pad(r.m, 13)} ${lp(r.price.toFixed(2), 9)} lei   ${lp(r.ppu.toFixed(2), 9)} /unit   ${(r.storeName ?? "(no store name)").slice(0, 44)}`);
    }
  }
  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
