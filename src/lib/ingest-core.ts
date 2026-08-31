// Reusable ingestion core for grocery offers. Takes normalized scraper output
// (not XML), matches each item to a canonical pre-set Product (EAN -> size-guarded
// fuzzy -> new), computes price-per-unit, and upserts the Offer + a price point.
// Relative imports so it runs under both Next and tsx.

import { prisma } from "./db";
import { bestFuzzyMatch, signature, type Candidate } from "./matching";
import { parseQuantity } from "./units/parseQuantity";

export type ScrapedItem = {
  name: string;
  brand?: string | null;
  ean?: string | null;
  price: number;
  packLabel?: string | null;
  url?: string | null;
  availability?: string | null;
};

export type Unit = "kg" | "l" | "buc";

/**
 * Parse a pack size ("1,5 L", "500 g", "6x0,5 L", "10 buc") into base unit + amount.
 *
 * RETIRED as an implementation — this is now a thin adapter over `parseQuantity`, which is the
 * single size parser. It kept its own regexes until Phase 1a, and the two quietly disagreed on
 * 611 of 34,263 catalog names (1.78%): every promotional pack, every "24 plicuri x 15 g" coffee
 * box, and — worst — "Albrau,0.5 l", where `[\d.]+` captured ",0.5", parseFloat read it as 0,
 * and the product got a unitSize of ZERO, dividing by zero in its per-unit price.
 *
 * Two parsers for one question means one of them is wrong and nothing says which. This shape
 * (canonical G/ML/BUC in, kg/l/buc out) is kept only because the Product schema stores those
 * three units; it discards packCount and the promo flag, so anything that needs the pack SHAPE
 * must call `parseQuantity` directly.
 */
export function parseSize(text: string): { unit: Unit; unitSize: number } | null {
  const q = parseQuantity(text);
  if (!q) return null;
  if (q.unit === "BUC") return { unit: "buc", unitSize: q.value };
  // G and ML are canonical in the small unit; the Product schema stores the large one.
  return { unit: q.unit === "G" ? "kg" : "l", unitSize: q.value / 1000 };
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Upsert one chain's offers from normalized scraped items. */
export async function ingestItemsForMerchant(merchantId: number, items: ScrapedItem[]) {
  const existing = await prisma.product.findMany({
    select: { id: true, name: true, brand: true, ean: true, unit: true, unitSize: true },
  });
  const eanToId = new Map<string, number>();
  for (const p of existing) if (p.ean) eanToId.set(p.ean, p.id);
  const sizeById = new Map(existing.map((p) => [p.id, p.unitSize]));

  const stats = { ean: 0, fuzzy: 0, new: 0 };
  let offers = 0;

  for (const it of items) {
    const name = String(it.name ?? "").trim();
    const brand = (it.brand ? String(it.brand).trim() : "") || null;
    const ean = it.ean ? String(it.ean).trim() : "";
    const parsed = parseSize(String(it.packLabel ?? "")) ?? parseSize(name);

    let productId: number;
    let method: "ean" | "fuzzy" | "new";

    if (ean && eanToId.has(ean)) {
      productId = eanToId.get(ean)!;
      method = "ean";
    } else {
      // Only consider candidates of a compatible size (guards against 500g↔1kg merges).
      const compatible = existing.filter(
        (k) => !parsed || (k.unit === parsed.unit && Math.abs(k.unitSize - parsed.unitSize) <= parsed.unitSize * 0.06 + 1e-9),
      );
      const candidates: Candidate[] = compatible.map((k) => ({ id: k.id, brand: k.brand, tokens: signature(k.brand, k.name) }));
      const m = bestFuzzyMatch(brand, name, candidates, 0.5);
      if (m) {
        productId = m.id;
        method = "fuzzy";
      } else {
        let slug = slugify(name) || `produs-${Date.now()}`;
        if (await prisma.product.findUnique({ where: { slug } })) slug = `${slug}-${Date.now()}`;
        const created = await prisma.product.create({
          data: { slug, name, brand, unit: parsed?.unit ?? "buc", unitSize: parsed?.unitSize ?? 1 },
        });
        existing.push({ id: created.id, name, brand, ean: null, unit: created.unit, unitSize: created.unitSize });
        sizeById.set(created.id, created.unitSize);
        productId = created.id;
        method = "new";
      }
    }

    const unitSize = sizeById.get(productId) ?? 1;
    const price = Number(it.price) || 0;
    const ppu = unitSize > 0 ? price / unitSize : price;
    const offer = await prisma.offer.upsert({
      where: { productId_merchantId: { productId, merchantId } },
      update: {
        price,
        pricePerUnit: ppu,
        packLabel: it.packLabel ?? null,
        availability: String(it.availability ?? "in stock"),
        url: String(it.url ?? ""),
        currency: "RON",
        matchedBy: method,
        lastSeen: new Date(),
      },
      create: {
        productId,
        merchantId,
        price,
        pricePerUnit: ppu,
        packLabel: it.packLabel ?? null,
        availability: String(it.availability ?? "in stock"),
        url: String(it.url ?? ""),
        currency: "RON",
        matchedBy: method,
      },
    });
    await prisma.priceHistory.create({ data: { offerId: offer.id, price } });
    stats[method]++;
    offers++;
  }

  return { offers, ...stats };
}
