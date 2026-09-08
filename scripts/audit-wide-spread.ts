// PRODUCTS WHOSE OFFERS DISAGREE BY 3x OR MORE, ACROSS TWO SHOPS. READ-ONLY.
//
// THE INSTANCE THAT PROMPTED IT: "Colgate Pasta de dinti pentru albire 75ml" shows Metro 5,00
// and Mega Image 15,39 for the same 75 ml.
//
// THIS IS A PEER-RELATIVE CHECK AND IT MAY NOT NAME A CULPRIT. CLAUDE.md's gelatine case is the
// worked example: three false members moved the median onto themselves and the check indicted
// the two CORRECT rows. So the output is the GROUP — every offer with its own store name, its
// own raw price string and its own source payload — plus the tokens that distinguish the cheap
// half from the dear half. The decision comes from the source data, not from the spread.
//
//   npm run audit:wide-spread
//   npm run audit:wide-spread -- --product=<id>     one product, with full provenance

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

const RATIO = 3;
const MAX_DISPLAY_AGE_DAYS = 14;

function toks(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[șş]/g, "s").replace(/[țţ]/g, "t").replace(/[ăâ]/g, "a").replace(/î/g, "i")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((t) => t.length > 2),
  );
}

async function main(): Promise<void> {
  const one = process.argv.find((a) => a.startsWith("--product="));
  const cutoff = new Date(Date.now() - MAX_DISPLAY_AGE_DAYS * 86_400_000);
  const live = {
    merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
    NOT: { priceSource: "DELIVERY_PLATFORM" }, lastObservedAt: { gte: cutoff },
  } as const;

  if (one) {
    const id = Number(one.split("=")[1]);
    const p = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true, name: true, slug: true, unit: true, unitSize: true, ean: true,
        offers: {
          where: live,
          select: {
            id: true, priceBani: true, pricePerUnit: true, storeName: true, rawPriceText: true,
            rawSourceBlob: true, productUrl: true, url: true, matchedBy: true, matchScore: true,
            lastObservedAt: true, merchant: { select: { slug: true } },
          },
        },
      },
    });
    if (!p) { console.log(`no product ${id}`); return; }
    console.log(`${"═".repeat(100)}\n#${p.id} ${p.name}\n  stored as ${p.unitSize} ${p.unit} · ean ${p.ean ?? "none"} · /p/${p.slug}\n${"═".repeat(100)}`);
    for (const o of p.offers.sort((a, b) => (a.priceBani ?? 0) - (b.priceBani ?? 0))) {
      console.log(`\n  ${o.merchant.slug}  ${((o.priceBani ?? 0) / 100).toFixed(2)} lei   ${o.pricePerUnit ? o.pricePerUnit.toFixed(2) + "/" + p.unit : "(no unit price)"}`);
      console.log(`    matched by ${o.matchedBy ?? "?"} (${o.matchScore ?? "?"}) · seen ${o.lastObservedAt?.toISOString().slice(0, 10) ?? "?"}`);
      console.log(`    THE SHOP'S OWN NAME: ${JSON.stringify(o.storeName ?? "(not captured)")}`);
      console.log(`    rawPriceText:        ${JSON.stringify(o.rawPriceText ?? "(none)")}`);
      console.log(`    ${o.productUrl ?? o.url ?? "(no link)"}`);
      if (o.rawSourceBlob) {
        // The verbatim source record — the only evidence that does not share our assumptions.
        const blob = o.rawSourceBlob.length > 1400 ? o.rawSourceBlob.slice(0, 1400) + " …" : o.rawSourceBlob;
        console.log(`    rawSourceBlob: ${blob}`);
      } else {
        console.log(`    rawSourceBlob: (none — this row cannot be verified against its source)`);
      }
    }
    return;
  }

  // ── The CLASS, not the instance.
  const products = await prisma.product.findMany({
    where: { offers: { some: live } },
    select: {
      id: true, name: true, slug: true, section: true, unit: true, unitSize: true,
      offers: {
        where: live,
        select: { priceBani: true, storeName: true, rawSourceBlob: true, merchant: { select: { slug: true } } },
      },
    },
  });

  type Row = { id: number; name: string; slug: string; section: string; lo: number; hi: number; ratio: number; shops: number; cheap: string; dear: string; onlyCheap: string[]; onlyDear: string[]; noBlob: number };
  const rows: Row[] = [];
  for (const p of products) {
    const priced = p.offers.filter((o) => o.priceBani != null && o.priceBani > 0);
    const shops = new Set(priced.map((o) => o.merchant.slug));
    if (shops.size < 2) continue;
    const lo = Math.min(...priced.map((o) => o.priceBani as number));
    const hi = Math.max(...priced.map((o) => o.priceBani as number));
    if (lo <= 0 || hi / lo < RATIO) continue;
    const cheapOffer = priced.find((o) => o.priceBani === lo)!;
    const dearOffer = priced.find((o) => o.priceBani === hi)!;
    // The discriminator that does not look at price: do the two shops call it the same thing?
    const a = toks(cheapOffer.storeName ?? p.name);
    const b = toks(dearOffer.storeName ?? p.name);
    rows.push({
      id: p.id, name: p.name, slug: p.slug, section: p.section, lo, hi, ratio: hi / lo, shops: shops.size,
      cheap: `${cheapOffer.merchant.slug} ${(lo / 100).toFixed(2)}`,
      dear: `${dearOffer.merchant.slug} ${(hi / 100).toFixed(2)}`,
      onlyCheap: [...a].filter((t) => !b.has(t)),
      onlyDear: [...b].filter((t) => !a.has(t)),
      noBlob: priced.filter((o) => !o.rawSourceBlob).length,
    });
  }

  rows.sort((x, y) => y.ratio - x.ratio);
  console.log("═".repeat(110));
  console.log(`LIVE PRODUCTS WHOSE TWO SHOPS DISAGREE BY ${RATIO}x OR MORE`);
  console.log(`${rows.length} of ${products.length} products with 2+ shops. A GROUP finding — the check cannot say which side is wrong.`);
  console.log("═".repeat(110));
  console.log(`\nWORST 20:`);
  for (const r of rows.slice(0, 20)) {
    console.log(`\n  ${r.ratio.toFixed(1)}x  #${r.id} ${r.name.slice(0, 62)}  [${r.section}]`);
    console.log(`        cheapest ${r.cheap.padEnd(22)} dearest ${r.dear}`);
    if (r.onlyCheap.length || r.onlyDear.length) {
      console.log(`        words only in the CHEAP shop's own name: ${r.onlyCheap.slice(0, 8).join(" ") || "—"}`);
      console.log(`        words only in the DEAR  shop's own name: ${r.onlyDear.slice(0, 8).join(" ") || "—"}`);
    }
    if (r.noBlob) console.log(`        ⚠ ${r.noBlob} of these offers carry NO source payload — unverifiable`);
  }

  const bySection = new Map<string, number>();
  for (const r of rows) bySection.set(r.section, (bySection.get(r.section) ?? 0) + 1);
  console.log(`\n  by section: ${[...bySection.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`  inspect one with:  npm run audit:wide-spread -- --product=<id>`);

  emitJson({ ratio: RATIO, total: rows.length, worst: rows.slice(0, 50), pass: true });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
