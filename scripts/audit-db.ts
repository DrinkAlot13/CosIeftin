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
import { GROCERY_TREE, ALL_LEAVES } from "../src/lib/category/tree";
import { emitJson } from "../src/lib/audit-json";
import { membershipOk, rulesFromAttributes } from "../src/lib/substitution/class-rules";
import { parsePrice } from "../src/lib/price/parsePrice";
import { findDisagreeingGroups, nameVerdict, baniOf, MEDIAN_DEVIATION } from "../src/lib/outlier";
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
      storeName: true, matchedBy: true,
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
      // A ZERO THAT PREDATES THE COLUMN IS NOT A FAILURE, IT IS AN ABSENCE OF DATA.
      //
      // `offersWritten` and the `aborted` derivation both landed in 533fae2 on 2026-09-02.
      // Every run recorded before that carries offersWritten = 0 by column default, so reading
      // 0 as "produced nothing" turned Penny's three perfectly good historical runs into a
      // dead-run streak and reported a live merchant as dead. Same shape as backfill-phase1
      // counting half a column and printing a green line: a default is not an observation.
      //
      // Current code CANNOT produce (aborted = false, offersWritten = 0) — recordScraperRun
      // derives aborted from exactly that condition. So the pair is the signature of a
      // pre-instrumentation row, and it is treated as unknown rather than as evidence.
      // So `aborted` alone is the signal: for any run recorded since, it is already true
      // whenever nothing was written, and for older runs it is the only field that meant
      // anything. Rows that are neither aborted nor credited with a write are dropped as
      // unknown rather than counted either way.
      const known = runs.filter((r) => r.aborted || r.offersWritten > 0);
      if (known.length < ABORT_STREAK) continue;
      const allBad = known.every((r) => r.aborted);
      if (allBad) {
        dead.push(
          `${m.slug}: last ${ABORT_STREAK} runs produced nothing ` +
          `(latest ${runs[0].startedAt.toISOString().slice(0, 16)}: ${runs[0].abortReason ?? "0 parsed"}) — ` +
          `its stored offers still look live`,
        );
      }
    }
    // ── THIS ONE IS A HISTORICAL RECORD. DO NOT TRY TO MAKE IT GREEN. ──────────────
    //
    //    It reads ScraperRun history, and Kaufland genuinely aborted twice on 2 September
    //    when the drop guard compared one week's flyer against three weeks of expired ones.
    //    That happened. The cause is fixed — the baseline now excludes offers past their
    //    promo window and Kaufland writes 296 offers — but the two aborted runs remain in the
    //    log, correctly, and this invariant will keep reporting them until they age out of
    //    the last ${ABORT_STREAK} runs on the next successful nightly.
    //
    //    Deleting the run rows to clear it would be falsifying the record of an outage to
    //    make a dashboard green. If this is still failing in a week, THAT is the signal.
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
    // ── THIS ONE IS A HISTORICAL RECORD TOO. DO NOT TRY TO MAKE IT GREEN. ─────────
    //
    //    Two days trip it: 30 August and 2 September. Both were full re-scrapes after a
    //    matcher change, and moving a lot of prices is exactly what those are for. The
    //    invariant cannot tell a mass CORRECTION from a mass CORRUPTION and should not try —
    //    the whole point is that a human looks at any day where it fires and says which it
    //    was. Both have been looked at and both are corrections: 1,652 of 1,653 prices from
    //    30 August reproduce from their own source strings.
    //
    //    It clears on its own once those days fall outside the history window. Tuning the
    //    threshold to hide them would disable the check for the next real corruption.
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
    // REPORTS THE GROUP, NOT A CULPRIT. See CLAUDE.md → "A peer-relative check flags
    // disagreement, not guilt". The old line named one offer as the outlier, which is a verdict
    // the method cannot reach: on product #2971 it named Carrefour's correct 5,79 because three
    // of the five rows were a different Dr. Oetker product and the median had moved to them.
    //
    // So every member is printed with its own store name, and the group is labelled by whether
    // those names agree — which is the discriminator that does not depend on the prices at all.
    const groups = new Map<number, { name: string; offers: typeof offers }>();
    for (const [pid, rows] of byProduct) {
      groups.set(pid, { name: rows[0]?.product.name ?? `#${pid}`, offers: rows });
    }
    const disagreeing = findDisagreeingGroups(
      new Map([...groups].map(([k, v]) => [k, { name: v.name, offers: v.offers.map((o) => ({ ...o, merchantName: o.merchant.name })) }])),
    );
    const lines: string[] = [];
    for (const g of disagreeing) {
      lines.push(`${g.productName.slice(0, 44)} — ${g.offers.length} offers, median ${lei(g.medianBani)} — ${nameVerdict(g)}`);
      for (const o of g.offers) {
        const mark = g.disagreeing.some((d) => d.id === o.id) ? "≠" : " ";
        lines.push(`      ${mark} ${(o.merchantName ?? "").padEnd(12)} ${lei(baniOf(o)).padStart(8)}  ${o.matchedBy === "ean" ? "EAN " : "    "}${(o.storeName ?? "(no store name)").slice(0, 44)}`);
      }
    }
    record("Prices", `no product's offers disagree by >${MEDIAN_DEVIATION * 100}% (a GROUP finding, not a verdict on one row)`,
      lines,
      disagreeing.length
        ? `${disagreeing.length} group(s). A peer-relative check cannot say WHICH side is wrong — resolve against an EAN, the store name, or the payload's own size before withholding anything.`
        : undefined);
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
  const weakIdentity: string[] = [];

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
    // SAY WHEN THE IDENTITY IS A GUESS. `url|price` is the last-resort key, and for a source
    // whose `url` is a category page it manufactures fan-out out of nothing but a shared price.
    // A merchant leaning on it is not measured, and the number below is not evidence about it.
    const guessed = offers.filter((o) => !o.productUrl && !/"offerId"\s*:\s*"/.test(o.rawSourceBlob ?? "")).length;
    if (guessed > 0) {
      weakIdentity.push(`${m.name}: ${guessed}/${offers.length} offers identified only by url+price`);
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
  record("Matching", `fan-out within limits (grocery p95 <= ${FANOUT_P95_GROCERY}, max <= ${FANOUT_MAX_ANY} anywhere)`, fanoutFailures,
    weakIdentity.length > 0 ? `identity fallback in use — ${weakIdentity.join("; ")}` : undefined);
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
    // A WITHHELD OFFER DOES NOT CONTRADICT A REJECTION — it is the rejection being honoured.
    //
    // The house rule is "do not delete data; withhold, flag, quarantine", so acting on a bad
    // match means flagging the row and recording a reject override, not removing it. Counting
    // the flagged row as a violation made the only compliant way to withhold a match also the
    // way to fail this invariant, which would have pushed the next person toward deleting.
    // A row that is still LIVE against a rejection is the real contradiction.
    const exists = await prisma.offer.findFirst({
      where: { merchantId: r.merchantId, productId: r.productId, flagged: false },
      select: { id: true },
    });
    if (exists) violations.push(`offer ${exists.id} is live and contradicts a REJECTED MatchOverride (${r.storeKey.slice(0, 40)})`);
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
    // USER-FACING: a link can only mislead someone who can click it, so withheld, stale and
    // out-of-stock rows are out of scope. Counting them reported 6 offers whose "La magazin"
    // was generic on pages nobody can reach.
    const nulls = await prisma.offer.count({
      where: { merchantId: m.id, productUrl: null, isStale: false, flagged: false, availability: "in stock" },
    });
    if (nulls === 0) continue;
    // A FLYER has no per-product page, and neither does a DELIVERY_PLATFORM tile: verified on
    // Glovo, a product tile has no ancestor or descendant <a> at all. Both are sources where a
    // null is the HONEST value, and the schema says so explicitly — "an absent link must be
    // visibly null rather than silently pointing at a generic page". Pointing them at the
    // category page instead is what tripped the fabrication guard at 71.7%.
    const noLinkSources = await prisma.offer.count({
      where: {
        merchantId: m.id, productUrl: null, isStale: false, flagged: false, availability: "in stock",
        priceSource: { in: ["FLYER", "DELIVERY_PLATFORM"] },
      },
    });
    if (noLinkSources > 0) expectedRows.push(`${m.name}: ${noLinkSources} FLYER/DELIVERY_PLATFORM offers — expected`);
    const rest = nulls - noLinkSources;
    if (rest > 0) unexpectedNullUrl.push(`${m.name}: ${rest} offers with no deep link from a source that publishes one`);
  }
  record("Freshness", "no missing deep link outside flyer and delivery-platform sources", unexpectedNullUrl,
    expectedRows.length ? `expected nulls: ${expectedRows.join("; ")}` : undefined);

  // rawPriceText only became mandatory once the column existed; judge recent rows only.
  const since = new Date(Date.now() - 2 * 864e5);
  // A FLAGGED offer is exempt, and the exemption is not laziness — it resolves a genuine
  // conflict between two rules in this project. `repair-flagged-provenance` NULLS
  // rawPriceText when a gate refused a price, because the string we held belonged to the
  // refused value and not to the one we kept: null is the honest answer to "what produced
  // this price" once we no longer know. This invariant then flagged exactly those rows for
  // lacking what the repair deliberately removed. Both rules are right; the scope was wrong.
  const noRaw = await prisma.offer.count({
    where: { rawPriceText: null, flagged: false, lastObservedAt: { gte: since } },
  });
  const withRaw = await prisma.offer.count({ where: { rawPriceText: { not: null }, flagged: false, lastObservedAt: { gte: since } } });
  record("Freshness", "every recently-seen offer carries its raw source string",
    noRaw > 0 ? [`${noRaw} offers seen in the last 2 days have no rawPriceText (vs ${withRaw} that do)`] : []);
}

