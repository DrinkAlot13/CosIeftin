// WHY DOES THIS PRODUCT SHOW ONE SHOP? Trace the whole path, per merchant. READ-ONLY.
//
// Three widely-stocked branded products — Napolact 3.5% 1.5L, Lăptăria cu Caimac 1L, Almette
// 250g — each show "1 magazine" while being carried by six or more chains. That is a matcher
// failure on some of the most common products in the country, and there are FOUR completely
// different explanations with four different fixes:
//
//   A. NEVER CONSIDERED   no merchant pool contains a candidate at all (a scraper gap)
//   B. MATCHED ELSEWHERE  the candidate exists and sits on a DIFFERENT catalog product, so we
//                         hold two entries for one product and the comparison is split in half
//   C. QUEUED             the candidate reached a decision and landed in PendingMatch
//   D. REJECTED           a rule refused it, and which rule is the whole question
//
// B is the one that hides best: every merchant has a price, every price is right, and the site
// still says "1 magazine" because the prices are on two different rows.
//
// This asks the DATABASE where every candidate actually went, rather than reasoning about the
// matcher from its source.
//
//   npm run trace -- "Napolact"
//   npm run trace -- "Napolact" --size=1.5 --unit=l

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const MAX_AGE = 14 * 86_400_000;

function norm(s: string): string {
  return s.toLowerCase()
    .replace(/[șş]/g, "s").replace(/[țţ]/g, "t").replace(/[ăâ]/g, "a").replace(/î/g, "i")
    .replace(/\s+/g, " ").trim();
}

