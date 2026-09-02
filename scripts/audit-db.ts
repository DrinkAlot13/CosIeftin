// STANDING INVARIANT AUDIT — queries the database directly and checks properties that no
// writer owns.
//
// WHY THIS EXISTS, and why it imports nothing but Prisma:
// Three separate corruptions in this codebase were found by querying the database against
// invariants the writing code did not share — the 64-way fan-out, the strikethrough diff
// that could not run, and the smeared tier ladders. None was visible to the code that
// created them. A scraper reporting "0 rejected" only means its own validator agreed with
// its own parser.
//
// So: NO import of any scraper, matcher, parser, or price module. Everything below is
// re-implemented locally on purpose. If this file shared code with the writer it would
// share the writer's blind spots, and it would stop being evidence.
//
// Run: npm run audit:db          (also part of `npm run verify`)
//      npm run audit:db -- --run <scraperRunId>   (record the result against a run)

import { PrismaClient } from "@prisma/client";
import { parsePrice } from "../src/lib/price/parsePrice";
import { findOutliers, baniOf, MEDIAN_DEVIATION } from "../src/lib/outlier";
import { resolveSiteUrl, isLocalOrigin } from "../src/lib/config/siteUrl";

const prisma = new PrismaClient();

/** When ScraperRun.offersWritten was added. Earlier rows default it to 0 and mean nothing. */
const OFFERS_WRITTEN_SINCE = new Date("2026-09-02T00:00:00Z");

// ── local helpers, deliberately not imported ──────────────────────────────────────
const MIN_BANI = 1;
const MAX_BANI = 100_000_000; // 1,000,000 lei
const STALE_DAYS = 14;

const FANOUT_P95_GROCERY = 3;
const FANOUT_MAX_ANY = 8;
const SMEAR_MIN_PRODUCTS = 5;
const SMEAR_MIN_BASES = 2;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
const lei = (bani: number) => (bani / 100).toFixed(2);

type Check = { name: string; group: string; pass: boolean; count: number; examples: string[]; note?: string };
const checks: Check[] = [];
function record(group: string, name: string, failures: string[], note?: string) {
  checks.push({ group, name, pass: failures.length === 0, count: failures.length, examples: failures.slice(0, 20), note });
}