/**
 * Every product assigned to an equivalence class must still satisfy that class's own
 * membership rules.
 *
 * `propose:equivalence` writes these assignments, and CLAUDE.md forbids a backfill from
 * verifying its own work — so the check lives here and re-derives membership from the class's
 * stored `attributes`, not from anything the proposer computed. A wrong class is worse than no
 * class: the resolver then offers a substitute that is not equivalent, and the shopper finds out
 * at the till. The proposer's first run wanted to file "Brânză de burduf" as telemea, "Cartofi
 * pai" as potatoes and "Slănină de porc" as pork.
 */
async function auditEquivalence() {
  const classes = await prisma.equivalenceClass.findMany({
    select: { id: true, slug: true, unit: true, unitSize: true, attributes: true },
  });
  const byId = new Map(classes.map((c) => [c.id, c]));
  const assigned = await prisma.product.findMany({
    where: { equivalenceClassId: { not: null } },
    select: { id: true, name: true, unit: true, unitSize: true, equivalenceClassId: true },
  });

  const violations: string[] = [];
  const wrongUnit: string[] = [];
  for (const p of assigned) {
    const c = byId.get(p.equivalenceClassId!);
    if (!c) { violations.push(`product ${p.id} points at a class that does not exist`); continue; }
    const m = membershipOk(p.name, rulesFromAttributes(c.attributes));
    if (!m.ok) violations.push(`${c.slug}: "${p.name.slice(0, 52)}" — ${m.failed}`);
    if (p.unit !== c.unit) wrongUnit.push(`${c.slug}: "${p.name.slice(0, 44)}" is ${p.unit}, class is ${c.unit}`);
  }
  record("Substitution", "every classified product satisfies its class's membership rules", violations);
  record("Substitution", "no product is classified into a class with a different unit", wrongUnit);

  // A class nobody can substitute within is not doing its job. Not a failure — a single-merchant
  // class is honest when only one shop stocks the need — but it is reported so the gap is visible.
  const singles: string[] = [];
  for (const c of classes) {
    const shops = await prisma.offer.groupBy({
      by: ["merchantId"],
      where: { product: { equivalenceClassId: c.id }, isStale: false, flagged: false, availability: "in stock", merchant: { active: true } },
    });
    if (shops.length === 1) singles.push(`${c.slug} exists at exactly one merchant`);
  }
  record("Substitution", "no equivalence class is stranded at a single merchant", [], singles.length ? `${singles.length} class(es): ${singles.slice(0, 6).map((s) => s.split(" ")[0]).join(", ")}` : undefined);
}