async function main(): Promise<void> {
  const term = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!term) { console.error(`usage: npm run trace -- "Napolact" [--size=1.5] [--unit=l]`); process.exit(2); }
  const wantSize = process.argv.find((a) => a.startsWith("--size="));
  const size = wantSize ? Number(wantSize.split("=")[1]) : null;
  const unitArg = process.argv.find((a) => a.startsWith("--unit="));
  const unit = unitArg ? unitArg.split("=")[1] : null;

  const cutoff = new Date(Date.now() - MAX_AGE);
  const liveish = { isStale: false, flagged: false, merchant: { active: true } } as const;

  console.log("═".repeat(108));
  console.log(`TRACE: "${term}"${size ? `  size ${size} ${unit ?? ""}` : ""}`);
  console.log("═".repeat(108));

  // ── 1. EVERY CATALOG PRODUCT carrying this term. More than one is finding B.
  const products = await prisma.product.findMany({
    where: { OR: [{ name: { contains: term } }, { brand: { contains: term } }] },
    select: {
      id: true, name: true, brand: true, slug: true, unit: true, unitSize: true, ean: true,
      offers: {
        where: liveish,
        select: {
          id: true, priceBani: true, storeName: true, availability: true, lastObservedAt: true,
          matchedBy: true, matchScore: true, merchant: { select: { slug: true } },
        },
      },
    },
  });
  const inSize = products.filter((p) => size == null || (Math.abs(p.unitSize - size) < 0.02 && (!unit || p.unit === unit)));

  console.log(`\n1. CATALOG ENTRIES carrying "${term}": ${products.length}${size ? ` · at ${size} ${unit ?? ""}: ${inSize.length}` : ""}`);
  for (const p of inSize.slice(0, 20)) {
    const shops = new Set(p.offers.filter((o) => o.availability === "in stock" && (o.lastObservedAt?.getTime() ?? 0) >= cutoff.getTime()).map((o) => o.merchant.slug));
    console.log(`\n   #${p.id}  ${p.name}`);
    console.log(`     ${p.unitSize} ${p.unit} · brand=${p.brand ?? "—"} · ean=${p.ean ?? "none"} · LIVE SHOPS: ${shops.size} {${[...shops].join(" ")}}`);
    for (const o of p.offers) {
      const live = o.availability === "in stock" && (o.lastObservedAt?.getTime() ?? 0) >= cutoff.getTime();
      console.log(`       ${live ? "LIVE " : "     "} ${o.merchant.slug.padEnd(14)} ${((o.priceBani ?? 0) / 100).toFixed(2).padStart(7)}  via ${String(o.matchedBy ?? "?").padEnd(14)} ${o.matchScore ?? ""}  ${JSON.stringify((o.storeName ?? "").slice(0, 46))}`);
    }
  }
  if (inSize.length > 1) {
    console.log(`\n   ⚠ MORE THAN ONE CATALOG ENTRY at this size. That is explanation B: the comparison`);
    console.log(`     is split across two rows, and each row honestly reports the shops IT has.`);
  }

  // ── 2. EVERY OFFER ANYWHERE whose STORE NAME carries the term — regardless of which catalog
  //       product it landed on. This is what the merchants actually sell.
  const offers = await prisma.offer.findMany({
    where: { storeName: { contains: term }, ...liveish },
    select: {
      id: true, priceBani: true, storeName: true, availability: true, lastObservedAt: true,
      matchedBy: true, matchScore: true,
      merchant: { select: { slug: true } },
      product: { select: { id: true, name: true, unit: true, unitSize: true } },
    },
  });
  const relevant = offers.filter((o) => size == null || (Math.abs(o.product.unitSize - size) < 0.35 * size && (!unit || o.product.unit === unit)));

  console.log(`\n2. EVERY OFFER whose STORE NAME carries "${term}": ${offers.length}${size ? ` · near ${size} ${unit ?? ""}: ${relevant.length}` : ""}`);
  const byMerchant = new Map<string, typeof relevant>();
  for (const o of relevant) byMerchant.set(o.merchant.slug, [...(byMerchant.get(o.merchant.slug) ?? []), o]);
  for (const [m, rows] of [...byMerchant.entries()].sort()) {
    console.log(`\n   ${m}  (${rows.length})`);
    for (const o of rows.slice(0, 8)) {
      const live = o.availability === "in stock" && (o.lastObservedAt?.getTime() ?? 0) >= cutoff.getTime();
      console.log(`     ${live ? "LIVE " : "stale"} ${((o.priceBani ?? 0) / 100).toFixed(2).padStart(7)}  →  catalog #${String(o.product.id).padEnd(7)} ${o.product.unitSize}${o.product.unit}  ${o.product.name.slice(0, 40)}`);
      console.log(`            store: ${JSON.stringify(o.storeName ?? "")}`);
    }
  }

  // WHICH CATALOG PRODUCTS are these offers spread across? One term, many products = split.
  const spread = new Map<number, { name: string; shops: Set<string> }>();
  for (const o of relevant) {
    const e = spread.get(o.product.id) ?? { name: o.product.name, shops: new Set<string>() };
    e.shops.add(o.merchant.slug);
    spread.set(o.product.id, e);
  }
  console.log(`\n   THESE OFFERS ARE SPREAD ACROSS ${spread.size} CATALOG PRODUCT(S):`);
  for (const [id, e] of [...spread.entries()].sort((a, b) => b[1].shops.size - a[1].shops.size)) {
    console.log(`     #${String(id).padEnd(7)} ${String(e.shops.size).padStart(2)} shop(s) {${[...e.shops].join(" ")}}  ${e.name.slice(0, 52)}`);
  }
  if (spread.size > 1) {
    console.log(`\n   ⇒ ONE PRODUCT, ${spread.size} CATALOG ROWS. Each row reports its own shops honestly,`);
    console.log(`     and the shopper sees "1 magazine" on each. This is a DUPLICATE-CATALOG bug,`);
    console.log(`     not a rule bug — no rule ever refused anything.`);
  }

  // ── 3. Is it sitting in the review queue?
  const pending = await prisma.pendingMatch.findMany({
    where: { storeName: { contains: term } },
    select: {
      id: true, storeName: true, score: true, reason: true, resolved: true,
      merchant: { select: { slug: true } }, product: { select: { id: true, name: true } },
    },
    take: 25,
  });
  console.log(`\n3. IN THE REVIEW QUEUE: ${pending.length}`);
  for (const q of pending.slice(0, 12)) {
    console.log(`   ${q.merchant.slug.padEnd(14)} ${q.reason.padEnd(20)} ${q.score.toFixed(2)}  ${JSON.stringify((q.storeName ?? "").slice(0, 40))}`);
    console.log(`       would attach to #${q.product.id} ${q.product.name.slice(0, 52)}`);
  }
  if (pending.length === 0) {
    console.log(`   NONE. So no rule ever put this pair in front of a person — it was either never`);
    console.log(`   considered, or it matched somewhere else. Rule out B above before blaming a rule.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
