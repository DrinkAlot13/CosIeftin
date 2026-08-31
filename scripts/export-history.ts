// Export the price history to a portable flat file.
//
// SQLite files corrupt, and a .db is only readable by SQLite. This is the one dataset we
// cannot rebuild by scraping again, so it gets a second copy in a format that any tool can
// read — and which doubles as the input to any future analysis (inflation series, promo
// cycles, per-merchant behaviour).
//
// CSV rather than Parquet on purpose: no dependency, readable by everything, and the volume
// (~78k rows) is nowhere near where the format would matter.
//
// Run: npm run export:history

import { PrismaClient } from "@prisma/client";
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();
const OUT_DIR = join(process.cwd(), "backups", "history");
const BATCH = 5000;

/** RFC4180: quote anything containing a comma, quote or newline; double interior quotes. */
function csv(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? '"' + s.split('"').join('""') + '"' : s;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = join(OUT_DIR, "price-history-" + stamp + ".csv");
  const stream = createWriteStream(out, { encoding: "utf8" });

  const header = [
    "recordedAt", "priceBani", "priceLei", "referencePriceBani",
    "merchantSlug", "merchantName", "productSlug", "productName",
    "section", "unit", "unitSize", "ean", "offerId", "productId",
  ];
  stream.write(header.join(",") + "\n");

  const total = await prisma.priceHistory.count();
  let written = 0;
  let cursor = 0;

  for (;;) {
    const rows = await prisma.priceHistory.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: BATCH,
      select: {
        id: true, price: true, priceBani: true, referencePriceBani: true, recordedAt: true,
        offer: {
          select: {
            id: true,
            merchant: { select: { slug: true, name: true } },
            product: { select: { id: true, slug: true, name: true, section: true, unit: true, unitSize: true, ean: true } },
          },
        },
      },
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      const bani = r.priceBani ?? Math.round(r.price * 100);
      stream.write([
        csv(r.recordedAt.toISOString()),
        csv(bani),
        csv((bani / 100).toFixed(2)),
        csv(r.referencePriceBani ?? ""),
        csv(r.offer.merchant.slug),
        csv(r.offer.merchant.name),
        csv(r.offer.product.slug),
        csv(r.offer.product.name),
        csv(r.offer.product.section),
        csv(r.offer.product.unit),
        csv(r.offer.product.unitSize),
        csv(r.offer.product.ean ?? ""),
        csv(r.offer.id),
        csv(r.offer.product.id),
      ].join(",") + "\n");
      written++;
    }
    cursor = rows[rows.length - 1].id;
    process.stdout.write("\r  exported " + written + "/" + total);
  }

  await new Promise<void>((resolve) => stream.end(resolve));
  const bytes = statSync(out).size;
  console.log("\r  exported " + written + "/" + total + " rows");
  console.log("  " + out);
  console.log("  " + (bytes / 1048576).toFixed(1) + " MB");

  if (written !== total) {
    console.error("\n✗ export incomplete: wrote " + written + " of " + total + " rows");
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log("\n✓ price history exported in full");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
