// ── WOULD BARCODE SCANNING ACTUALLY WORK? THE NUMBER THAT DECIDES WHETHER TO BUILD IT.
//
// The brief for the native app is explicit: do not build the scanner before this number exists,
// and if the hit rate is under 50%, say so and do not ship scanning.
//
// ── WHY THE QUESTION IS NOT "DOES OFF HAVE THE BARCODE".
//
// Scanning gives an EAN. We already measured that no second grocery merchant publishes one, so
// an EAN cannot join two of our own offers — that is why `audit:ean` exists and why EAN is not
// a matching key here. The proposed route around it is:
//
//     scan → EAN → Open Food Facts → name + brand → OUR MATCHER → a product in our catalog
//
// Every step can fail, and only the LAST one matters. OFF returning "Lapte Zuzu" is worthless if
// `decide()` will not place that string on the product we hold. So this measures the WHOLE
// chain, end to end, against products we actually carry:
//
//   ABSENT       OFF has no record of this barcode
//   NO_NAME      OFF has the record but no usable product name
//   NO_MATCH     OFF gave a name and our matcher refused every candidate
//   WRONG        our matcher confidently picked a DIFFERENT product — the dangerous outcome
//   HIT          our matcher landed on the product the barcode came from
//
// WRONG is reported separately and never counted as a hit. A scanner that confidently shows the
// wrong product's prices is worse than one that says "nu știu" — the shopper acts on it.
//
// Politeness: OFF asks for an identifying User-Agent and reasonable rates. One request at a
// time, 1.1s apart, and the sample is bounded.
//
//   npm run audit:off-hitrate
//   npm run audit:off-hitrate -- --n=200

import { PrismaClient } from "@prisma/client";
import { AUTO_MATCH_THRESHOLD, decide, prep } from "../src/lib/scrape-util";
import { parseSize } from "../src/lib/ingest-core";
import { tokensRo } from "../src/lib/text/normalizeRo";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

// OFF's documented expectation: identify yourself and say how to reach you.
const UA = "CosMic/1.0 (Romanian grocery price comparison; contact@cosmic.ro)";
const DELAY_MS = 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Outcome = "HIT" | "WRONG" | "NO_MATCH" | "NO_NAME" | "ABSENT" | "ERROR";

type Row = {
  ean: string; ours: string; offName: string | null; offBrand: string | null;
  matched: string | null; score: number; outcome: Outcome;
};