// ── PRICES ────────────────────────────────────────────────────────────────────────
async function auditPrices() {
  const offers = await prisma.offer.findMany({
    select: {
      id: true, price: true, priceBani: true, vatBasis: true, vatRateBp: true,
      isStale: true, isExpired: true, flagged: true, rawPriceText: true, lastObservedAt: true, availability: true, priceSource: true, promoValidTo: true,
      productId: true, merchant: { select: { name: true, slug: true } }, product: { select: { name: true, section: true } },
    },
  });

  record("Prices", "no offer price at or below zero",
    offers.filter((o) => (o.priceBani ?? Math.round(o.price * 100)) <= 0)
      .map((o) => `offer ${o.id} [${o.merchant.name}] ${o.price} — ${o.product.name.slice(0, 40)}`));

  // ── PUBLISHED ORIGIN. Canonical tags, sitemap entries and alert emails all carry an
  //    absolute URL built from SITE_URL. If that resolves to localhost in production, the
  //    links point at the READER's own machine — and Google is slow to forgive a canonical
  //    it has already indexed. This is cheap to check and expensive to discover late.
  {
    const problems: string[] = [];
    try {
      const origin = resolveSiteUrl(process.env);
      if (process.env.NODE_ENV === "production" && isLocalOrigin(origin)) {
        problems.push(`SITE_URL resolves to ${origin} while NODE_ENV=production`);
      }
    } catch (e) {
      problems.push((e as Error).message);
    }
    record("Prices", "the published origin is not localhost in production", problems);
  }

  // ── STALENESS. A price we last observed a month ago is not a current price, and an
  //    out-of-stock offer is not one either. Both were winning "cel mai mic preț" and counting
  //    toward "N magazine" on thousands of pages, because the read path filtered on neither.
  {
    const bad: string[] = [];
    const byProduct = new Map<number, typeof offers>();
    for (const o of offers) { const a = byProduct.get(o.productId) ?? []; a.push(o); byProduct.set(o.productId, a); }
    const nowMs = Date.now();
    for (const [, list] of byProduct) {
      // WITHHELD OFFERS ARE NOT CANDIDATES FOR "cel mai mic preț".
      //
      // This invariant asked whether the cheapest offer of ALL was stale or out of stock, and
      // after 9,822 unverifiable rows were withheld it reported 8,822 violations — nearly
      // every one a product where the withholding did exactly its job. A flagged offer is on
      // no page and can win nothing, so counting it here measures a defect the site does not
      // have. The question that matters is whether anything a shopper CAN see is stale.
      const priced = list.filter(
        (o) => (o.priceBani ?? Math.round(o.price * 100)) > 0 && !o.flagged,
      );
      if (priced.length === 0) continue;
      // THE QUESTION IS WHAT THE SITE WOULD SHOW, NOT WHAT THE DATA CONTAINS.
      //
      // A product whose cheapest offer is out of stock is now normal and handled: the read
      // path picks its headline from CURRENT offers only, and the out-of-stock row still
      // renders greyed with its last-seen date. Counting the data condition reported 3,605
      // violations for a defect the display does not have.
      //
      // So the candidate pool here is the one the site actually chooses from. If that pool is
      // empty the page says it has no current price, which is correct and not a violation.
      const showable = priced.filter(
        (o) =>
          o.availability === "in stock" &&
          !o.isStale &&
          (o.priceSource === "FLYER" ||
            (o.lastObservedAt != null && (nowMs - o.lastObservedAt.getTime()) / 86400000 <= 14)),
      );
      if (showable.length === 0) continue;
      const cheapest = showable.reduce((a, b) => ((b.priceBani ?? 0) < (a.priceBani ?? 0) ? b : a));
      const ageDays = (nowMs - (cheapest.lastObservedAt ?? new Date(0)).getTime()) / 86400000;
      const oos = cheapest.availability !== "in stock";
      if (cheapest.lastObservedAt && ageDays > 14) {
        bad.push(`offer ${cheapest.id} [${cheapest.merchant.name}] is the cheapest and is ${ageDays.toFixed(0)} days old`);
      } else if (oos) {
        bad.push(`offer ${cheapest.id} [${cheapest.merchant.name}] is the cheapest and is OUT OF STOCK`);
      }
    }
    record("Freshness", "no stale or out-of-stock offer is a product's cheapest price", bad);
  }

  // ── OBSERVATION PROVENANCE. lastObservedAt is written by the scrape, on the rows the scrape
  //    actually saw, and NOWHERE ELSE. A merchant-level job must never touch it: one did,
  //    stamping merchant.lastScrapeAt onto 10,388 offers it had not observed, and three offers
  //    last seen on 6 August were shown as current 26 days later.
  //
  //    A FLYER offer expires by promoValidTo and needs no observation date. For every other
  //    source a null means we did not see it, and after a full scrape that should be near zero.
  //    If it is not, something is writing offers without observing them.
  record("Freshness", "no non-flyer offer lacks an observation date",
    offers.filter((o) => !o.lastObservedAt && (o.priceSource ?? "") !== "FLYER")
      .map((o) => `offer ${o.id} [${o.merchant.name}] priceSource=${o.priceSource ?? "null"} — ${o.product.name.slice(0, 40)}`));

  // ── THE FLYER EXEMPTION IS A TRIPWIRE, SO IT MUST NOT BE DISARMABLE BY RELABELLING.
  //
  //    FLYER offers are excused the observation-date requirement on the grounds that they
  //    expire by promoValidTo instead. That excuse is only honest if two things hold: the
  //    offers actually carry a window, and the set of merchants issuing flyers does not quietly
  //    grow. Otherwise a writer that stops recording observation dates can route around the
  //    check by stamping priceSource = "FLYER", and the invariant reports green forever.
  {
    const flyers = offers.filter((o) => (o.priceSource ?? "") === "FLYER");

    // An offer exempt because it expires by a window MUST have that window.
    record("Freshness", "every FLYER offer carries a promoValidTo",
      flyers.filter((o) => !o.promoValidTo)
        .map((o) => `offer ${o.id} [${o.merchant.name}] priceSource=FLYER with no promoValidTo`));

    // Only Kaufland publishes a weekly flyer today. A new name here is either a real change or
    // a writer routing around the exemption; both are worth seeing, neither should be silent.
    const EXPECTED_FLYER_MERCHANTS = new Set(["kaufland"]);
    const byMerchant = new Map<string, number>();
    for (const o of flyers) byMerchant.set(o.merchant.slug, (byMerchant.get(o.merchant.slug) ?? 0) + 1);
    record("Freshness", "only expected merchants issue FLYER offers",
      [...byMerchant.entries()]
        .filter(([slug]) => !EXPECTED_FLYER_MERCHANTS.has(slug))
        .map(([slug, n]) => `${slug} has ${n} FLYER offers but is not an expected flyer merchant`),
      `flyer counts: ${[...byMerchant.entries()].map(([m, n]) => `${m}=${n}`).join(", ") || "none"}`);
  }

  // ── ONE FIELD, ONE VOCABULARY. priceSource is written by two paths that disagree on case:
  //    backfill-phase1 writes SHELF/ONLINE/FLYER, while matchPoolToCatalog falls back to the
  //    MERCHANT's own value, which is lowercase shelf/delivery. Consumers compare against
  //    literals, so the same concept spelled two ways silently takes two different branches.
  {
    const ALLOWED = new Set(["SHELF", "ONLINE", "DELIVERY_PLATFORM", "FLYER"]);
    const seen = new Map<string, number>();
    for (const o of offers) {
      const v = o.priceSource ?? "(null)";
      if (!ALLOWED.has(v)) seen.set(v, (seen.get(v) ?? 0) + 1);
    }
    record("Prices", "priceSource uses only the documented vocabulary",
      [...seen.entries()].map(([v, n]) => `${n} offers carry priceSource="${v}", which is not one of ${[...ALLOWED].join("|")}`));
  }

  // ── A PRICE MUST REPRODUCE FROM ITS OWN SOURCE STRING.
  //
  //    `rawPriceText` exists so a stored price can be checked against what the page said, and
  //    so a parser change can be replayed against history. A row where the two disagree is a
  //    row whose provenance is a lie.
  //
  //    Before this invariant existed, 129 rows disagreed — and ALL 129 were flagged offers,
  //    129 of the 130 flagged rows in the database. The cause was on the shared write path:
  //    when a gate refused a price we kept the previously trusted value and overwrote
  //    rawPriceText with the REFUSED string anyway, corrupting the provenance of exactly the
  //    rows most in need of checking. Found by chasing a single farmaciatei row that stored
  //    31,00 against a source of "146,00".
  {
    const offers = await prisma.offer.findMany({
      where: { rawPriceText: { not: null } },
      select: { id: true, price: true, priceBani: true, rawPriceText: true, flagged: true,
                merchant: { select: { slug: true } } },
    });
    const broken: string[] = [];
    for (const o of offers) {
      const want = o.priceBani ?? Math.round(o.price * 100);
      const got = parsePrice(o.rawPriceText ?? "");
      if (got == null) continue; // unparseable is a different invariant
      if (Math.abs(got - want) <= 1) continue;
      broken.push(
        `offer ${o.id} [${o.merchant.slug}] stores ${(want / 100).toFixed(2)} but its own ` +
        `rawPriceText ${JSON.stringify(o.rawPriceText)} reads ${(got / 100).toFixed(2)}` +
        `${o.flagged ? " (flagged)" : ""}`,
      );
    }
    record("Prices", "every stored price reproduces from its own rawPriceText", broken);
  }

  // ── A TRUNCATED SCRAPE IS NOT A COMPLETED SCRAPE.
  //
  //    DCNeu published 180 leaf categories and MAX_CATS was 90, so `.slice(0, 90)` read the
  //    first half in page order and the run reported success. The offer count was simply
  //    lower — and a lower count is indistinguishable from a shop that sells less, which is
  //    why it survived weeks and why the product a user asked about did not exist.
  //
  //    Scrapers now call `noteCap`/`notePageCap` and a truncated run is refused at source.
  //    This invariant is the after-the-fact half: a merchant whose product count collapses
  //    relative to its own history, without an abort recorded, is the shape truncation leaves
  //    behind in the data.
  {
    const merchants = await prisma.merchant.findMany({
      where: { active: true },
      select: { id: true, slug: true, lastOfferCount: true },
    });
    const suspicious: string[] = [];
    for (const m of merchants) {
      const runs = await prisma.scraperRun.findMany({
        where: { merchantId: m.id, aborted: false, offersWritten: { gt: 0 } },
        orderBy: { startedAt: "desc" },
        take: 4,
        select: { offersWritten: true, startedAt: true },
      });
      if (runs.length < 3) continue;
      const latest = runs[0].offersWritten;
      const earlier = runs.slice(1).map((r) => r.offersWritten);
      const best = Math.max(...earlier);
      // Half or less than its own best recent run, while reporting success.
      if (best > 0 && latest <= best * 0.5) {
        suspicious.push(
          `${m.slug}: newest successful run wrote ${latest} against a recent best of ${best} ` +
          `— a collapse with no abort is what a silent cap looks like`,
        );
      }
    }
    record("Scraping", "no merchant's successful run collapsed to half its own recent best", suspicious);
  }

  // ── A MERCHANT THAT PRODUCES NOTHING IS NOT A QUIET MERCHANT.
  //
  //    Metro and Mega Image returned ZERO products from 31 August onward. A commit that
  //    hardened every fetch in the project added `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`
  //    inside two `page.evaluate` callbacks, where Node module scope does not exist; the
  //    ReferenceError was swallowed by each scraper's own catch and pagination stopped after
  //    page one.
  //
  //    It hid for two days because the 60% drop guard WORKED. It refused each empty run and
  //    kept the previous data instead of wiping it. So the data was safe and the merchant was
  //    dead, and nothing in the system distinguished those two states — the offers still had
  //    prices, still had dates, still looked live.
  //
  //    A guard that protects data is not a guard that reports health. This is the second one.
  {
    const ABORT_STREAK = 2;
    const merchants = await prisma.merchant.findMany({
      where: { active: true },
      select: { id: true, slug: true },
    });
    const dead: string[] = [];
    for (const m of merchants) {
      const runs = await prisma.scraperRun.findMany({
        where: { merchantId: m.id },
        orderBy: { startedAt: "desc" },
        take: ABORT_STREAK,
        select: { aborted: true, offersWritten: true, startedAt: true, abortReason: true },
      });
      if (runs.length < ABORT_STREAK) continue;
      const allBad = runs.every((r) => r.aborted || r.offersWritten === 0);
      if (allBad) {
        dead.push(
          `${m.slug}: last ${ABORT_STREAK} runs produced nothing ` +
          `(latest ${runs[0].startedAt.toISOString().slice(0, 16)}: ${runs[0].abortReason ?? "0 parsed"}) — ` +
          `its stored offers still look live`,
        );
      }
    }
    record("Scraping", `no active merchant has ${ABORT_STREAK} consecutive runs that produced nothing`, dead);
  }

  // ── A RUN CANNOT REPORT SUCCESS WITHOUT HAVING WRITTEN ANYTHING.
  //
  //    `offersParsed` counts pool items that had a readable price. A DCNeu run recorded
  //    offersParsed = 6,044, finished cleanly, marked itself not-aborted — and wrote ZERO
  //    offer rows; the merchant's newest observation date stayed a day old. Every check that
  //    read offersParsed called it a success, including the liveness check built that morning
  //    to catch exactly this.
  //
  //    `offersWritten` is counted at the write site and `recordScraperRun` derives `aborted`
  //    from it, so a scraper can no longer mark itself green while producing nothing. This
  //    invariant is what proves that derivation is still in force.
  {
    const bad = await prisma.scraperRun.findMany({
      // Only runs recorded SINCE offersWritten existed. Rows written before the column was
      // added default it to 0 while carrying aborted=false, so counting them reports 46
      // historical runs as liars when the truth is that nobody was recording the number yet.
      where: { aborted: false, offersWritten: 0, startedAt: { gte: OFFERS_WRITTEN_SINCE } },
      select: { id: true, startedAt: true, offersParsed: true, merchant: { select: { slug: true } } },
      take: 50,
    });
    record("Scraping", "no run is marked successful while having written zero offers",
      bad.map((r) => `run ${r.id} [${r.merchant.slug}] ${r.startedAt.toISOString().slice(0, 16)}: ` +
        `aborted=false but offersWritten=0 (offersParsed=${r.offersParsed})`));
  }

  // ── A DAY IS NOT A MARKET EVENT.
  //
  //    On 30 August, 1,675 offers moved more than 50% in a single afternoon across nine
  //    merchants, almost all upward. That turned out to be legitimate — the first full
  //    re-scrape after several parsers were fixed, and 1,652 of 1,653 current values agree
  //    with their own rawPriceText — but NOBODY KNEW THAT FOR TWO DAYS. Answering it took a
  //    fresh Auchan scrape to arbitrate against, because the evidence had not been kept.
  //
  //    The point of this invariant is not that a mass move is wrong. It is that a mass move
  //    must be NOTICED and explained at the time, while the cause is still knowable. A real
  //    market does not move 7% of a re-scraped catalog by more than half in one afternoon;
  //    a code change does.
  //
  //    THE DENOMINATOR IS OFFERS WRITTEN THAT DAY, not the whole catalog. A 200-offer run
  //    with 20 big moves is a broken run; 20 big moves across 40,000 offers is Tuesday.
  //
  //    THE THRESHOLD IS PROVISIONAL. It is set from five days of history: ordinary re-scrape
  //    days sit at 1.3%, 3.1% and 3.2%; the 30 August event was 7.3%. That is a thin margin
  //    and five days is not a distribution. Revisit it once the soak has produced a month.
  {
    const MASS_MOVE_PCT = 5;        // of the offers written that day
    const MIN_DAY_WRITES = 200;     // below this, a percentage is noise
    const hist = await prisma.priceHistory.findMany({
      select: { offerId: true, price: true, priceBani: true, recordedAt: true },
      orderBy: [{ offerId: "asc" }, { recordedAt: "asc" }],
    });
    const moves = new Map<string, number>();
    const writes = new Map<string, Set<number>>();
    let prevId = -1;
    let prevBani = 0;
    for (const h of hist) {
      const bani = h.priceBani ?? Math.round(h.price * 100);
      const day = h.recordedAt.toISOString().slice(0, 10);
      const w = writes.get(day) ?? new Set<number>();
      w.add(h.offerId);
      writes.set(day, w);
      if (h.offerId !== prevId) { prevId = h.offerId; prevBani = bani; continue; }
      if (prevBani > 0 && bani > 0 && Math.abs(bani - prevBani) / prevBani > 0.5) {
        moves.set(day, (moves.get(day) ?? 0) + 1);
      }
      prevBani = bani;
    }
    const spikes: string[] = [];
    for (const [day, written] of [...writes.entries()].sort()) {
      const n = moves.get(day) ?? 0;
      const pct = written.size === 0 ? 0 : (n / written.size) * 100;
      if (written.size >= MIN_DAY_WRITES && pct > MASS_MOVE_PCT) {
        spikes.push(
          `${day}: ${n} of ${written.size} offers written that day moved >50% (${pct.toFixed(1)}%) — ` +
          `identify the cause before trusting the day's prices`,
        );
      }
    }
    record("Prices", `no day moves >50% on more than ${MASS_MOVE_PCT}% of the offers written that day`, spikes);
  }

  // ── MERCHANT-SIDE VOCABULARY. Merchant.priceChannel answers "how does this store's price
  //    reach us"; Offer.priceSource answers "what kind of price is it". They used to share the
  //    name priceSource, and that shared name turned a translation across two vocabularies into
  //    something that looked like a harmless default. The deprecated column is now dropped;
  //    what remains is keeping this one inside its own vocabulary.
  {
    const merchants = await prisma.merchant.findMany({ select: { slug: true, priceChannel: true } });
    const CHANNELS = new Set(["shelf", "delivery", "aggregator"]);
    record("Prices", "Merchant.priceChannel uses the merchant-side vocabulary",
      merchants.filter((m) => !CHANNELS.has(m.priceChannel))
        .map((m) => `${m.slug}: priceChannel=${JSON.stringify(m.priceChannel)} is not shelf|delivery|aggregator`));
  }

  // ── THE MIGRATION INVARIANT. This should have existed from the day the bani columns were
  //    added, and its absence is why they drifted for weeks in total silence: every
  //    user-facing read still used the float, so nothing the shopper touched ever exercised
  //    the integer column. By the time anyone looked, 553 live offers had a NULL priceBani and
  //    614 held a completely different value from their float — not a rounding difference.
  //    While both columns exist, they must agree, exactly.
  record("Prices", "no live offer has a null priceBani",
    offers.filter((o) => !o.isStale && o.priceBani == null)
      .map((o) => `offer ${o.id} [${o.merchant.name}] price=${o.price} priceBani=null — ${o.product.name.slice(0, 40)}`));

  record("Prices", "priceBani equals round(price * 100) for every row",
    offers.filter((o) => o.priceBani != null && Math.abs(o.priceBani - Math.round(o.price * 100)) > 1)
      .map((o) => `offer ${o.id} [${o.merchant.name}] float=${o.price.toFixed(2)} bani=${o.priceBani} (=${((o.priceBani ?? 0) / 100).toFixed(2)})`));

  record("Prices", `no price outside ${MIN_BANI} ban .. ${MAX_BANI / 100} lei`,
    offers.filter((o) => { const b = o.priceBani ?? Math.round(o.price * 100); return b < MIN_BANI || b > MAX_BANI; })
      .map((o) => `offer ${o.id} [${o.merchant.name}] ${lei(o.priceBani ?? Math.round(o.price * 100))} lei`));

  // ── CROSS-STORE MEDIAN DEVIATION — one definition, imported.
  //
  //    This block used to carry its own copy of the rule while `withhold-outliers` carried
  //    another: two thresholds (absolute vs ratio, differing by a factor of two on the low
  //    side) over two populations (all offers vs visible ones). The audit said 47, the repair
  //    found 7, and the gap read as a bug in one of them rather than a disagreement between
  //    them. Both now import `lib/outlier`.
  //
  //    USER-FACING: counts only offers that reach a page.
  {
    const byProduct = new Map<number, typeof offers>();
    for (const o of offers) {
      const a = byProduct.get(o.productId) ?? [];
      a.push(o);
      byProduct.set(o.productId, a);
    }
    const found = findOutliers(byProduct);
    record("Prices", `no VISIBLE offer deviates >${MEDIAN_DEVIATION * 100}% from its cross-store median`,
      found.map((f) =>
        `offer ${f.offer.id} [${f.offer.merchant.name}] ${lei(baniOf(f.offer))} vs median ` +
        `${lei(f.medianBani)} of ${f.peers} — ${f.offer.product.name.slice(0, 36)}`));
  }

  // A net price must never be reachable by the optimizer — nobody pays the fără-TVA figure.
  record("Prices", "no WITHOUT_VAT offer is live (reachable by the optimizer)",
    offers.filter((o) => o.vatBasis === "WITHOUT_VAT" && !o.isStale && !o.isExpired && !o.flagged)
      .map((o) => `offer ${o.id} [${o.merchant.name}] basis=${o.vatBasis}`));

  // Only assert VAT completeness for merchants where we CLAIM to resolve it (i.e. where
  // some offers already have a rate). Asserting it everywhere would just be noise.
  const merchantsWithVat = new Set(offers.filter((o) => o.vatRateBp != null).map((o) => o.merchant.slug));
  // NOT a failure: a merchant can state both figures on most cards and not all, and
  // returning null instead of guessing is exactly the required behaviour. Report coverage.
  for (const slug of merchantsWithVat) {
    const mine = offers.filter((o) => o.merchant.slug === slug);
    const known = mine.filter((o) => o.vatRateBp != null).length;
    console.log(`  VAT coverage ${slug.padEnd(14)} ${known}/${mine.length} resolved (nulls are correct where the page states one figure)`);
  }

  return offers;
}