/**
 * Delivery-platform prices must be written as DELIVERY_PLATFORM, and must not be reachable as
 * ordinary prices.
 *
 * Checked from OUTSIDE the writer, because the writer got this wrong: `matchPoolToCatalog`
 * passed the offer's own value through the merchant-vocabulary translator, which has no case for
 * it, so 2,217 Glovo offers were written as SHELF. Every exclusion keyed on DELIVERY_PLATFORM
 * therefore passed them through, and a marked-up platform price was competing against shelf
 * prices. Nothing in the write path noticed; only a query that does not share its vocabulary can.
 */
async function auditDeliveryPlatform() {
  const aggregators = await prisma.merchant.findMany({
    where: { priceChannel: "aggregator" },
    select: { id: true, slug: true },
  });
  if (aggregators.length === 0) {
    record("Delivery platform", "every aggregator merchant's offers are DELIVERY_PLATFORM", []);
    return;
  }
  const ids = aggregators.map((a) => a.id);
  const wrong = await prisma.offer.findMany({
    where: { merchantId: { in: ids }, NOT: { priceSource: "DELIVERY_PLATFORM" } },
    select: { id: true, priceSource: true, merchant: { select: { slug: true } }, product: { select: { name: true } } },
    take: 20,
  });
  const wrongCount = await prisma.offer.count({
    where: { merchantId: { in: ids }, NOT: { priceSource: "DELIVERY_PLATFORM" } },
  });
  record(
    "Delivery platform",
    "every aggregator merchant's offers are written as DELIVERY_PLATFORM",
    wrong.map((o) => `offer ${o.id} [${o.merchant.slug}] is ${o.priceSource} — ${o.product.name.slice(0, 42)}`),
    wrongCount > wrong.length ? `${wrongCount} total` : undefined,
  );

  // And the converse: nothing outside an aggregator merchant should claim to be one.
  const strays = await prisma.offer.count({
    where: { priceSource: "DELIVERY_PLATFORM", merchantId: { notIn: ids } },
  });
  record("Delivery platform", "no non-aggregator merchant writes a DELIVERY_PLATFORM price",
    strays > 0 ? [`${strays} offer(s) claim DELIVERY_PLATFORM from a merchant that is not an aggregator`] : []);

  const total = await prisma.offer.count({ where: { merchantId: { in: ids } } });
  record("Delivery platform", "aggregator offers exist and are counted", [],
    `${total} offer(s) across ${aggregators.length} aggregator merchant(s): ${aggregators.map((a) => a.slug).join(", ")} — excluded from display by default`);
}

