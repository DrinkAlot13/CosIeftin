// What a user actually sees. Everything here is checked against the DATABASE the pages read,
// not against the code that writes it.
//
// The checks are deliberately the dumb, literal ones — "does this page render the string
// NaN", "does this link point at the shop it claims" — because every sophisticated check in
// this project has at some point agreed with the thing it was checking.
//
// Read-only. Run: npm run audit:displayed

import { PrismaClient } from "@prisma/client";
import { MAX_DISPLAY_AGE_DAYS } from "../src/lib/pricing";

const prisma = new PrismaClient();

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number): string => String(s).padStart(n);

type Finding = { check: string; count: number; detail: string[] };
const findings: Finding[] = [];
const record = (check: string, detail: string[]): void => {
  findings.push({ check, count: detail.length, detail: detail.slice(0, 6) });
};

/** Host of a URL, or null when it is not a URL at all. */
function hostOf(u: string | null): string | null {
  if (!u) return null;
  try { return new URL(u).host.replace(/^www\./, ""); } catch { return null; }
}

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_DISPLAY_AGE_DAYS * 86_400_000);

  // ── A number that reaches a page must be a number.
  const numeric = await prisma.offer.findMany({
    where: { isStale: false, flagged: false, availability: "in stock" },
    select: {
      id: true, price: true, priceBani: true, pricePerUnit: true, pricePerUnitBani: true,
      merchant: { select: { slug: true } }, product: { select: { slug: true } },
    },
  });
  const bad = (n: number | null | undefined): boolean =>
    n != null && (!Number.isFinite(n) || Number.isNaN(n));
  record("no displayed number is NaN or Infinity",
    numeric.filter((o) => bad(o.price) || bad(o.pricePerUnit) || bad(o.priceBani) || bad(o.pricePerUnitBani))
      .map((o) => `offer ${o.id} [${o.merchant.slug}] /p/${o.product.slug} price=${o.price} ppu=${o.pricePerUnit}`));
  record("no showable offer has a zero or negative price",
    numeric.filter((o) => !(o.price > 0)).map((o) => `offer ${o.id} [${o.merchant.slug}] price=${o.price}`));

  // ── The unit price must reproduce from THIS row's own price and own size.
  const withOwn = await prisma.offer.findMany({
    where: { isStale: false, flagged: false, availability: "in stock", ownUnitSize: { gt: 0 } },
    select: { id: true, price: true, pricePerUnit: true, ownUnitSize: true, ownUnit: true, merchant: { select: { slug: true } } },
  });
  record("every unit price = its own price / its own size",
    withOwn.filter((o) => {
      const want = o.price / (o.ownUnitSize as number);
      return !(o.pricePerUnit > 0) || Math.abs(o.pricePerUnit - want) / want > 0.01;
    }).map((o) => `offer ${o.id} [${o.merchant.slug}] ${o.pricePerUnit} vs ${(o.price / (o.ownUnitSize as number)).toFixed(4)}`));

  // ── A headline price must be current. `isCurrent` decides display; this checks the data
  //    underneath it, so a bug in the display layer cannot hide a bug in the data.
  const products = await prisma.product.findMany({
    where: { offers: { some: { merchant: { active: true } } } },
    select: {
      slug: true,
      offers: {
        where: { merchant: { active: true } },
        select: { price: true, priceBani: true, isStale: true, flagged: true, availability: true, lastObservedAt: true, priceSource: true, referencePriceBani: true, referencePriceKind: true },
      },
    },
  });
  const showable = (o: (typeof products)[number]["offers"][number]): boolean =>
    !o.isStale && !o.flagged && o.availability === "in stock" &&
    (o.priceSource === "FLYER" || (o.lastObservedAt != null && o.lastObservedAt >= cutoff)) &&
    (o.priceBani ?? Math.round(o.price * 100)) > 0;

  const headlineStale: string[] = [];
  let noHeadline = 0;
  for (const p of products) {
    const ok = p.offers.filter(showable);
    if (ok.length === 0) { noHeadline++; continue; }
    // The cheapest offer OVERALL must not be one we would refuse to show.
    const priced = p.offers.filter((o) => (o.priceBani ?? Math.round(o.price * 100)) > 0);
    const cheapest = priced.reduce((a, b) => (b.price < a.price ? b : a));
    if (!showable(cheapest)) headlineStale.push(`/p/${p.slug}`);
  }
  record("no product's cheapest priced offer is one we withhold", headlineStale);

  // ── Deep links must go to the shop they claim.
  const merchants = await prisma.merchant.findMany({ select: { id: true, slug: true, websiteUrl: true } });
  const wrongHost: string[] = [];
  const noLink: string[] = [];
  for (const m of merchants) {
    const want = hostOf(m.websiteUrl);
    const offers = await prisma.offer.findMany({
      where: { merchantId: m.id, isStale: false, flagged: false, availability: "in stock" },
      select: { id: true, url: true, productUrl: true, priceSource: true },
    });
    for (const o of offers) {
      const link = o.productUrl ?? o.url;
      const h = hostOf(link);
      if (h === null) {
        // A flyer legitimately has no per-product link; anything else must have one.
        if (o.priceSource !== "FLYER") noLink.push(`offer ${o.id} [${m.slug}] link=${JSON.stringify(link)}`);
        continue;
      }
      if (want && h !== want && !h.endsWith(`.${want}`)) {
        wrongHost.push(`offer ${o.id} [${m.slug}] links to ${h}, expected ${want}`);
      }
    }
  }
  record("every 'La magazin' link points at that merchant's own domain", wrongHost);
  record("every showable non-flyer offer has a usable link", noLink);

  // ── NO STRUCK PRICE MAY EQUAL ANOTHER OFFER'S PRICE ON THE SAME PRODUCT.
  //
  //    The item page used to strike `summary.highest` — the cross-store maximum — beside the
  //    lowest, which reads as a discount nobody ever gave. A struck price is a claim about ONE
  //    offer's own history, so if the number being struck happens to be exactly what a
  //    different shop charges, that is the bug coming back.
  const crossStore: string[] = [];
  for (const p2 of products) {
    const priced = p2.offers.filter((o) => (o.priceBani ?? Math.round(o.price * 100)) > 0);
    if (priced.length < 2) continue;
    const prices = new Set(priced.map((o) => o.priceBani ?? Math.round(o.price * 100)));
    for (const o of priced) {
      const ref = (o as { referencePriceBani?: number | null }).referencePriceBani;
      const kind = (o as { referencePriceKind?: string | null }).referencePriceKind;
      if (ref == null || kind !== "STRIKETHROUGH") continue;
      const own = o.priceBani ?? Math.round(o.price * 100);
      if (ref !== own && prices.has(ref)) {
        crossStore.push(`/p/${p2.slug}: an offer strikes ${(ref / 100).toFixed(2)}, which is another shop's price`);
      }
    }
  }
  record("no struck price equals another offer's price on the same product", crossStore);

  // ── The two withheld cohorts must still be withheld, or be correct.
  const keptOver = await prisma.priceAnomaly.findMany({
    where: { rejectedPriceBani: { gt: 0 }, acceptedPriceBani: { not: null } },
    select: { offerId: true, acceptedPriceBani: true, offer: { select: { id: true, price: true, priceBani: true, flagged: true, isStale: true } } },
  });
  const leaked = keptOver.filter((a) => {
    const o = a.offer;
    if (!o) return false;
    if (o.flagged || o.isStale) return false; // withheld — fine
    const current = o.priceBani ?? Math.round(o.price * 100);
    // Not withheld, so it must have been REPLACED by a fresh observation.
    return a.acceptedPriceBani != null && Math.abs(current - a.acceptedPriceBani) <= 1;
  });
  record("no kept-over-refused price is live without having been re-observed",
    leaked.map((a) => `offer ${a.offerId} still holds the substituted price and is not withheld`));

  // ── Report
  console.log("\n════ WHAT A USER SEES ═══════════════════════════════════════════════════════");
  console.log(`  ${pad("check", 60)}${lp("violations", 12)}`);
  let failed = 0;
  for (const f of findings) {
    if (f.count > 0) failed++;
    console.log(`  ${f.count === 0 ? "✓" : "✗"} ${pad(f.check, 58)}${lp(f.count, 12)}`);
    for (const d of f.detail) console.log(`        ${d}`);
  }
  console.log(`\n  products with NO showable price at all: ${noHeadline} of ${products.length}`);
  console.log(`\n  ${findings.length - failed}/${findings.length} checks pass.\n`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
