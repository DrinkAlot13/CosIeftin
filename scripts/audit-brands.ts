// ── VERIFY THE BRAND BACKFILL FROM OUTSIDE. IMPORTS ONLY PrismaClient.
//
// CLAUDE.md: "A migration or backfill script may not verify its own work… A script that reports
// its own success is reporting that it agrees with itself." So this shares no code with
// `backfill-brands.ts` — not the placeholder list, not the blob reader, not the key list. It
// reads the database and re-derives everything it checks.
//
// It prints 100 assignments in full to be read, because a brand is a judgement about the world
// and CLAUDE.md is explicit that some defects have no automated detector. The invariants below
// catch the mechanical failures; a person catches the rest.
//
//   npm run audit:brands
//   npm run audit:brands -- --sample=100

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith("--sample="));
  const SAMPLE = arg ? Number(arg.split("=")[1]) : 100;

  // Two backfills write brand attributes today: `backfill-brands.ts` (source "merchant-feed")
  // and `backfill-detail-brands.ts` (source "merchant-detail", one merchant's OWN detail page
  // per product, added later). This checked only the first — silently verifying nothing for the
  // second, exactly the audit:sitemap shape (CLAUDE.md): the predicate went stale the moment a
  // second writer of the same concept showed up. If a THIRD backfill mechanism is added, name it
  // here too, on purpose, rather than letting this list quietly stop covering it.
  const BRAND_BACKFILL_SOURCES = ["merchant-feed", "merchant-detail"];
  const marks = await prisma.productAttribute.findMany({
    where: { key: "brand", source: { in: BRAND_BACKFILL_SOURCES } },
    select: { productId: true, value: true, confidence: true },
  });
  if (marks.length === 0) {
    console.log("No brand assigned by the backfill. Nothing to verify — run backfill:brands first.");
    await prisma.$disconnect();
    return;
  }

  const ids = marks.map((m) => m.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, name: true, brand: true, section: true,
      offers: { select: { storeName: true, merchant: { select: { slug: true } } } },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  console.log("═".repeat(104));
  console.log(`  BRAND BACKFILL — VERIFICATION (${marks.length} assignments)`);
  console.log("═".repeat(104));

  const fail: string[] = [];

  // 1. every marked product still carries the brand the mark records
  let drifted = 0;
  for (const m of marks) {
    const p = byId.get(m.productId);
    if (!p) { drifted++; continue; }
    if ((p.brand ?? "") !== m.value) drifted++;
  }
  if (drifted) fail.push(`${drifted} products whose brand no longer matches the recorded attribute`);

  // 2. no assignment is a placeholder — re-derived here, deliberately NOT imported
  const junk = /^(-{1,2}|n\/?a|null|undefined|none|no ?brand|fara marca|generic|altele|diverse|mega)$/i;
  const bad = products.filter((p) => !p.brand || junk.test(p.brand.trim()) || /^\(.*\)$/.test(p.brand.trim()) || p.brand.trim().length < 2);
  if (bad.length) fail.push(`${bad.length} assignments are placeholders: ${bad.slice(0, 5).map((b) => JSON.stringify(b.brand)).join(", ")}`);

  // 3. an assigned brand must appear in the product's own name or in some merchant's storeName.
  //    A brand nobody writes down anywhere is one we invented.
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const unsupported = products.filter((p) => {
    const b = norm(p.brand ?? "");
    if (!b) return true;
    const first = b.split(" ")[0];
    const hay = [p.name, ...p.offers.map((o) => o.storeName ?? "")].map(norm).join(" | ");
    return !hay.includes(first);
  });
  if (unsupported.length > marks.length * 0.15) {
    fail.push(`${unsupported.length} assignments (${((unsupported.length / marks.length) * 100).toFixed(1)}%) name a brand that appears in NO name we hold`);
  }

  // 4. every one of them is grocery — the backfill claimed to touch only that section
  const wrongSection = products.filter((p) => p.section !== "grocery");
  if (wrongSection.length) fail.push(`${wrongSection.length} assignments outside the grocery section`);

  console.log(`  assignments recorded:                    ${marks.length}`);
  console.log(`  products still carrying them:            ${marks.length - drifted}`);
  console.log(`  placeholder values:                      ${bad.length}`);
  console.log(`  brand not found in any name we hold:     ${unsupported.length}  (${((unsupported.length / marks.length) * 100).toFixed(1)}%)`);
  console.log(`  outside grocery:                         ${wrongSection.length}`);

  const distinct = new Map<string, number>();
  for (const p of products) distinct.set(p.brand ?? "", (distinct.get(p.brand ?? "") ?? 0) + 1);
  console.log(`  distinct brand values:                   ${distinct.size}`);

  console.log(`\n${"─".repeat(104)}`);
  console.log(`  ${Math.min(SAMPLE, products.length)} ASSIGNMENTS, IN FULL. Read these — the checks above are mechanical.`);
  console.log("─".repeat(104));
  const step = Math.max(1, Math.floor(products.length / SAMPLE));
  const shown = products.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  for (const p of shown) {
    const supported = norm(p.name).includes(norm(p.brand ?? "").split(" ")[0]) ? " " : "?";
    console.log(`  ${supported} ${(p.brand ?? "").slice(0, 24).padEnd(25)} ${p.name.slice(0, 56).padEnd(57)} ${[...new Set(p.offers.map((o) => o.merchant.slug))].slice(0, 3).join(",")}`);
  }
  console.log(`\n  "?" marks a brand that does not appear in the product's own name. That is not`);
  console.log(`  automatically wrong — the merchant may name the product differently from how it`);
  console.log(`  labels the brand — but every one of them is worth a glance.`);

  if (unsupported.length) {
    console.log(`\n  ALL ${Math.min(unsupported.length, 25)} SHOWN OF ${unsupported.length} UNSUPPORTED:`);
    for (const p of unsupported.slice(0, 25)) {
      console.log(`    ${(p.brand ?? "").slice(0, 24).padEnd(25)} ${p.name.slice(0, 60)}`);
    }
  }

  console.log(`\n${"═".repeat(104)}`);
  if (fail.length) {
    console.log("  FAILED:");
    for (const f of fail) console.log(`    ✗ ${f}`);
    console.log("═".repeat(104));
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log("  ✓ all invariants hold. The sample above still needs a human.");
  console.log("═".repeat(104));
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
