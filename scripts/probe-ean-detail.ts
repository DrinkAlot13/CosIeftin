// CAN WE GET AN EAN OFF A PRODUCT DETAIL PAGE, PER MERCHANT? READ-ONLY.
//
// ── WHY THIS IS BEING ASKED AGAIN, AND WHY THE OLD ANSWER WAS RIGHT ABOUT THE WRONG QUESTION.
//
// The 2026-09-08 run concluded "the answer to what would comparable products become: nothing",
// because an EAN raises comparability only when a SECOND shop can be matched to a FIRST by it,
// and no second grocery merchant publishes one. That is correct — and it answers the JOIN
// question, which is what `audit:ean` measures.
//
// It is NOT the identification question. A scanner asks "which product am I holding", and one
// merchant's EAN answers that completely, with no second merchant, no matcher and no threshold.
// For that use an EAN from a single shop is worth exactly as much as one from two. So the same
// pages get re-read against a different question, and the ceiling is reported per merchant.
//
// ── FIVE THINGS THE EARLIER VERSION GOT WRONG, EACH OF WHICH INFLATES OR HIDES THE CEILING.
//
//   1. IT DID NOT VALIDATE THE CHECKSUM. It reported any `\d{8,14}` near an EAN-ish label as a
//      find, while `parseEan` — written precisely because "an unchecked barcode is worse than
//      none" — sat unused two directories away. A weight, an order code or a product id would
//      have counted. Every candidate now goes through `parseEan`.
//   2. IT SAMPLED PRODUCTS THAT ALREADY HAD AN EAN. The question is whether we can get EANs for
//      products we DO NOT have them for, and Auchan is at 95%, so sampling its catalog at random
//      mostly re-finds what we already store. The sample is now drawn ONLY from `ean: null`.
//   3. `take: n` WITH NO ORDER took the first n rows by insertion, which cluster by scrape batch
//      and category. Spread across the merchant's catalog instead.
//   4. IT DID NOT CHECK robots.txt, unlike `probe:extension-ids`.
//   5. IT DID NOT MEASURE COST, which is half of what makes an answer actionable: a detail fetch
//      per product is the expensive part, so seconds-per-page is reported and extrapolated.
//
// Sezamo was additionally never measured at all — every sampled url was a 404 on 2026-09-08,
// which is the link bug fixed in b590c6b. It is our largest merchant by live offers.
//
//   npm run probe:ean
//   npm run probe:ean -- metro sezamo --n=8

import { PrismaClient } from "@prisma/client";
import { chromium, type Page } from "playwright";
import { parseEan } from "../src/lib/product/ean";
import { allowedByRobots } from "../src/lib/net/robots";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

type Hit = { where: string; value: string } | null;
type Finding = {
  merchant: string;
  url: string;
  where: string | null;
  value: string | null;
  note: string;
  ms: number;
};

/**
 * A candidate becomes a finding only if its checksum validates.
 *
 * This is the whole difference between "there is a 13-digit number here" and "this page
 * publishes an EAN". `parseEan` is the one implementation of that question in the codebase.
 */
function accept(where: string, raw: string | null | undefined): Hit {
  const ean = parseEan(raw);
  return ean ? { where, value: ean } : null;
}