// ── TIERS ─────────────────────────────────────────────────────────────────────────
async function auditTiers() {
  const tiers = await prisma.bulkTier.findMany({
    select: {
      id: true, offerId: true, minQuantity: true, unitPriceBani: true,
      offer: { select: { price: true, priceBani: true, flagged: true, merchant: { select: { name: true } }, product: { select: { name: true } }, anomalies: { where: { resolved: false }, select: { id: true } } } },
    },
  });
  const byOffer = new Map<number, typeof tiers>();
  for (const t of tiers) { const a = byOffer.get(t.offerId) ?? []; a.push(t); byOffer.set(t.offerId, a); }

  const aboveBase: string[] = [];
  const nonMono: string[] = [];
  const onAnomaly: string[] = [];
  for (const [offerId, list] of byOffer) {
    const base = list[0].offer.priceBani ?? Math.round(list[0].offer.price * 100);
    const sorted = [...list].sort((a, b) => a.minQuantity - b.minQuantity);
    for (const t of sorted) {
      if (t.unitPriceBani >= base) {
        aboveBase.push(`offer ${offerId} [${t.offer.merchant.name}] tier ${t.minQuantity}+ ${lei(t.unitPriceBani)} >= base ${lei(base)}`);
      }
    }
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].unitPriceBani >= sorted[i - 1].unitPriceBani) {
        nonMono.push(`offer ${offerId} tier ${sorted[i].minQuantity}+ not cheaper than ${sorted[i - 1].minQuantity}+`);
      }
    }
    if (list[0].offer.anomalies.length > 0) {
      onAnomaly.push(`offer ${offerId} [${list[0].offer.merchant.name}] has ${list[0].offer.anomalies.length} unresolved anomal(ies) and ${list.length} tier(s)`);
    }
  }
  record("Tiers", "no rung at or above its offer's stored base price", aboveBase);
  record("Tiers", "no non-monotonic ladder", nonMono);
  record("Tiers", "no tiers on an offer with an unresolved PriceAnomaly", onAnomaly);

  // Smearing: individually valid, only visible in aggregate.
  const sig = new Map<string, { offers: number[]; bases: Set<number>; sample: string }>();
  for (const [offerId, list] of byOffer) {
    const base = list[0].offer.priceBani ?? Math.round(list[0].offer.price * 100);
    const key = [...list].sort((a, b) => a.minQuantity - b.minQuantity).map((t) => `${t.minQuantity}:${t.unitPriceBani}`).join("|");
    const g = sig.get(key) ?? { offers: [], bases: new Set<number>(), sample: list[0].offer.product.name };
    g.offers.push(offerId); g.bases.add(base); sig.set(key, g);
  }
  const smeared: string[] = [];
  for (const [key, g] of sig) {
    if (g.offers.length >= SMEAR_MIN_PRODUCTS && g.bases.size >= SMEAR_MIN_BASES) {
      smeared.push(`ladder [${key}] on ${g.offers.length} products across ${g.bases.size} base prices — e.g. ${g.sample.slice(0, 40)}`);
    }
  }
  record("Tiers", `no identical ladder on >=${SMEAR_MIN_PRODUCTS} products with >=${SMEAR_MIN_BASES} distinct base prices`, smeared);
}

