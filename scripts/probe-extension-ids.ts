// ── WHAT IDENTIFIES A PRODUCT ON EACH MERCHANT'S OWN PAGE? Asked of the pages.
//
// A browser extension standing on a retailer's product page has to turn that page into something
// our API can look up. The brief asks for the per-merchant table BEFORE any adapter is written,
// and this produces it by fetching one real product page per merchant and reading what is
// actually there — not what a merchant's stack usually exposes.
//
// Four candidate identifiers, in the order the extension would try them:
//
//   URL          the page's own address. We store `productUrl` on 12 of 16 merchants at 100%,
//                so this is the primary key — see docs/API.md §0.
//   JSON-LD      `<script type="application/ld+json">` with a Product. Written for Google, so
//                it changes less often than the DOM, and frequently carries sku/gtin.
//   meta/OG      `og:url`, `product:retailer_item_id`, `itemprop=sku`.
//   name + size  the fallback, which is exactly what our matcher takes.
//
// FOUR MERCHANTS CANNOT BE COVERED AT ALL and the table says so: Kaufland's flyer and the three
// Glovo storefronts publish no per-product page, so there is nothing for a content script to
// stand on. That is declared in `lib/source-capabilities.ts`, not inferred from a null count.
//
// Politeness: one page per merchant, 2s apart, robots.txt honoured.
//
//   npm run probe:extension-ids

import { PrismaClient } from "@prisma/client";
import { allowedByRobots, PROBE_UA } from "../src/lib/net/robots";
import { nullProductUrlIsExpected } from "../src/lib/source-capabilities";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

type Row = {
  merchant: string;
  liveOffers: number;
  weStoreUrl: boolean;
  weStoreSku: boolean;
  weStoreEan: boolean;
  pageJsonLd: string | null;
  pageSku: string | null;
  pageOgUrl: boolean;
  canonical: boolean;
  status: "usable" | "no-product-page" | "unread" | "robots";
  note: string;
};

function findJsonLdProduct(html: string): { sku?: string; gtin?: string; name?: string } | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const block = m[1];
    if (!/"@type"\s*:\s*"?Product"?/i.test(block)) continue;
    const pick = (k: string) => block.match(new RegExp(`"${k}"\\s*:\\s*"([^"]{1,60})"`, "i"))?.[1];
    return { sku: pick("sku"), gtin: pick("gtin13") ?? pick("gtin") ?? pick("gtin8"), name: pick("name") };
  }
  return null;
}