async function inspect(page: Page, url: string): Promise<Omit<Finding, "merchant" | "url">> {
  const t0 = Date.now();
  const done = (r: Omit<Finding, "merchant" | "url" | "ms">) => ({ ...r, ms: Date.now() - t0 });

  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
  if (!resp) return done({ where: null, value: null, note: "navigation failed" });
  if (resp.status() >= 400) return done({ where: null, value: null, note: `HTTP ${resp.status()}` });
  await page.waitForTimeout(3500);

  // Collected first, judged after, so a page carrying an INVALID number is reported as such
  // rather than silently falling through to "nothing found".
  const rejected: string[] = [];
  const tryAll = (where: string, candidates: (string | null | undefined)[]): Hit => {
    for (const c of candidates) {
      if (!c) continue;
      const hit = accept(where, c);
      if (hit) return hit;
      rejected.push(`${where}:${String(c).slice(0, 20)}`);
    }
    return null;
  };

  // 1. JSON-LD Product.gtin13 / gtin / ean — the cheapest and most reliable when present.
  const ld = await page.evaluate(() =>
    [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? ""),
  );
  for (const block of ld) {
    const m = block.match(/"(gtin13|gtin14|gtin|gtin8|ean)"\s*:\s*"?(\d{8,14})"?/i);
    const hit = tryAll(`json-ld ${m?.[1] ?? "gtin"}`, [m?.[2]]);
    if (hit) return done({ ...hit, note: "" });
  }

  // 2. A meta tag.
  const meta = await page.evaluate(() => {
    for (const m of document.querySelectorAll("meta")) {
      const p = (m.getAttribute("property") ?? m.getAttribute("name") ?? "").toLowerCase();
      if (/gtin|ean|barcode/.test(p)) return `${p}=${m.getAttribute("content") ?? ""}`;
    }
    return null;
  });
  {
    const hit = tryAll("meta", [meta?.match(/\d{8,14}/)?.[0]]);
    if (hit) return done({ ...hit, note: meta?.slice(0, 40) ?? "" });
  }

  // 3. A spec table or definition list whose LABEL says EAN / cod de bare.
  const spec = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tr, li, dl > div, .row, [class*='spec'], [class*='attribute']")];
    for (const r of rows) {
      const t = (r.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t.length > 200) continue;
      if (/\b(ean|gtin|cod de bare|codul de bare|barcode)\b/i.test(t)) return t.slice(0, 120);
    }
    return null;
  });
  if (spec) {
    const hit = tryAll("spec row", spec.match(/\d{8,14}/g) ?? []);
    if (hit) return done({ ...hit, note: spec });
    return done({ where: null, value: null, note: `LABEL PRESENT, no valid EAN: ${spec}` });
  }

  // 4. Any embedded JSON payload carrying an ean/gtin key.
  const payload = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const out: string[] = [];
    for (const m of html.matchAll(/["'](?:ean|gtin13|gtin|barcode|codBare)["']\s*:\s*["']?(\d{8,14})/gi)) out.push(m[1]);
    return out.slice(0, 8);
  });
  {
    const hit = tryAll("embedded json", payload);
    if (hit) return done({ ...hit, note: "" });
  }

  // Last resort, and NEVER a find: a checksum-valid 13-digit number somewhere in the text with
  // no label saying what it is. Reported separately because it is a lead, not an identifier —
  // acting on it would be the "unchecked barcode" failure the ean module exists to prevent.
  const body = await page.evaluate(() => document.body.innerText.slice(0, 20000));
  const loose = [...body.matchAll(/\b\d{13}\b/g)].map((m) => m[0]).filter((d) => parseEan(d) !== "");
  if (loose.length) {
    return done({
      where: null,
      value: null,
      note: `UNLABELLED but checksum-valid: ${loose.slice(0, 2).join(",")} — a lead, not an identifier`,
    });
  }

  return done({
    where: null,
    value: null,
    note: rejected.length ? `candidates failed checksum: ${rejected.slice(0, 3).join(" ")}` : "nothing found",
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const want = argv.filter((a) => !a.startsWith("--"));
  const n = Number((argv.find((a) => a.startsWith("--n=")) ?? "--n=6").split("=")[1]);

  const merchants = await prisma.merchant.findMany({ where: { active: true }, select: { id: true, slug: true } });
  const targets = merchants.filter((m) => want.length === 0 || want.includes(m.slug));
  if (targets.length === 0) {
    console.error(`No active merchant matched ${want.join(", ") || "(none)"}. Checked nothing — a FAILURE, not a pass.`);
    emitJson({ pass: false, reason: "no-merchant-matched" });
    await prisma.$disconnect();
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ locale: "ro-RO", viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const findings: Finding[] = [];
  const perMerchant: Record<string, { liveGrocery: number; withEan: number; missing: number; probeable: number; unprobeable: number; robots: boolean }> = {};

  try {
    for (const m of targets) {
      const live = { merchantId: m.id, isStale: false, flagged: false };
      const liveGrocery = await prisma.offer.count({ where: { ...live, product: { section: "grocery" } } });
      const withEan = await prisma.offer.count({
        where: { ...live, product: { section: "grocery", ean: { not: null } } },
      });

      // THE FIX THAT MATTERS: only products we have NO EAN for. Anything else measures how well
      // we already did, not what is left to get.
      const missing = await prisma.offer.count({
        where: { ...live, product: { section: "grocery", ean: null } },
      });
      const candidates = await prisma.offer.findMany({
        where: { ...live, productUrl: { not: null }, product: { section: "grocery", ean: null } },
        select: { productUrl: true, product: { select: { name: true } } },
        orderBy: { id: "asc" },
      });
      // CLAUDE.md: distinguish "the source has none" from "we lost them". Glovo and the Kaufland
      // flyer publish no per-product page, so their gap is NOT PROBEABLE — reporting that as
      // "none missing" would turn 3,751 real gaps into a clean bill of health.
      const unprobeable = missing - candidates.length;
      perMerchant[m.slug] = { liveGrocery, withEan, missing, probeable: candidates.length, unprobeable, robots: true };

      console.log(`\n${"=".repeat(100)}`);
      console.log(
        `${m.slug}   ${liveGrocery} live grocery offers · ${withEan} already have an EAN (${((withEan / Math.max(1, liveGrocery)) * 100).toFixed(1)}%) · ${missing} missing one`,
      );
      console.log("=".repeat(100));
      if (missing === 0) {
        console.log("  no live grocery offer is missing an EAN — nothing to probe");
        continue;
      }
      if (candidates.length === 0) {
        console.log(`  ${unprobeable} offers are missing an EAN and NONE carries a productUrl —`);
        console.log(`  this merchant publishes no per-product page, so the gap cannot be closed by scraping.`);
        continue;
      }

      const step = Math.max(1, Math.floor(candidates.length / n));
      const sample = candidates.filter((_, i) => i % step === 0).slice(0, n);

      if (!(await allowedByRobots(sample[0].productUrl!))) {
        perMerchant[m.slug].robots = false;
        console.log(`  robots.txt disallows our probe on this path — not fetched`);
        continue;
      }

      for (const s of sample) {
        const r = await inspect(page, s.productUrl!);
        findings.push({ merchant: m.slug, url: s.productUrl!, ...r });
        const verdict = r.where ? `FOUND via ${r.where}: ${r.value}` : `no — ${r.note}`;
        console.log(`  ${s.product.name.slice(0, 44).padEnd(44)} ${String(r.ms).padStart(5)}ms  ${verdict}`);
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
  }

  if (findings.length === 0) {
    console.error("\nNo page was fetched. Checked nothing — a FAILURE, not a pass.");
    emitJson({ pass: false, reason: "no-pages-fetched", perMerchant });
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`\n${"=".repeat(100)}`);
  console.log("PER MERCHANT — is an EAN obtainable, by what mechanism, at what cost?");
  console.log("=".repeat(100));
  console.log(
    "  merchant        live  missing   sampled  yield   mechanism                 s/page   full harvest",
  );
  const rows: Record<string, unknown>[] = [];
  for (const m of targets) {
    const fs = findings.filter((f) => f.merchant === m.slug);
    const info = perMerchant[m.slug];
    if (!info) continue;
    if (fs.length === 0) {
      const why = !info.robots
        ? "robots.txt"
        : info.missing === 0
          ? "none missing"
          : info.probeable === 0
            ? `NO PRODUCT PAGE (${info.unprobeable} gaps unreachable)`
            : "not fetched";
      console.log(`  ${m.slug.padEnd(15)}${String(info.liveGrocery).padStart(5)}${String(info.missing).padStart(9)}        —      —   ${why}`);
      rows.push({ merchant: m.slug, ...info, sampled: 0, yield: null, mechanism: why });
      continue;
    }
    const hit = fs.filter((f) => f.value);
    const how = [...new Set(hit.map((f) => f.where))].join(", ") || "—";
    const secPer = fs.reduce((a, f) => a + f.ms, 0) / fs.length / 1000;
    // The cost the brief asks for: one detail fetch per product missing an EAN.
    const hours = (info.missing * secPer) / 3600;
    console.log(
      `  ${m.slug.padEnd(15)}${String(info.liveGrocery).padStart(5)}${String(info.missing).padStart(9)}${String(fs.length).padStart(10)}${`${hit.length}/${fs.length}`.padStart(7)}   ${how.padEnd(24)}${secPer.toFixed(1).padStart(6)}${`${hours.toFixed(1)}h`.padStart(15)}`,
    );
    rows.push({
      merchant: m.slug,
      ...info,
      sampled: fs.length,
      hits: hit.length,
      mechanism: how,
      secondsPerPage: Number(secPer.toFixed(2)),
      fullHarvestHours: Number(hours.toFixed(2)),
    });
  }

  console.log(`\n  A yield is only counted when the number PASSES ITS CHECKSUM (parseEan).`);
  console.log(`  Pages carrying an EAN-ish label with no valid number are listed as LABEL PRESENT.`);
  emitJson({ pass: true, sampled: findings.length, perMerchant: rows, findings });
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
