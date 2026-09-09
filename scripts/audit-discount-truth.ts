// ── CAN /reduceri-reale BE PUBLISHED AT ALL? READ-ONLY. THE NUMBER DECIDES.
//
// The page makes a claim about a NAMED RETAILER's pricing. That is the one output in this
// project with real consequences if it is wrong, so it gets the one check that can refuse it:
// **the rate at which the retailer's own sworn 30-day figure agrees with the 30-day floor we
// observed independently.** Two sources, no shared assumption. If they agree, our history is
// good enough to speak from. If they disagree, it is not, and no amount of careful copy fixes
// that.
//
// ── THIS AUDIT IS ALLOWED TO RETURN "I CANNOT TELL", AND TODAY IT DOES.
//
// `audit:rate-limit` reported "NO LIMIT FIRED" on its first run and the limiter was fine — the
// audit had never reached the threshold. CLAUDE.md's rule from that day: an oracle that cannot
// reach its threshold must say INCONCLUSIVE, which is neither a pass nor a failure. The same
// applies here. An agreement rate over zero comparisons is not 100% and it is not 0%; it is a
// rate that does not exist, and printing one would be the project's most-repeated defect —
// a value never observed, read as an observation.
//
// ── WHAT ELSE IT REPORTS, because "not publishable" is useless without "why not".
//
//   1. BASELINE AVAILABILITY  per merchant: whose number could we even cite?
//   2. THE CROSS-CHECK        the agreement rate, or INCONCLUSIVE with the reason
//   3. WHAT THE PAGE WOULD SAY  the verdict distribution over every live offer
//   4. THE REVIEW QUEUE       rows a human must see before anything renders
//
//   npm run audit:discount-truth
//   npm run audit:discount-truth -- --json logs/discount-truth.json

import { PrismaClient } from "@prisma/client";
import { verifyDiscount, MIN_COVERAGE_DAYS, type DiscountVerdict, type HistoryPoint } from "../src/lib/discount-verify";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

const WINDOW_DAYS = 30;
const MAX_AGE = 14 * 86_400_000;
/** Beyond this, the retailer's figure and ours are telling different stories. */
const AGREEMENT_TOLERANCE_BP = 500; // 5%

const lp = (s: string | number, n: number) => String(s).padStart(n);
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lei = (b: number) => (b / 100).toFixed(2).replace(".", ",");

type Live = {
  id: number; merchant: string; product: string; storeName: string | null;
  currentBani: number; advertisedWasBani: number | null; omnibus30dBani: number | null;
  loyaltyPriceBani: number | null;
  history: HistoryPoint[];
};