async function offLookup(ean: string): Promise<{ name: string | null; brand: string | null; quantity: string | null } | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json?fields=product_name,product_name_ro,brands,quantity`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: ctrl.signal });
    clearTimeout(t);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const j = (await res.json()) as { status?: number; product?: Record<string, unknown> };
    if (j.status !== 1 || !j.product) return null;
    const p = j.product;
    const name = (typeof p.product_name_ro === "string" && p.product_name_ro.trim()) ||
      (typeof p.product_name === "string" && p.product_name.trim()) || null;
    return {
      name: name || null,
      brand: typeof p.brands === "string" ? p.brands.split(",")[0].trim() : null,
      quantity: typeof p.quantity === "string" ? p.quantity : null,
    };
  } catch {
    clearTimeout(t);
    return null;
  }
}

async function main(): Promise<void> {
  const a = process.argv.find((x) => x.startsWith("--n="));
  const N = a ? Number(a.split("=")[1]) : 200;

  // Products we CARRY and can show — the population a scanner would actually meet.
  const pool = await prisma.product.findMany({
    where: {
      section: "grocery",
      ean: { not: null },
      offers: { some: { merchant: { active: true }, isStale: false, flagged: false } },
    },
    select: { id: true, ean: true, name: true, brand: true, unit: true, unitSize: true, section: true },
    orderBy: { id: "asc" },
  });
  if (pool.length === 0) {
    console.error("No products with an EAN and a live offer. Nothing measured — a FAILURE, not a pass.");
    emitJson({ pass: false, reason: "no-population" });
    await prisma.$disconnect();
    process.exit(1);
  }

  // Spread across the catalog rather than the first N ids, which cluster by merchant.
  const step = Math.max(1, Math.floor(pool.length / N));
  const sample = pool.filter((_, i) => i % step === 0).slice(0, N);

  // ── ROUTE 1, AND IT WAS NOT IN THE BRIEF: WE ALREADY HOLD EANs.
  //
  // The brief reasons that "no second grocery merchant publishes an EAN, so a scanned barcode
  // has nothing to match against". True of using an EAN to JOIN two merchants' offers — which is
  // what `audit:ean` measured. It is NOT the question a scanner asks. A scanner asks "which
  // product am I holding", and our own stored EAN answers that directly, with no OFF, no matcher
  // and no threshold.
  const pricedGrocery = await prisma.product.count({
    where: { section: "grocery", offers: { some: { merchant: { active: true }, isStale: false, flagged: false } } },
  });
  const directCoverage = pool.length / pricedGrocery;

  console.log("═".repeat(104));
  console.log("BARCODE SCANNING — would an EAN reach the right product in OUR catalog?");
  console.log("═".repeat(104));
  console.log(`  ROUTE 1 — the barcode is already ours. No OFF, no matcher, no threshold.`);
  console.log(`    ${pool.length} of ${pricedGrocery} priced grocery products carry an EAN = ${(directCoverage * 100).toFixed(1)}%`);
  console.log(`    A scan of one of those is an EXACT identification.`);
  console.log();
  console.log(`  ROUTE 2 — the barcode is not ours: EAN → Open Food Facts → name → our matcher.`);
  console.log(`    Measured below on ${sample.length} products, ${DELAY_MS}ms apart.`);
  console.log("═".repeat(104));

  const rows: Row[] = [];
  for (const [i, p] of sample.entries()) {
    const off = await offLookup(p.ean!);
    if (!off) {
      rows.push({ ean: p.ean!, ours: p.name, offName: null, offBrand: null, matched: null, score: 0, outcome: "ABSENT" });
    } else if (!off.name) {
      rows.push({ ean: p.ean!, ours: p.name, offName: null, offBrand: off.brand, matched: null, score: 0, outcome: "NO_NAME" });
    } else {
      // ── THE STEP THAT MATTERS. Take OFF's name exactly as a scanner would, and hand it to the
      // matcher the ingestion path uses. Not a lenient variant: if `decide()` would refuse it
      // during a scrape, a scanner must not accept it either.
      const query = [off.name, off.quantity].filter(Boolean).join(" ");
      const st = prep(off.name, off.brand ?? null, null);
      const stSize = parseSize(query);
      const toks = tokensRo(query).slice(0, 2);

      let best: { id: number; name: string; score: number } | null = null;
      if (toks.length > 0) {
        const candidates = await prisma.product.findMany({
          where: {
            AND: toks.map((t) => ({ nameNorm: { contains: t } })),
            offers: { some: { merchant: { active: true }, isStale: false, flagged: false } },
          },
          select: { id: true, name: true, brand: true, ean: true, unit: true, unitSize: true, section: true },
          take: 200,
        });
        for (const c of candidates) {
          if (c.unitSize == null || !c.unit) continue;
          const d = decide(prep(c.name, c.brand, c.ean), { unit: c.unit, unitSize: c.unitSize }, st, stSize, c.section);
          if (!best || d.score > best.score) best = { id: c.id, name: c.name, score: d.score };
        }
      }

      const outcome: Outcome =
        !best || best.score < AUTO_MATCH_THRESHOLD ? "NO_MATCH" : best.id === p.id ? "HIT" : "WRONG";
      rows.push({
        ean: p.ean!, ours: p.name, offName: off.name, offBrand: off.brand,
        matched: best?.name ?? null, score: Number((best?.score ?? 0).toFixed(3)), outcome,
      });
    }
    if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${sample.length}`);
    await sleep(DELAY_MS);
  }

  const count = (o: Outcome) => rows.filter((r) => r.outcome === o).length;
  const hit = count("HIT");
  const wrong = count("WRONG");
  const rate = hit / rows.length;

  console.log(`\n${"─".repeat(104)}`);
  console.log("  OUTCOME                                      n     share");
  console.log("  " + "─".repeat(52));
  for (const o of ["HIT", "WRONG", "NO_MATCH", "NO_NAME", "ABSENT"] as Outcome[]) {
    const n = count(o);
    console.log(`  ${o.padEnd(42)}${String(n).padStart(4)}  ${((n / rows.length) * 100).toFixed(1).padStart(7)}%`);
  }

  const wrongRows = rows.filter((r) => r.outcome === "WRONG");
  if (wrongRows.length) {
    console.log(`\n  WRONG — the matcher was CONFIDENT and picked a different product. These are the`);
    console.log(`  dangerous ones: a scanner showing them would state a price for something else.`);
    for (const r of wrongRows.slice(0, 10)) {
      console.log(`    ${r.ean}  score ${r.score}`);
      console.log(`      ours:    ${r.ours.slice(0, 66)}`);
      console.log(`      OFF:     ${(r.offName ?? "").slice(0, 66)}`);
      console.log(`      matched: ${(r.matched ?? "").slice(0, 66)}`);
    }
  }

  const found = rows.filter((r) => r.outcome !== "ABSENT" && r.outcome !== "ERROR").length;
  console.log(`\n${"═".repeat(104)}`);
  console.log(`  ROUTE 1 (our own EAN):  ${(directCoverage * 100).toFixed(1)}% of priced grocery products, EXACT.`);
  console.log(`  ROUTE 2 (via OFF):      OFF knows ${found}/${rows.length} barcodes (${((found / rows.length) * 100).toFixed(1)}%),`);
  console.log(`                          end-to-end hit ${hit}/${rows.length} = ${(rate * 100).toFixed(1)}%`);
  console.log(`  Wrong-product rate:     ${wrong}/${rows.length} = ${((wrong / rows.length) * 100).toFixed(1)}%`);
  console.log();
  console.log(`  ── THE ROUTE-2 NUMBER IS OPTIMISTIC AND MUST BE READ AS AN UPPER BOUND.`);
  console.log(`  The sample can only be drawn from products whose EAN WE ALREADY KNOW, because a`);
  console.log(`  scan has to be simulated from somewhere. Those come disproportionately from`);
  console.log(`  Auchan, whose catalogue is large and well structured. The products route 2 would`);
  console.log(`  actually serve are the ones we have NO EAN for, and there is no reason to think`);
  console.log(`  OFF covers those better.`);
  console.log();
  if (rate >= 0.5) {
    console.log(`  ABOVE THE 50% BAR. Scanning is worth building — but the wrong-product rate above`);
    console.log(`  is the number that decides whether it may show a price without confirmation.`);
  } else {
    console.log(`  BELOW THE 50% BAR THE BRIEF SET. On this evidence scanning should NOT ship: a`);
    console.log(`  shopper who scans and is told "nu știu" more often than not has been given a`);
    console.log(`  feature that fails in the shop, which is worse than not offering it.`);
  }
  console.log("═".repeat(104));

  emitJson({
    pass: true, sampled: rows.length, eligible: pool.length,
    hit, wrong, noMatch: count("NO_MATCH"), noName: count("NO_NAME"), absent: count("ABSENT"),
    hitRate: Number(rate.toFixed(4)), wrongRate: Number((wrong / rows.length).toFixed(4)),
    worthBuilding: rate >= 0.5,
    rows: rows.slice(0, 250),
  });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
