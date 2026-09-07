// ── SCOPE: REPORT ONLY ────────────────────────────────────────────────────────
// Why is a card showing initials instead of a photograph?
//
// `audit:images` asks a different question — whose CDN is serving our visitors — and counts
// every row, shown or not. This one asks the shopper's question: of the products a visitor can
// actually see, how many have no usable picture, WHICH MERCHANT they come from, and WHY.
//
// The reasons are not interchangeable and the fixes are opposite:
//
//   no URL captured   → the scraper never read one. Fix at the scraper.
//   placeholder       → the scraper read the site's own spinner or "no image" asset. This is
//                       the worst kind, because it returns HTTP 200 and animates forever, so
//                       `onError` never fires and every liveness check calls it healthy.
//   dead URL          → the merchant removed or moved the file. Re-scrape or drop.
//   self-hosted, gone → we downloaded it and the file is not on disk.
//
// ATTRIBUTION IS BY HOSTNAME, and that is a limit worth stating plainly: `Product.image` is one
// column on the product, with no record of which merchant supplied it. The hostname is the best
// available evidence and it is evidence, not proof — a self-hosted `/product-images/...` path
// has lost its origin entirely and is reported as its own bucket rather than guessed at.
//
// Run: npm run audit:image-coverage        (add CHECK=1 to probe URLs over the network)

import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isPlaceholderImage } from "../src/lib/placeholder-image";

const prisma = new PrismaClient();
const MAX_DISPLAY_AGE_DAYS = 14;
const CHECK_NETWORK = process.env.CHECK === "1";
/** Per merchant. Politeness first: this is their bandwidth and we are only sampling. */
const PROBE_SAMPLE = Number(process.env.PROBE ?? 25);
const PROBE_DELAY_MS = 400;

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);
const pct = (a: number, b: number): string => (b === 0 ? "  —  " : `${((a / b) * 100).toFixed(1)}%`.padStart(6));

type Reason = "ok" | "no-url" | "placeholder" | "self-hosted-missing";

