// Are we serving product images, or is the visitor's browser fetching them from 13 retailers?
//
// Hotlinking a merchant's CDN is three problems wearing one coat:
//
//   1. PRIVACY. Every visitor's browser connects directly to Auchan, Metro, Carrefour and the
//      rest, handing each of them the visitor's IP address, User-Agent and Referer — which
//      names the exact page being read. For a Romanian site that is a third-country/third-party
//      disclosure a privacy policy has to declare, and ours could not have, because nobody had
//      counted the hosts.
//   2. RELIABILITY. The merchant can change or remove any image at any moment, and the first
//      we would know is a page of broken thumbnails.
//   3. COURTESY AND TERMS. It is their bandwidth, serving our page, without being asked.
//
// `download-images` self-hosts a bounded batch per run. This reports whether that batch is
// large enough to ever finish — which is the question nobody had asked.
//
// Read-only. Run: npm run audit:images

import { PrismaClient } from "@prisma/client";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();
const DIR = join(process.cwd(), "public", "product-images");
const BATCH_PER_RUN = Number(process.env.IMG_LIMIT ?? 600);

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lpad = (s: string | number, n: number): string => String(s).padStart(n);

async function main(): Promise<void> {
  const rows = await prisma.product.findMany({ select: { image: true } });

  const byHost = new Map<string, number>();
  let selfHosted = 0;
  let missing = 0;
  let unparseable = 0;

  for (const r of rows) {
    if (!r.image) { missing++; continue; }
    if (r.image.startsWith("/")) { selfHosted++; continue; }
    try {
      byHost.set(new URL(r.image).hostname, (byHost.get(new URL(r.image).hostname) ?? 0) + 1);
    } catch {
      unparseable++;
    }
  }

  const remote = [...byHost.values()].reduce((a, b) => a + b, 0) + unparseable;
  const pct = (n: number): string => ((n / rows.length) * 100).toFixed(1) + "%";

  console.log("\n════ PRODUCT IMAGE HOSTING ══════════════════════════════════════════════");
  console.log(`  products         ${lpad(rows.length, 8)}`);
  console.log(`  self-hosted      ${lpad(selfHosted, 8)}   ${pct(selfHosted)}`);
  console.log(`  HOTLINKED        ${lpad(remote, 8)}   ${pct(remote)}   <- the visitor's browser calls these`);
  console.log(`  no image at all  ${lpad(missing, 8)}   ${pct(missing)}`);

  console.log("\n  THIRD PARTIES EVERY VISITOR'S BROWSER CONTACTS");
  console.log(`  ${pad("host", 52)}${lpad("products", 10)}`);
  for (const [h, n] of [...byHost.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(h, 52)}${lpad(n, 10)}`);
  }
  if (unparseable) console.log(`  ${pad("(unparseable URL)", 52)}${lpad(unparseable, 10)}`);
  console.log(`\n  ${byHost.size} distinct hosts. Each one receives the visitor's IP, User-Agent and`);
  console.log("  Referer — which names the page they are reading. A privacy policy must say so.");

  // Local files on disk, which is not the same number as products pointing at them.
  let files = 0;
  let bytes = 0;
  if (existsSync(DIR)) {
    for (const f of readdirSync(DIR)) {
      files++;
      try { bytes += statSync(join(DIR, f)).size; } catch { /* ignore */ }
    }
  }
  console.log(`\n  on disk: ${files} files, ${(bytes / 1048576).toFixed(1)} MB in public/product-images`);
  if (files > selfHosted) {
    console.log(`  ${files - selfHosted} file(s) are on disk but no product points at them — orphaned by a re-scrape.`);
  }

  console.log("\n  CAN THE SELF-HOSTING EVER FINISH?");
  console.log(`  download-images converts ${BATCH_PER_RUN} images per nightly run (IMG_LIMIT).`);
  if (remote === 0) {
    console.log("  Nothing left to convert.");
  } else {
    const nights = Math.ceil(remote / BATCH_PER_RUN);
    console.log(`  ${remote} remaining / ${BATCH_PER_RUN} per night = ${nights} nights, IF the catalog stopped growing.`);
    console.log("  It does not: every scrape adds products, each arriving with a remote URL. So the");
    console.log("  batch has to exceed the growth rate or this never converges. Run once with");
    console.log("  IMG_LIMIT=all to clear the backlog, then the nightly batch only has to keep up.");
    const gb = (remote * 40) / 1024; // ~40 KB per product image, from the files already on disk
    console.log(`  Rough cost of clearing it: ~${gb.toFixed(1)} MB of disk and ${remote} requests.`);
  }
  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