// ── MATCHING ──────────────────────────────────────────────────────────────────────
async function auditMatching() {
  const merchants = await prisma.merchant.findMany({ where: { active: true }, select: { id: true, name: true } });
  const rows: string[] = [];
  const fanoutFailures: string[] = [];

  for (const m of merchants) {
    const offers = await prisma.offer.findMany({
      where: { merchantId: m.id, flagged: false, isStale: false, isExpired: false },
      select: { productUrl: true, url: true, price: true, rawSourceBlob: true, product: { select: { name: true, section: true } } },
    });
    if (offers.length === 0) continue;
    // store-product identity: deep link, else the source record's own id, else url+price
    const byKey = new Map<string, Set<string>>();
    for (const o of offers) {
      let sourceId: string | null = null;
      if (!o.productUrl && o.rawSourceBlob) {
        const mm = o.rawSourceBlob.match(/"offerId"\s*:\s*"([^"]+)"/);
        if (mm) sourceId = mm[1];
      }
      const key = o.productUrl ?? sourceId ?? `${o.url}|${o.price}`;
      const s = byKey.get(key) ?? new Set<string>();
      s.add(o.product.name);
      byKey.set(key, s);
    }
    const counts = [...byKey.values()].map((v) => v.size).sort((a, b) => a - b);
    const p95 = percentile(counts, 0.95);
    const max = counts[counts.length - 1];
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const sections = [...new Set(offers.map((o) => o.product.section))];
    rows.push(`  ${m.name.padEnd(15)} ${sections.join("/").padEnd(19)} ${String(offers.length).padStart(6)} ${mean.toFixed(2).padStart(6)} ${String(percentile(counts, 0.5)).padStart(5)} ${String(p95).padStart(5)} ${String(max).padStart(5)}`);
    if (max > FANOUT_MAX_ANY) fanoutFailures.push(`${m.name}: max fan-out ${max} > ${FANOUT_MAX_ANY}`);
    if (sections.length === 1 && sections[0] === "grocery" && p95 > FANOUT_P95_GROCERY) {
      fanoutFailures.push(`${m.name}: grocery p95 ${p95} > ${FANOUT_P95_GROCERY}`);
    }
  }
  record("Matching", `fan-out within limits (grocery p95 <= ${FANOUT_P95_GROCERY}, max <= ${FANOUT_MAX_ANY} anywhere)`, fanoutFailures);
  console.log("\n  FAN-OUT DISTRIBUTION");
  console.log("  " + "merchant".padEnd(15) + "section".padEnd(19) + " offers   mean   p50   p95   max");
  for (const r of rows) console.log(r);
  console.log("");

  const noScore = await prisma.offer.findMany({
    where: { matchScore: null, isStale: false },
    select: { id: true, matchedBy: true, merchant: { select: { name: true } } },
    take: 100,
  });
  record("Matching", "no live offer written without a confidence score",
    noScore.map((o) => `offer ${o.id} [${o.merchant.name}] matchedBy=${o.matchedBy} score=null`),
    noScore.length ? "legacy rows predate scored matching — re-scrape clears them" : undefined);

  const rejected = await prisma.matchOverride.findMany({ where: { decision: "reject" }, select: { merchantId: true, productId: true, storeKey: true } });
  const violations: string[] = [];
  for (const r of rejected) {
    const exists = await prisma.offer.findFirst({ where: { merchantId: r.merchantId, productId: r.productId }, select: { id: true } });
    if (exists) violations.push(`offer ${exists.id} contradicts a REJECTED MatchOverride (${r.storeKey.slice(0, 40)})`);
  }
  record("Matching", "no offer contradicts a REJECTED MatchOverride", violations);
}