/**
 * A scraper that STOPS supplying the merchant's own category must be loud.
 *
 * Three scrapers iterated a category list to find products and dropped the category before the
 * write, so the catalog spent months inferring from a product name a fact the merchant had
 * already stated. Now that they persist it, the failure mode inverts: a selector change or a
 * refactor quietly stops setting it, coverage decays, and nothing says a word — the products
 * still have prices and the tree still looks populated.
 *
 * Checked WITHOUT a hardcoded list of who ought to supply one, because such a list is exactly
 * what nobody updates. The evidence is the merchant's own history: if its older offers carry a
 * path and the ones written in the last day and a half carry none, the scraper regressed.
 */
async function auditCategoryPathRegression() {
  const cutoff = new Date(Date.now() - 36 * 3600_000);
  const merchants = await prisma.merchant.findMany({ where: { active: true }, select: { id: true, name: true } });
  const regressed: string[] = [];
  const rows: string[] = [];
  for (const m of merchants) {
    const [total, withPath, recent, recentWith] = await Promise.all([
      prisma.offer.count({ where: { merchantId: m.id } }),
      prisma.offer.count({ where: { merchantId: m.id, categoryPath: { not: null } } }),
      prisma.offer.count({ where: { merchantId: m.id, lastObservedAt: { gte: cutoff } } }),
      prisma.offer.count({ where: { merchantId: m.id, lastObservedAt: { gte: cutoff }, categoryPath: { not: null } } }),
    ]);
    if (total === 0) continue;
    const overall = (withPath / total) * 100;
    if (withPath > 0) rows.push(`${m.name}: ${overall.toFixed(0)}% of offers carry a merchant category`);
    // Only a merchant that HAS supplied paths can regress; one that never did is not a failure,
    // it is a source that publishes nothing, which is recorded elsewhere as a gap.
    if (withPath >= 50 && recent >= 50 && recentWith === 0) {
      regressed.push(`${m.name}: ${withPath} offers carry a category, but 0 of ${recent} written since ${cutoff.toISOString().slice(0, 16)} do`);
    }
  }
  record("Categories", "no merchant silently stopped supplying its own category", regressed,
    rows.length ? rows.join("; ") : undefined);
}

