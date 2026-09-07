// CAN WE GET AN EAN OFF A PRODUCT DETAIL PAGE, PER MERCHANT? READ-ONLY.
//
// An EAN is the only identifier that settles a match without argument — the gelatine case in
// CLAUDE.md was resolved in one query because Auchan carried one. We have EANs for some
// products and none for most, and the brief asks whether the DETAIL pages carry them: in
// structured data, in a spec table, or in a JSON payload the page ships.
//
// It samples a few live products per merchant, opens each product's OWN url, and looks in four
// places. It writes nothing and does not touch the catalog.
//
//   npm run probe:ean
//   npm run probe:ean -- metro farmaciatei --n=5

import { PrismaClient } from "@prisma/client";
import { chromium, type Page } from "playwright";

const prisma = new PrismaClient();

/** A plausible EAN/GTIN: 8, 12, 13 or 14 digits. */
const EAN_RE = /\b(\d{13}|\d{14}|\d{12}|\d{8})\b/g;

type Finding = { merchant: string; url: string; where: string | null; value: string | null; note: string };

async function inspect(page: Page, url: string): Promise<{ where: string | null; value: string | null; note: string }> {
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null);
  if (!resp) return { where: null, value: null, note: "navigation failed" };
  if (resp.status() >= 400) return { where: null, value: null, note: `HTTP ${resp.status()}` };
  await page.waitForTimeout(3500);

  // 1. JSON-LD Product.gtin13 / gtin / sku — the cheapest and most reliable when present.
  const ld = await page.evaluate(() => {
    const out: string[] = [];
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) out.push(s.textContent ?? "");
    return out;
  });
  for (const block of ld) {
    const m = block.match(/"(gtin13|gtin14|gtin|gtin8|ean)"\s*:\s*"?(\d{8,14})"?/i);
    if (m) return { where: `json-ld ${m[1]}`, value: m[2], note: "" };
  }

  // 2. A meta tag.
  const meta = await page.evaluate(() => {
    for (const m of document.querySelectorAll("meta")) {
      const p = (m.getAttribute("property") ?? m.getAttribute("name") ?? "").toLowerCase();
      if (/gtin|ean|barcode/.test(p)) return `${p}=${m.getAttribute("content") ?? ""}`;
    }
    return null;
  });
  if (meta && /\d{8,14}/.test(meta)) return { where: "meta", value: (meta.match(/\d{8,14}/) ?? [""])[0], note: meta.slice(0, 40) };

  // 3. A spec table or definition list whose LABEL says EAN/cod de bare.
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
    const m = spec.match(/\d{8,14}/);
    if (m) return { where: "spec row", value: m[0], note: spec };
    return { where: null, value: null, note: `label present, no digits: ${spec}` };
  }

  // 4. Any embedded JSON payload carrying an ean/gtin key.
  const payload = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const m = html.match(/["'](?:ean|gtin13|gtin|barcode|codBare)["']\s*:\s*["']?(\d{8,14})/i);
    return m ? m[0].slice(0, 60) : null;
  });
  if (payload) {
    const m = payload.match(/\d{8,14}/);
    return { where: "embedded json", value: m ? m[0] : null, note: payload };
  }

  // Last resort: is a 13-digit number anywhere on the page at all? Reported separately, because
  // a bare number is not an identified EAN — it could be a phone number or an order code.
  const body = await page.evaluate(() => document.body.innerText.slice(0, 20000));
  const loose = [...body.matchAll(EAN_RE)].map((m) => m[1]).filter((d) => d.length === 13);
  if (loose.length) return { where: null, value: null, note: `unlabelled 13-digit numbers present (${loose.slice(0, 2).join(",")}) — NOT an identified EAN` };

  return { where: null, value: null, note: "nothing found" };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const want = argv.filter((a) => !a.startsWith("--"));
  const n = Number((argv.find((a) => a.startsWith("--n=")) ?? "--n=4").split("=")[1]);

  const merchants = await prisma.merchant.findMany({ where: { active: true }, select: { id: true, slug: true } });
  const targets = merchants.filter((m) => want.length === 0 || want.includes(m.slug));

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ locale: "ro-RO", viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const findings: Finding[] = [];

  try {
    for (const m of targets) {
      // How much of this merchant's catalog ALREADY has an EAN, and how many rows even carry a
      // product url to visit. Both are part of the answer.
      const withUrl = await prisma.offer.count({ where: { merchantId: m.id, productUrl: { not: null } } });
      const total = await prisma.offer.count({ where: { merchantId: m.id } });
      const withEan = await prisma.offer.count({ where: { merchantId: m.id, product: { ean: { not: null } } } });

      const sample = await prisma.offer.findMany({
        where: { merchantId: m.id, productUrl: { not: null }, isStale: false },
        select: { productUrl: true, product: { select: { name: true, ean: true } } },
        take: n,
      });

      console.log(`\n${"=".repeat(100)}`);
      console.log(`${m.slug}   ${total} offers · ${withUrl} carry a product url (${((withUrl / Math.max(1, total)) * 100).toFixed(0)}%) · ${withEan} already have an EAN (${((withEan / Math.max(1, total)) * 100).toFixed(0)}%)`);
      console.log("=".repeat(100));
      if (sample.length === 0) { console.log("  no offer carries a productUrl — nothing to visit"); continue; }

      for (const s of sample) {
        const r = await inspect(page, s.productUrl!);
        findings.push({ merchant: m.slug, url: s.productUrl!, ...r });
        const verdict = r.where ? `FOUND via ${r.where}: ${r.value}` : `not found — ${r.note}`;
        console.log(`  ${s.product.name.slice(0, 46).padEnd(46)} ${verdict}`);
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
  }

  console.log(`\n${"=".repeat(100)}\nPER MERCHANT — obtainable?\n${"=".repeat(100)}`);
  const byMerchant = new Map<string, Finding[]>();
  for (const f of findings) byMerchant.set(f.merchant, [...(byMerchant.get(f.merchant) ?? []), f]);
  for (const [m, fs] of byMerchant) {
    const hit = fs.filter((f) => f.value);
    const how = [...new Set(hit.map((f) => f.where))].join(", ") || "—";
    console.log(`  ${m.padEnd(16)} ${hit.length}/${fs.length} sampled pages yielded an EAN   ${how}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