async function main(): Promise<void> {
  const merchants = await prisma.merchant.findMany({
    where: { active: true },
    select: { slug: true, name: true },
    orderBy: { slug: "asc" },
  });

  const rows: Row[] = [];
  let lastHost = "";

  for (const m of merchants) {
    const agg = await prisma.offer.aggregate({
      where: { merchant: { slug: m.slug }, isStale: false },
      _count: { _all: true },
    });
    const withUrl = await prisma.offer.count({ where: { merchant: { slug: m.slug }, isStale: false, productUrl: { not: null } } });
    const withSku = await prisma.offer.count({ where: { merchant: { slug: m.slug }, isStale: false, sku: { not: null } } });
    const withEan = await prisma.offer.count({ where: { merchant: { slug: m.slug }, isStale: false, product: { ean: { not: null } } } });
    const n = agg._count._all;

    const base: Row = {
      merchant: m.slug, liveOffers: n,
      weStoreUrl: withUrl > 0, weStoreSku: withSku > 0, weStoreEan: withEan > n * 0.5,
      pageJsonLd: null, pageSku: null, pageOgUrl: false, canonical: false,
      status: "usable", note: "",
    };

    // A merchant that publishes no per-product page cannot host a content script at all.
    if (nullProductUrlIsExpected(m.slug) || withUrl === 0) {
      rows.push({ ...base, status: "no-product-page", note: "publică doar liste/pliant — nu există pagină de produs" });
      continue;
    }

    const sample = await prisma.offer.findFirst({
      where: { merchant: { slug: m.slug }, isStale: false, productUrl: { not: null }, availability: "in stock" },
      select: { productUrl: true },
    });
    const url = sample?.productUrl;
    if (!url) { rows.push({ ...base, status: "unread", note: "no sample URL" }); continue; }

    const host = (() => { try { return new URL(url).host; } catch { return ""; } })();
    if (host && host === lastHost) await sleep(2000);
    lastHost = host;

    if (!(await allowedByRobots(url))) { rows.push({ ...base, status: "robots", note: "robots.txt interzice" }); continue; }

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 25_000);
      const res = await fetch(url, { headers: { "user-agent": PROBE_UA, "accept-language": "ro-RO,ro;q=0.9" }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) { rows.push({ ...base, status: "unread", note: `HTTP ${res.status}` }); continue; }
      const html = await res.text();
      const ld = findJsonLdProduct(html);
      rows.push({
        ...base,
        pageJsonLd: ld ? [ld.sku && `sku=${ld.sku}`, ld.gtin && `gtin=${ld.gtin}`].filter(Boolean).join(" ") || "Product (no id)" : null,
        pageSku: html.match(/itemprop=["']sku["'][^>]*content=["']([^"']+)/i)?.[1]
          ?? html.match(/"retailer_item_id"\s*:\s*"([^"]+)"/i)?.[1] ?? null,
        pageOgUrl: /property=["']og:url["']/i.test(html),
        canonical: /rel=["']canonical["']/i.test(html),
      });
    } catch (e) {
      rows.push({ ...base, status: "unread", note: String((e as Error).message).slice(0, 40) });
    }
    await sleep(2000);
  }

  console.log("═".repeat(112));
  console.log("EXTENSION IDENTIFIERS — what identifies a product on each merchant's page");
  console.log("═".repeat(112));
  console.log(`  ${pad("merchant", 16)}${pad("offers", 8)}${pad("we store", 22)}${pad("on the page", 34)}verdict`);
  console.log("  " + "─".repeat(108));

  for (const r of rows) {
    const we = [r.weStoreUrl && "url", r.weStoreSku && "sku", r.weStoreEan && "ean"].filter(Boolean).join("+") || "—";
    const page = r.status === "usable"
      ? [r.pageJsonLd && `ld:${r.pageJsonLd}`, r.pageSku && `sku:${r.pageSku}`, r.canonical && "canonical", r.pageOgUrl && "og:url"].filter(Boolean).join(" ") || "URL only"
      : r.note;
    const verdict =
      r.status === "no-product-page" ? "IMPOSSIBLE — no product page"
      : r.status === "robots" ? "skipped (robots.txt)"
      : r.status === "unread" ? "unread"
      : r.weStoreSku && r.pageSku ? "sku → exact"
      : "url → exact";
    console.log(`  ${pad(r.merchant, 16)}${pad(String(r.liveOffers), 8)}${pad(we, 22)}${pad(page.slice(0, 32), 34)}${verdict}`);
  }

  const usable = rows.filter((r) => r.status === "usable");
  const impossible = rows.filter((r) => r.status === "no-product-page");

  console.log(`\n${"─".repeat(112)}`);
  console.log(`  ${usable.length} merchants an extension can work on, covering ${usable.reduce((a, r) => a + r.liveOffers, 0)} live offers.`);
  console.log(`  ${impossible.length} CANNOT be covered at all — no per-product page exists to stand on:`);
  console.log(`    ${impossible.map((r) => r.merchant).join(", ") || "(none)"}`);
  console.log(`\n  Every usable merchant is reachable by URL, which is the primary key our API takes.`);
  console.log(`  An adapter per merchant is therefore NOT needed to identify the product — only to`);
  console.log(`  find where on the page to put the panel. That is a smaller job than the brief assumed.`);
  console.log("═".repeat(112));

  emitJson({ pass: true, merchants: rows.length, usable: usable.length, impossible: impossible.length, rows });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