/**
 * The tree in CODE and the tree in the DATABASE must be the same tree.
 *
 * They were not: GROCERY_TREE declared 12 grocery departments and the database held 15. The
 * extra three — `lactate`, `legume-fructe`, `menaj` — are legacy rows superseded by renamed
 * departments, with no children and no products. Nothing was wrong with any product, so no
 * existing invariant had any reason to fire; the mismatch would simply have appeared as three
 * empty departments in a sidebar built from the database, and the first person to notice would
 * have been a shopper.
 *
 * Deliberately compares COUNTS AND SLUGS in both directions. A count check alone passes the
 * moment someone adds a thirteenth department while a legacy row still sits there.
 */
async function auditUnplacedPile() {
  // ── THE NEÎNCADRATE LEAF. Products the assigner looked at and could not place.
  //
  // They used to sit at `categoryId IS NULL`, invisible on every category page and reachable
  // only through a link outside the tree. They are now on a leaf so a shopper can browse them —
  // and the moment that happened, `categoryId IS NULL` stopped meaning "unclassified" and
  // started meaning "the assigner has not seen this row yet". Two different facts; conflating
  // them would make the tail invisible in the tooling built to watch it shrink.
  const leaf = await prisma.category.findUnique({ where: { slug: "neincadrate-produse" }, select: { id: true, parentId: true } });
  record("Categories", "the Neîncadrate leaf exists and hangs off its department",
    leaf == null ? ["neincadrate-produse is missing — run `npm run assign:categories -- --apply`"]
      : leaf.parentId == null ? ["neincadrate-produse is parentless; a department is not a place a product belongs"] : []);
  if (!leaf) return;

  // A product on the DEPARTMENT rather than the leaf would be counted by the department page and
  // by nothing in the sidebar, so the two would disagree — the count-matches-list rule again.
  const onDept = await prisma.product.count({ where: { categoryId: leaf.parentId! } });
  record("Categories", "no product sits on the Neîncadrate department instead of its leaf",
    onDept > 0 ? [`${onDept} product(s) sit on the department`] : []);

  // After a sweep nothing should be left at NULL. A non-zero count here is not necessarily a
  // fault — products created since the last assigner run legitimately have none — so this
  // REPORTS rather than fails, and names the reason.
  const stillNull = await prisma.product.count({ where: { section: "grocery", categoryId: null } });
  const unplaced = await prisma.product.count({ where: { categoryId: leaf.id } });
  record("Categories", "the unplaced tail is measurable", [],
    `${unplaced} products on the Neîncadrate leaf; ${stillNull} grocery products never assigned (new since the last assigner run). The first number is the one that must fall.`);
}

async function auditTreeMatchesDatabase() {
  const inCode = new Set(GROCERY_TREE.map((d) => d.slug));
  const dbDepts = await prisma.category.findMany({
    where: { section: "grocery", parentId: null },
    select: { slug: true, name: true },
  });
  const inDb = new Set(dbDepts.map((d) => d.slug));
  const extra = [...inDb].filter((s) => !inCode.has(s));
  const missing = [...inCode].filter((s) => !inDb.has(s));
  const problems = [
    ...extra.map((s) => `database has department "${s}" that GROCERY_TREE does not declare`),
    ...missing.map((s) => `GROCERY_TREE declares "${s}" but the database has no such department`),
  ];
  record("Categories", "the grocery tree in code and in the database are the same tree", problems,
    `code ${inCode.size} departments, database ${inDb.size}`);

  // A leaf in the database that the code no longer declares will render and can never be filled.
  const codeLeaves = new Set(ALL_LEAVES.map((l) => l.slug));
  const dbLeaves = await prisma.category.findMany({
    where: { section: "grocery", NOT: { parentId: null } },
    select: { slug: true },
  });
  const strayLeaves = dbLeaves.map((l) => l.slug).filter((s) => !codeLeaves.has(s));
  record("Categories", "no leaf exists in the database that the code does not declare",
    strayLeaves.map((s) => `database leaf "${s}" is not in GROCERY_TREE — it can never be filled`));
}