function classify(image: string | null): Reason {
  if (!image || image.trim() === "") return "no-url";
  if (isPlaceholderImage(image)) return "placeholder";
  if (image.startsWith("/")) {
    return existsSync(join(process.cwd(), "public", image.replace(/^\//, ""))) ? "ok" : "self-hosted-missing";
  }
  return "ok";
}

async function main(): Promise<void> {
  console.log(`\n════ IMAGE COVERAGE, PER MERCHANT, WITH REASONS ═════════════════════════════`);
  console.log(`  Only products a visitor can see: live offer, active merchant, in stock, not`);
  console.log(`  withheld, not a delivery platform, observed within ${MAX_DISPLAY_AGE_DAYS} days.\n`);

  const live = {
    merchant: { active: true },
    availability: "in stock",
    isStale: false,
    NOT: { priceSource: "DELIVERY_PLATFORM" },
    flagged: false,
    lastObservedAt: { gte: new Date(Date.now() - MAX_DISPLAY_AGE_DAYS * 86_400_000) },
  } as const;

  const merchants = await prisma.merchant.findMany({
    where: { active: true },
    select: { id: true, slug: true, name: true },
    orderBy: { slug: "asc" },
  });

  type Row = { slug: string; total: number; ok: number; noUrl: number; placeholder: number; missing: number; hosts: Map<string, number> };
  const rows: Row[] = [];

  for (const m of merchants) {
    const products = await prisma.product.findMany({
      where: { offers: { some: { ...live, merchantId: m.id } } },
      select: { image: true },
    });
    const row: Row = { slug: m.slug, total: products.length, ok: 0, noUrl: 0, placeholder: 0, missing: 0, hosts: new Map() };
    for (const p of products) {
      const r = classify(p.image);
      if (r === "ok") {
        row.ok++;
        const host = p.image!.startsWith("/") ? "(self-hosted)" : (() => { try { return new URL(p.image!).hostname; } catch { return "(unparseable)"; } })();
        row.hosts.set(host, (row.hosts.get(host) ?? 0) + 1);
      } else if (r === "no-url") row.noUrl++;
      else if (r === "placeholder") row.placeholder++;
      else row.missing++;
    }
    rows.push(row);
  }

  console.log(`  ${pad("MERCHANT", 20)} ${lp("live prods", 11)} ${lp("with image", 11)} ${lp("cover", 7)} ${lp("no URL", 8)} ${lp("placehldr", 10)} ${lp("gone", 6)}`);
  console.log(`  ${"-".repeat(80)}`);
  for (const r of rows.sort((a, b) => b.total - a.total)) {
    const bad = r.placeholder > 0 || r.noUrl > r.total * 0.2;
    console.log(
      `  ${bad ? "✗" : " "}${pad(r.slug, 19)} ${lp(r.total, 11)} ${lp(r.ok, 11)} ${pct(r.ok, r.total)} ` +
      `${lp(r.noUrl, 8)} ${lp(r.placeholder, 10)} ${lp(r.missing, 6)}`,
    );
  }

  // ── Catalog-wide, deduplicated: a product counted once however many shops carry it.
  const all = await prisma.product.findMany({
    where: { offers: { some: live } },
    select: { id: true, image: true },
  });
  const tally = { ok: 0, "no-url": 0, placeholder: 0, "self-hosted-missing": 0 } as Record<Reason, number>;
  for (const p of all) tally[classify(p.image)]++;
  console.log(`\n  CATALOG-WIDE (each product once, however many shops carry it)`);
  console.log(`    live products ............ ${lp(all.length, 7)}`);
  console.log(`    with a usable image ...... ${lp(tally.ok, 7)}  ${pct(tally.ok, all.length)}`);
  console.log(`    no URL captured .......... ${lp(tally["no-url"], 7)}  ${pct(tally["no-url"], all.length)}`);
  console.log(`    a placeholder / spinner .. ${lp(tally.placeholder, 7)}  ${pct(tally.placeholder, all.length)}`);
  console.log(`    self-hosted, file gone ... ${lp(tally["self-hosted-missing"], 7)}  ${pct(tally["self-hosted-missing"], all.length)}`);

  // ── WHICH MERCHANTS COULD FILL THE GAPS. The point of asking per merchant.
  const gapFillable = await prisma.$queryRawUnsafe<{ c: bigint | number }[]>(
    `SELECT COUNT(*) AS c FROM Product p
      WHERE (p.image IS NULL OR p.image = '')
        AND EXISTS (SELECT 1 FROM Offer o JOIN Merchant m ON m.id = o.merchantId
                     WHERE o.productId = p.id AND m.active = 1 AND o.isStale = 0 AND o.flagged = 0)`,
  );
  console.log(`\n  ${Number(gapFillable[0]?.c ?? 0)} products have no image at all but DO have a live offer somewhere.`);

  // ── CAN ANOTHER SHOP SUPPLY THE MISSING PICTURE?
  //
  // `Product.image` is a single column, so the second merchant's photograph was never stored and
  // this cannot be answered by looking it up. What CAN be answered is whether another merchant
  // is in a position to supply one on its next run — which is what matters, now that the fill
  // rule treats a placeholder as no image and lets a later scrape overwrite it.
  //
  // Attribution is by hostname, which is evidence and not proof; a self-hosted path has lost its
  // origin entirely and is excluded rather than guessed at.
  const placeholders = await prisma.product.findMany({
    where: { offers: { some: live }, image: { not: null } },
    select: { id: true, image: true, offers: { where: live, select: { merchant: { select: { slug: true } } } } },
  });
  let stuck = 0;
  let fillable = 0;
  const fillableBy = new Map<string, number>();
  for (const p of placeholders) {
    if (!isPlaceholderImage(p.image)) continue;
    // Which merchant's spinner is this? Match the hostname against the merchant slug.
    let owner: string | null = null;
    try { const h = new URL(p.image!).hostname; owner = merchants.find((m) => h.includes(m.slug.split("-")[0]))?.slug ?? null; } catch { /* unparseable */ }
    const others = p.offers.map((o) => o.merchant.slug).filter((s) => s !== owner);
    if (others.length > 0) {
      fillable++;
      for (const o of new Set(others)) fillableBy.set(o, (fillableBy.get(o) ?? 0) + 1);
    } else {
      stuck++;
    }
  }
  console.log(`\n  OF THE ${fillable + stuck} LIVE PRODUCTS HOLDING A PLACEHOLDER:`);
  console.log(`    another shop already prices it .. ${lp(fillable, 6)}  → its next run replaces the placeholder`);
  console.log(`    only the shop that supplied it .. ${lp(stuck, 6)}  → fixed only by re-scraping that shop`);
  if (fillableBy.size > 0) {
    console.log(`    shops that could supply one:`);
    for (const [slug, n] of [...fillableBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`      ${pad(slug, 22)} ${lp(n, 6)}`);
    }
  }

  // ── Hosts actually serving our visitors.
  const hostTotals = new Map<string, number>();
  for (const r of rows) for (const [h, n] of r.hosts) hostTotals.set(h, (hostTotals.get(h) ?? 0) + n);
  console.log(`\n  IMAGE HOSTS (by live product-merchant pairs)`);
  for (const [h, n] of [...hostTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${pad(h, 44)} ${lp(n, 7)}`);
  }

  // ── Optional: is the URL we stored actually alive?
  if (CHECK_NETWORK) {
    console.log(`\n  NETWORK PROBE — ${PROBE_SAMPLE} sampled URLs per merchant, ${PROBE_DELAY_MS} ms apart`);
    for (const m of merchants) {
      const sample = await prisma.product.findMany({
        where: { offers: { some: { ...live, merchantId: m.id } }, image: { not: null } },
        select: { image: true },
        take: PROBE_SAMPLE,
      });
      const remote = sample.map((s) => s.image!).filter((u) => !u.startsWith("/"));
      if (remote.length === 0) continue;
      let ok = 0; let dead = 0; let blocked = 0; let tiny = 0;
      for (const url of remote) {
        try {
          const res = await fetch(url, { method: "GET", headers: { "User-Agent": "CosMic/1.0 (+image liveness check)" }, signal: AbortSignal.timeout(8000) });
          if (res.status === 403 || res.status === 401 || res.status === 429) blocked++;
          else if (!res.ok) dead++;
          else {
            const len = Number(res.headers.get("content-length") ?? 0);
            // A 1x1 tracking pixel or an empty file is not a photograph.
            if (len > 0 && len < 1024) tiny++; else ok++;
          }
        } catch { dead++; }
        await new Promise((r) => setTimeout(r, PROBE_DELAY_MS));
      }
      console.log(`    ${pad(m.slug, 20)} sampled ${lp(remote.length, 3)}  ok ${lp(ok, 3)}  dead ${lp(dead, 3)}  blocked ${lp(blocked, 3)}  under 1 KB ${lp(tiny, 3)}`);
    }
  } else {
    console.log(`\n  (network probe skipped — run with CHECK=1 to test whether the URLs resolve)`);
  }

  console.log("");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