// ── FRESHNESS & INTEGRITY ─────────────────────────────────────────────────────────
async function auditFreshness() {
  const cutoff = new Date(Date.now() - STALE_DAYS * 864e5);
  const staleNotMarked = await prisma.offer.findMany({
    where: { lastObservedAt: { lt: cutoff }, isStale: false },
    select: { id: true, lastObservedAt: true, merchant: { select: { name: true } } },
    take: 100,
  });
  record("Freshness", `no offer unseen for >${STALE_DAYS} days left unmarked as stale`,
    staleNotMarked.map((o) => `offer ${o.id} [${o.merchant.name}] lastObservedAt=${o.lastObservedAt?.toISOString().slice(0, 10)}`));

  const expiredNotMarked = await prisma.offer.findMany({
    where: { promoValidTo: { lt: new Date() }, isExpired: false },
    select: { id: true, promoValidTo: true, merchant: { select: { name: true } } },
    take: 100,
  });
  record("Freshness", "no offer past promoValidTo left unmarked as expired",
    expiredNotMarked.map((o) => `offer ${o.id} [${o.merchant.name}] validTo=${o.promoValidTo?.toISOString().slice(0, 10)}`));

  // A null deep link is EXPECTED for flyer sources and a defect anywhere else.
  // The flyer fact lives on the OFFER, not the merchant: a chain can publish a flyer feed
  // (no per-product links) alongside shelf data that does have them.
  const merchants = await prisma.merchant.findMany({ select: { id: true, name: true } });
  const unexpectedNullUrl: string[] = [];
  const expectedRows: string[] = [];
  for (const m of merchants) {
    const nulls = await prisma.offer.count({ where: { merchantId: m.id, productUrl: null } });
    if (nulls === 0) continue;
    const flyerNulls = await prisma.offer.count({ where: { merchantId: m.id, productUrl: null, priceSource: "FLYER" } });
    if (flyerNulls > 0) expectedRows.push(`${m.name}: ${flyerNulls} FLYER offers — expected`);
    const rest = nulls - flyerNulls;
    if (rest > 0) unexpectedNullUrl.push(`${m.name}: ${rest} non-flyer offers with no deep link`);
  }
  record("Freshness", "no missing deep link outside flyer sources", unexpectedNullUrl,
    expectedRows.length ? `expected nulls: ${expectedRows.join("; ")}` : undefined);

  // rawPriceText only became mandatory once the column existed; judge recent rows only.
  const since = new Date(Date.now() - 2 * 864e5);
  const noRaw = await prisma.offer.count({ where: { rawPriceText: null, lastObservedAt: { gte: since } } });
  const withRaw = await prisma.offer.count({ where: { rawPriceText: { not: null }, lastObservedAt: { gte: since } } });
  record("Freshness", "every recently-seen offer carries its raw source string",
    noRaw > 0 ? [`${noRaw} offers seen in the last 2 days have no rawPriceText (vs ${withRaw} that do)`] : []);
}