/**
 * A productUrl must point at a PRODUCT.
 *
 * Carrefour's tile markup can lead with a campaign badge, and `querySelector('a[href]')` takes
 * whichever anchor comes first — so 20 offers pointed at /campanii/reduceri-de-gama, 8 at a PDF
 * of promo regulations and 4 at an ad-tracking redirect. Non-products in the catalog, all
 * sharing one link, which also read as an 18-way matcher fan-out because the fan-out audit
 * identifies a store product BY its link.
 *
 * Checked by SHAPE rather than by a list of bad hosts: a PDF is never a product anywhere, and
 * neither is a site root. A merchant that starts doing this tomorrow is caught the same night.
 */
async function auditProductUrlsAreProducts() {
  const rows = await prisma.offer.findMany({
    where: { productUrl: { not: null }, flagged: false, isStale: false },
    select: { id: true, productUrl: true, merchant: { select: { name: true } } },
  });
  const shapes: { why: string; test: (u: string) => boolean }[] = [
    { why: "a PDF or document", test: (u) => /\.(pdf|docx?|xlsx?)(\?|$)/i.test(u) },
    { why: "a campaign or promo landing page", test: (u) => /\/(campanii|campaigns?|promotii|reduceri)\b/i.test(u) },
    { why: "an ad or tracking redirect", test: (u) => /(footprints-ai|\/campaigns-smart\/|doubleclick|adservice)/i.test(u) },
    { why: "a corporate or legal page", test: (u) => /\/(corporate|regulations|termeni|politica)\b/i.test(u) },
    { why: "the site root", test: (u) => { try { return new URL(u).pathname.replace(/\/+$/, "") === ""; } catch { return false; } } },
  ];
  const bad: string[] = [];
  for (const r of rows) {
    const hit = shapes.find((sh) => sh.test(r.productUrl ?? ""));
    if (hit) bad.push(`offer ${r.id} [${r.merchant.name}] ${hit.why}: ${(r.productUrl ?? "").slice(0, 64)}`);
  }
  record("Freshness", "every live productUrl points at a product page, not a banner or a PDF", bad);
}

/**
 * Derived data must not outlive what it was derived from.
 *
 * A bulk tier is computed against an offer's price. When the offer is re-scraped to a new price
 * the ladder is left where it is, and a rung then sits at or above a base it no longer belongs
 * to — 61 DCNeu rows read "tier 2+ 15.46 >= base 2.94". And a tier on a WITHHELD offer is a
 * discount on a price nobody may see. Both are cleared by `standing-decisions`; this is the
 * check that says so from outside it.
 */