async function main(): Promise<void> {
  const now = new Date();
  const cutoff = new Date(Date.now() - MAX_AGE);
  const histFrom = new Date(Date.now() - (WINDOW_DAYS + 120) * 864e5);

  const offers = await prisma.offer.findMany({
    where: { merchant: { active: true }, isStale: false, flagged: false, availability: "in stock", lastObservedAt: { gte: cutoff } },
    select: {
      id: true, priceBani: true, price: true, oldPriceBani: true, oldPrice: true,
      referencePriceBani: true, referencePriceKind: true, storeName: true, loyaltyPriceBani: true,
      merchant: { select: { slug: true } },
      product: { select: { name: true } },
      history: { where: { recordedAt: { gte: histFrom } }, select: { priceBani: true, price: true, recordedAt: true } },
    },
  });

  const live: Live[] = offers.map((o) => ({
    id: o.id,
    merchant: o.merchant.slug,
    product: o.product.name,
    storeName: o.storeName,
    currentBani: o.priceBani ?? Math.round(o.price * 100),
    // A struck price the SCRAPER stored. `referencePriceKind` distinguishes the two kinds;
    // only OMNIBUS_30D is the retailer's sworn 30-day figure.
    advertisedWasBani:
      o.oldPriceBani ?? (o.oldPrice != null ? Math.round(o.oldPrice * 100) : null) ??
      (o.referencePriceKind === "STRIKETHROUGH" ? o.referencePriceBani : null),
    omnibus30dBani: o.referencePriceKind === "OMNIBUS_30D" ? o.referencePriceBani : null,
    loyaltyPriceBani: o.loyaltyPriceBani,
    history: o.history.map((h) => ({ priceBani: h.priceBani ?? Math.round(h.price * 100), recordedAt: h.recordedAt })),
  }));

  console.log("═".repeat(104));
  console.log("CAN /reduceri-reale BE PUBLISHED? — the agreement rate between the retailer's figure and ours");
  console.log(`${live.length} live offers · window ${WINDOW_DAYS}d · our floor counts only after ${MIN_COVERAGE_DAYS}d of watching`);
  console.log("═".repeat(104));

  const evidence = live.map((l) => ({ l, e: verifyDiscount({ ...l, now }) }));

  // ── 1. BASELINE AVAILABILITY ─────────────────────────────────────────────────────────────
  const slugs = [...new Set(live.map((l) => l.merchant))].sort();
  console.log(`\n  1. WHOSE NUMBER COULD WE CITE?\n`);
  console.log(`  ${pad("merchant", 16)}${lp("live", 7)}${lp("omnibus", 9)}${lp("struck", 8)}${lp("ourFloor", 10)}${lp("neither", 9)}`);
  console.log("  " + "─".repeat(60));
  for (const s of slugs) {
    const rs = evidence.filter((x) => x.l.merchant === s);
    const omni = rs.filter((x) => x.l.omnibus30dBani != null).length;
    const struck = rs.filter((x) => x.l.advertisedWasBani != null).length;
    const ours = rs.filter((x) => x.e.baselineSource === "OUR_HISTORY").length;
    const none = rs.filter((x) => x.e.baselineSource === "NONE").length;
    console.log(`  ${pad(s, 16)}${lp(rs.length, 7)}${lp(omni, 9)}${lp(struck, 8)}${lp(ours, 10)}${lp(none, 9)}`);
  }

  // ── 2. THE CROSS-CHECK ───────────────────────────────────────────────────────────────────
  const comparable = evidence.filter((x) => x.l.omnibus30dBani != null && x.e.baselineSource !== "NONE" && x.e.ourMin30dBani != null);
  console.log(`\n${"─".repeat(104)}`);
  console.log(`  2. THE CROSS-CHECK — retailer's sworn 30-day minimum vs the floor we observed\n`);

  let agreementRate: number | null = null;
  if (comparable.length === 0) {
    const why = live.filter((l) => l.omnibus30dBani != null).length === 0
      ? "we hold ZERO retailer 30-day figures"
      : "no offer has both a retailer figure and enough of our own coverage";
    console.log(`     INCONCLUSIVE — ${why}, so there are 0 comparisons to rate.`);
    console.log(`     An agreement rate over zero comparisons is not 100% and not 0%. It does not exist.`);
    console.log(`     Run \`npm run probe:omnibus\` to see which merchants publish the figure on the page.`);
  } else {
    const agree = comparable.filter((x) => {
      const a = x.l.omnibus30dBani as number;
      const b = x.e.ourMin30dBani as number;
      return Math.abs(a - b) <= (b * AGREEMENT_TOLERANCE_BP) / 10000;
    });
    agreementRate = agree.length / comparable.length;
    console.log(`     ${agree.length} / ${comparable.length} agree within ${AGREEMENT_TOLERANCE_BP / 100}%   =  ${(agreementRate * 100).toFixed(1)}%\n`);
    console.log(`  ${pad("merchant", 16)}${lp("cmp", 6)}${lp("agree", 7)}${lp("rate", 8)}`);
    console.log("  " + "─".repeat(37));
    for (const s of slugs) {
      const rs = comparable.filter((x) => x.l.merchant === s);
      if (rs.length === 0) continue;
      const ok = rs.filter((x) => Math.abs((x.l.omnibus30dBani as number) - (x.e.ourMin30dBani as number)) <= ((x.e.ourMin30dBani as number) * AGREEMENT_TOLERANCE_BP) / 10000).length;
      console.log(`  ${pad(s, 16)}${lp(rs.length, 6)}${lp(ok, 7)}${lp(`${((ok / rs.length) * 100).toFixed(0)}%`, 8)}`);
    }
    const disagree = comparable.filter((x) => !agree.includes(x)).slice(0, 15);
    if (disagree.length > 0) {
      console.log(`\n     EVERY DISAGREEMENT, both figures, so a person can see which is wrong:`);
      for (const { l, e } of disagree) {
        console.log(`       ${pad(l.merchant, 14)} #${l.id}  they ${lei(l.omnibus30dBani as number)}  we ${lei(e.ourMin30dBani as number)}  (${e.coverageDays}d watched, ${e.ourObservations} pts)`);
        console.log(`         ${l.product.slice(0, 76)}`);
      }
    }

    // ── WHICH PRICE SERIES IS THE RETAILER'S FIGURE EVEN ON?
    //
    // A merchant that quotes two prices has two price HISTORIES, and its 30-day minimum is a
    // minimum over one of them. Comparing it to the other produces a disagreement rate that
    // measures nothing but our choice of series.
    //
    // Penny's LAMÂI is the case that raised it: shelf 8,99 · card 5,99 · their 30-day minimum
    // 6,99 — which is neither, and is EXACTLY the card price we recorded on 30 August. So this
    // counts how often their figure matches the shelf line versus the loyalty line, and lets
    // the data answer it rather than an argument.
    const withLoyalty = comparable.filter((x) => x.l.loyaltyPriceBani != null);
    if (withLoyalty.length > 0) {
      const near = (a: number, b: number) => Math.abs(a - b) <= (b * AGREEMENT_TOLERANCE_BP) / 10000;
      const vsShelf = withLoyalty.filter((x) => near(x.l.omnibus30dBani as number, x.l.currentBani)).length;
      const vsLoyalty = withLoyalty.filter((x) => near(x.l.omnibus30dBani as number, x.l.loyaltyPriceBani as number)).length;
      console.log(`\n     WHICH SERIES IS THEIR 30-DAY FIGURE ON? (${withLoyalty.length} offers quoting two prices)`);
      console.log(`       matches today's SHELF price:    ${vsShelf}`);
      console.log(`       matches today's LOYALTY price:  ${vsLoyalty}`);
      console.log(`       matches neither (a past price): ${withLoyalty.length - vsShelf - vsLoyalty}`);
      console.log(`     A figure sitting on the loyalty line may not be compared against a shelf-price`);
      console.log(`     floor, and no wording on the page repairs that — it is the wrong subtraction.`);
    }

    // ── IS OUR OWN FLOOR ON ONE BASIS? Until today Penny's `price` held the CARD price, and
    // before that the per-unit price. A floor taken across that mixture is a minimum over three
    // different things, which is why the rate above is not yet evidence about anything.
    const mixed = comparable.filter((x) => {
      const pts = x.l.history.map((h) => h.priceBani);
      return x.l.loyaltyPriceBani != null && pts.some((p) => Math.abs(p - (x.l.loyaltyPriceBani as number)) < 2);
    }).length;
    if (mixed > 0) {
      console.log(`\n     ⚠ ${mixed} of ${comparable.length} floors include an observation equal to today's LOYALTY`);
      console.log(`       price, so our history is not on a single pricing basis. The rate above is`);
      console.log(`       not yet evidence; it becomes evidence once the mixed points age out.`);
    }
  }

  // ── 3. WHAT THE PAGE WOULD SAY ───────────────────────────────────────────────────────────
  console.log(`\n${"─".repeat(104)}`);
  console.log(`  3. WHAT THE PAGE WOULD SAY TODAY, per merchant\n`);
  const verdicts: DiscountVerdict[] = ["REDUCERE_REALA", "REDUCERE_MICA", "FARA_REDUCERE", "NECUNOSCUT"];
  console.log(`  ${pad("merchant", 16)}${lp("REALA", 8)}${lp("MICA", 7)}${lp("FARA", 7)}${lp("NECUN.", 9)}${lp("review", 8)}`);
  console.log("  " + "─".repeat(55));
  for (const s of slugs) {
    const rs = evidence.filter((x) => x.l.merchant === s);
    const c = (v: DiscountVerdict) => rs.filter((x) => x.e.verdict === v).length;
    const rev = rs.filter((x) => x.e.needsReview).length;
    console.log(`  ${pad(s, 16)}${lp(c("REDUCERE_REALA"), 8)}${lp(c("REDUCERE_MICA"), 7)}${lp(c("FARA_REDUCERE"), 7)}${lp(c("NECUNOSCUT"), 9)}${lp(rev, 8)}`);
  }
  const totals = Object.fromEntries(verdicts.map((v) => [v, evidence.filter((x) => x.e.verdict === v).length]));
  const publishable = evidence.filter((x) => x.e.verdict !== "NECUNOSCUT" && !x.e.needsReview);
  console.log(`\n     ${publishable.length} of ${live.length} offers would carry a verdict a shopper could read.`);

  // ── 4. THE REVIEW QUEUE ──────────────────────────────────────────────────────────────────
  const queue = evidence.filter((x) => x.e.needsReview);
  console.log(`\n${"─".repeat(104)}`);
  console.log(`  4. WITHHELD PENDING REVIEW — ${queue.length} rows. None of these may render.\n`);
  for (const { l, e } of queue.slice(0, 20)) {
    const reason = e.advertisedWasIsIncoherent
      ? `"was" ${lei(l.advertisedWasBani as number)} is not above now ${lei(l.currentBani)}`
      : `they say ${lei(l.omnibus30dBani as number)}, we observed ${lei(e.ourMin30dBani as number)}`;
    console.log(`     ${pad(l.merchant, 14)} #${l.id}  ${reason}`);
    console.log(`       ${l.product.slice(0, 76)}`);
  }
  if (queue.length > 20) console.log(`     … and ${queue.length - 20} more.`);

  // ── THE VERDICT ON THE FEATURE ITSELF ────────────────────────────────────────────────────
  const oldest = live.flatMap((l) => l.history.map((h) => h.recordedAt.getTime())).sort((a, b) => a - b)[0];
  const historyDays = oldest ? (Date.now() - oldest) / 864e5 : 0;

  console.log(`\n${"═".repeat(104)}`);
  console.log(`  VERDICT ON THE FEATURE`);
  console.log(`${"═".repeat(104)}`);
  console.log(`     our oldest observation anywhere:  ${historyDays.toFixed(0)} days ago`);
  console.log(`     retailer 30-day figures held:     ${live.filter((l) => l.omnibus30dBani != null).length}`);
  console.log(`     cross-check comparisons possible: ${comparable.length}`);
  const publishableFeature = agreementRate != null && agreementRate >= 0.9 && historyDays >= WINDOW_DAYS;
  console.log(`\n     PUBLISHABLE: ${publishableFeature ? "YES" : "NO"}`);
  if (!publishableFeature) {
    if (agreementRate == null) console.log(`       · the cross-check is INCONCLUSIVE — nothing to check ours against`);
    else if (agreementRate < 0.9) console.log(`       · the two sources agree only ${(agreementRate * 100).toFixed(1)}% of the time`);
    if (historyDays < WINDOW_DAYS) console.log(`       · our history is ${historyDays.toFixed(0)} days deep; a "30 de zile" claim needs 30`);
  }
  console.log("═".repeat(104));

  emitJson({
    pass: true, live: live.length, historyDays: Number(historyDays.toFixed(1)),
    omnibusHeld: live.filter((l) => l.omnibus30dBani != null).length,
    comparisons: comparable.length, agreementRate,
    verdicts: totals, publishableOffers: publishable.length,
    reviewQueue: queue.length, publishableFeature,
  });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