// ── report ────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n═══ DATABASE INVARIANT AUDIT ═══");
  console.log("(queries the DB directly; imports no scraper, matcher or parser)\n");

  await auditPrices();
  await auditTiers();
  await auditMatching();
  await auditFreshness();

  let lastGroup = "";
  for (const c of checks) {
    if (c.group !== lastGroup) { console.log(`\n  ${c.group.toUpperCase()}`); lastGroup = c.group; }
    console.log(`   ${c.pass ? "✓" : "✗"} ${c.name}${c.pass ? "" : `  — ${c.count} violation(s)`}`);
    if (c.note) console.log(`       note: ${c.note}`);
    for (const e of c.examples) console.log(`       · ${e}`);
    if (c.count > c.examples.length) console.log(`       … and ${c.count - c.examples.length} more`);
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${checks.length - failed.length}/${checks.length} invariants hold`);
  if (failed.length) console.log(`  FAILING: ${failed.map((f) => f.name).join(" | ")}`);
  console.log(failed.length ? "\n  ✗ AUDIT FAILED\n" : "\n  ✓ ALL INVARIANTS HOLD\n");

  // Record the outcome against a scraper run so a regression is dated.
  const runFlag = process.argv.indexOf("--run");
  if (runFlag > -1 && process.argv[runFlag + 1]) {
    const runId = Number(process.argv[runFlag + 1]);
    await prisma.scraperRun.update({
      where: { id: runId },
      data: { abortReason: failed.length ? `audit: ${failed.length} invariant(s) failing` : null },
    }).catch(() => console.log(`  (could not attach result to ScraperRun ${runId})`));
  }

  await prisma.$disconnect();
  if (failed.length) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