async function auditDerivedDataIsFresh() {
  const onWithheld = await prisma.offer.count({ where: { flagged: true, tiers: { some: {} } } });
  record("Tiers", "no bulk tier survives on a withheld offer",
    onWithheld > 0 ? [`${onWithheld} withheld offer(s) still carry bulk tiers`] : []);

  // ── PRECOMPUTED SHELF SIGNALS (Product.dropPct / spreadPct / dealScore / liveOfferCount).
  //
  // These back /oferte and the homepage's drop shelf, and they are written by
  // `npm run compute:home` at the end of the nightly. compute:home may not verify its own work
  // — a script that reports its own success is reporting that it agrees with itself — so the
  // invariants live here, in a file that imports nothing but PrismaClient.
  //
  // The one that matters most is the LAST: a product with no live offer must have these
  // CLEARED. A stale 40% spread on something nobody sells any more is exactly this project's
  // recurring defect, a value read as an observation when nothing was observed.

  const negative = await prisma.product.count({
    where: { OR: [{ spreadPct: { lt: 0 } }, { dropPct: { lt: 0 } }, { dealScore: { lt: 0 } }, { liveOfferCount: { lt: 0 } }] },
  });
  record("Derived", "no precomputed shelf signal is negative",
    negative > 0 ? [`${negative} product(s) carry a negative dropPct/spreadPct/dealScore/liveOfferCount`] : []);

  const over100 = await prisma.product.count({ where: { OR: [{ spreadPct: { gt: 100 } }, { dropPct: { gt: 100 } }] } });
  record("Derived", "no spread or drop exceeds 100%",
    over100 > 0 ? [`${over100} product(s) claim a spread or drop over 100%`] : []);

  // dealScore is max(spreadPct, dropPct) by construction. If it is ever LESS than either, the
  // column has drifted from the thing it summarises and /oferte is sorting by a stale number.
  const drifted = await prisma.$queryRawUnsafe<{ c: bigint | number }[]>(
    `SELECT COUNT(*) AS c FROM Product
      WHERE dealScore IS NOT NULL
        AND dealScore < MAX(COALESCE(spreadPct, 0), COALESCE(dropPct, 0)) - 0.001`,
  );
  const driftCount = Number(drifted[0]?.c ?? 0);
  record("Derived", "dealScore equals max(spreadPct, dropPct)",
    driftCount > 0 ? [`${driftCount} product(s) have a dealScore below the columns it summarises`] : []);

  // A spread needs two prices to be a spread.
  const spreadWithoutPeers = await prisma.product.count({
    where: { spreadPct: { gt: 0 }, liveOfferCount: { lt: 2 } },
  });
  record("Derived", "no product claims a between-store spread with under two live offers",
    spreadWithoutPeers > 0
      ? [`${spreadWithoutPeers} product(s) carry a spread while fewer than two shops price them`]
      : []);

  // THE ONE THAT MATTERS. Signals must be cleared when the product loses its last live offer.
  // Scoped to the section compute:home computes, and only to rows it could have written —
  // `dropComputedAt IS NOT NULL` — because a row never touched by the job is UNKNOWN, not zero.
  const stalePositive = await prisma.product.findMany({
    where: {
      section: "grocery",
      dropComputedAt: { not: null },
      liveOfferCount: { gte: 1 },
      offers: { none: { isStale: false, merchant: { active: true } } },
    },
    select: { id: true, name: true, liveOfferCount: true },
    take: 20,
  });
  record("Derived", "a product with no live offer carries no live-offer count",
    stalePositive.map((p) => `#${p.id} ${p.name.slice(0, 44)} claims ${p.liveOfferCount} live offer(s) and has none`),
    "cleared by the sweep at the end of compute:home; a stale signal here is the recurring 'default read as an observation' shape");
}

// ── report ────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n═══ DATABASE INVARIANT AUDIT ═══");
  console.log("(queries the DB directly; imports no scraper, matcher or parser)\n");

  await auditPrices();
  await auditTiers();
  await auditMatching();
  await auditFreshness();
  await auditEquivalence();
  await auditDeliveryPlatform();
  await auditCategoryPathRegression();
  await auditTreeMatchesDatabase();
  await auditUnplacedPile();
  await auditProductUrlsAreProducts();
  await auditDerivedDataIsFresh();

  let lastGroup = "";
  for (const c of checks) {
    if (c.group !== lastGroup) { console.log(`\n  ${c.group.toUpperCase()}`); lastGroup = c.group; }
    console.log(`   ${c.pass ? "✓" : "✗"} ${c.name}${c.pass ? "" : `  — ${c.count} violation(s)`}`);
    if (c.note) console.log(`       note: ${c.note}`);
    for (const e of c.examples) console.log(`       · ${e}`);
    if (c.count > c.examples.length) console.log(`       … and ${c.count - c.examples.length} more`);
  }

  const failed = checks.filter((c) => !c.pass);

  // Every invariant by name, green or red, for the soak log. Names, not indices: the list
  // grows, and a soak that compared position 14 across a fortnight would silently start
  // comparing two different checks the day one was inserted above it.
  emitJson({
    total: checks.length,
    passing: checks.length - failed.length,
    failing: failed.length,
    invariants: checks.map((c) => ({ name: c.name, group: c.group, pass: c.pass, count: c.count })),
  });

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
