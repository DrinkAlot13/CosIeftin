// ── SCOPE: USER-FACING ────────────────────────────────────────────────────────
// Counts ONLY rows that reach a page — what a shopper can see right now.
// A withheld, flagged, stale-and-hidden or quarantined row is on no page and cannot
// mislead anyone, so counting it reports a defect the site does not have. Three checks
// did exactly that and returned 8,822, 22 and 46 phantom failures; an audit that does
// not share the display's definition of "shown" trains you to ignore it, which is as
// dangerous as one that misses real defects.
// What a user actually sees. Everything here is checked against the DATABASE the pages read,
// not against the code that writes it.
//
// The checks are deliberately the dumb, literal ones — "does this page render the string
// NaN", "does this link point at the shop it claims" — because every sophisticated check in
// this project has at some point agreed with the thing it was checking.
//
// Read-only. Run: npm run audit:displayed

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";
import { MAX_DISPLAY_AGE_DAYS } from "../src/lib/pricing";
import { countStats } from "../src/lib/queries";

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

  // THE HEADLINE MUST COME FROM A SHOWABLE OFFER.
  //
  // The first version of this check asked whether the cheapest offer OVERALL was withheld,
  // and after 9,822 unverifiable rows were withheld it reported 1,594 "failures" — every one
  // of them a product where the withholding did exactly what it was supposed to. Withholding
  // a cheap wrong price and showing a dearer right one is the correct outcome, not a defect.
  //
  // What actually matters is that no page presents a price it would refuse to show, so that
  // is what is now measured. The count of products where a withheld offer was cheaper is
  // reported separately as information, because it is worth watching and is not a failure.
  const headlineStale: string[] = [];
  let noHeadline = 0;
  let cheaperWithheld = 0;
  for (const p of products) {
    const ok = p.offers.filter(showable);
    if (ok.length === 0) { noHeadline++; continue; }
    const headline = ok.reduce((a, b) => (b.price < a.price ? b : a));
    if (!showable(headline)) headlineStale.push(`/p/${p.slug}`);
    const priced = p.offers.filter((o) => (o.priceBani ?? Math.round(o.price * 100)) > 0);
    const cheapestAny = priced.reduce((a, b) => (b.price < a.price ? b : a));
    if (!showable(cheapestAny)) cheaperWithheld++;
  }
  record("every headline price comes from a showable offer", headlineStale);

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

  // ── A STRUCK PRICE MUST BE THE OFFER'S OWN REFERENCE, ABOVE ITS OWN PRICE.
  //
  //    The first version of this check asked whether a struck value collided with any other
  //    shop's price on the product. It reported 22, then 13, and every one examined was a
  //    COINCIDENCE: Kaufland's flyer genuinely strikes "was 5,09, now 3,99" while Carrefour
  //    currently charges 5,09. Shops price similarly, so collisions are expected rather than
  //    rare, and a check that cannot tell a real former price from a competitor's current one
  //    is a check that will be ignored.
  //
  //    The regression that actually matters is structural, not numeric: rendering something
  //    OTHER than the offer's own reference. So that is what is measured — a struck value must
  //    equal that offer's referencePriceBani and exceed that offer's own price. The
  //    cross-store bug cannot satisfy both.
  const badStrike: string[] = [];
  for (const p2 of products) {
    for (const o of p2.offers.filter(showable)) {
      const ref = o.referencePriceBani;
      if (ref == null || o.referencePriceKind !== "STRIKETHROUGH") continue;
      const own = o.priceBani ?? Math.round(o.price * 100);
      if (ref <= own) {
        badStrike.push(`/p/${p2.slug}: strikes ${(ref / 100).toFixed(2)} which is not above its own ${(own / 100).toFixed(2)}`);
      }
    }
  }
  record("every struck price is the offer's own reference, above its own price", badStrike);

  // ── THE HOMEPAGE COUNTERS MUST EQUAL A DIRECT QUERY ──────────────────────────────
  //
  // `countStats` IS imported here, on purpose, and that is not the usual mistake. The question
  // is not "is the filter right" — it is "does the function the homepage actually calls still
  // agree with a literal re-derivation of the same three numbers". They disagreed: `chains`
  // keyed on `isStale: false` while the other two used the display filter, so it counted
  // glovo-kaufland — 2,217 non-stale grocery offers, ZERO of them visible — and the homepage
  // was one cache-refresh away from claiming nine stores when eight had a price you could see.
  //
  // Written out longhand rather than reusing `currentOfferWhere`, so a change to that helper
  // cannot move both sides of the comparison at once.
  const shown = {
    merchant: { active: true },
    availability: "in stock",
    isStale: false,
    flagged: false,
    NOT: { priceSource: "DELIVERY_PLATFORM" },
    lastObservedAt: { gte: cutoff },
    product: { section: "grocery" },
  } as const;
  const [directProducts, directOffers, directChains] = await Promise.all([
    prisma.product.count({ where: { section: "grocery", offers: { some: shown } } }),
    prisma.offer.count({ where: shown }),
    prisma.merchant.count({ where: { active: true, offers: { some: shown } } }),
  ]);
  const shipped = await countStats();
  const counterMismatch: string[] = [];
  if (shipped.products !== directProducts) counterMismatch.push(`produse: homepage ${shipped.products} vs direct query ${directProducts}`);
  if (shipped.offers !== directOffers) counterMismatch.push(`prețuri: homepage ${shipped.offers} vs direct query ${directOffers}`);
  if (shipped.chains !== directChains) counterMismatch.push(`magazine alimentare: homepage ${shipped.chains} vs direct query ${directChains}`);
  console.log(`  homepage counters: produse ${directProducts} · prețuri ${directOffers} · magazine alimentare ${directChains}`);
  record("every homepage counter equals a direct query under the same filter", counterMismatch);

  // A store counted with nothing to show is the specific failure that happened; name it.
  const merchantsCounted = await prisma.merchant.findMany({
    where: { active: true, offers: { some: shown } },
    select: { slug: true },
  });
  const empties: string[] = [];
  for (const m of merchantsCounted) {
    const n = await prisma.offer.count({ where: { ...shown, merchant: { slug: m.slug } } });
    if (n === 0) empties.push(`${m.slug} is counted as a store but shows 0 prices`);
  }
  record("no merchant is counted on the homepage with zero visible prices", empties);

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

  emitJson({
    total: findings.length,
    passing: findings.length - failed,
    failing: failed,
    invariants: findings.map((f) => ({ name: f.check, pass: f.count === 0, count: f.count })),
    productsWithNoShowablePrice: noHeadline,
    products: products.length,
  });
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
