// Withhold 25 offers where ONE Kaufland flyer line — a name with no variant token — matched
// onto several different catalog products. Uses the reject mechanism (MatchOverride), not a
// matcher change: this is a data decision on three specific store items, not a new rule. The
// rule itself is `docs/PLAN-COMPARABILITY.md`'s next step, graded against these as golden cases.
//
// FOUND BY `audit:fanout` going red on 2026-09-15 (worst group 12, target <= 8), the night
// Kaufland's flyer week doubled its offer count (268 -> 556).
//
//   "Nivea Gel de duş 500 ml"      14,99 lei  ->  12 different Nivea shower gels
//   "Lay's Chipsuri 170 g"          9,49 lei  ->   7 different Lay's flavours
//   "Dove Deodorant spray 150 ml"  15,99 lei  ->   6 different Dove scents
//
// None of the three flyer lines names a variant (no "Power Refresh", no "paprika", no "Apple"),
// so `decide()` has nothing on the store side to disambiguate against — every candidate that
// shares the head noun and size clears the gate. The flyer may genuinely price a whole range at
// one number; we cannot tell WHICH range from the name alone, so asserting all 12/7/6 prices is
// asserting evidence we do not have. Confirmed live: all three group's 14,99/9,49/15,99 currently
// render as "cel mai mic preț" on every one of those pages (5 of the 12 Nivea pages undercut a
// named competitor by 1,53-11,00 lei).
//
// ── THE SUBTLETY THIS SCRIPT EXISTS TO GET RIGHT.
//
// All offers in one group share the IDENTICAL storeName, hence the identical
// `slugify(storeName)`. `MatchOverride` is unique on (merchantId, storeKey) — so 12 upserts
// using the same storeKey would not create 12 rejects, they would silently collapse to ONE,
// each overwriting the last. `rejectedPairs()` (standing-decisions.ts) reads by (merchant,
// productId) regardless of storeKey content, so storeKey's exact text is free — it only needs
// to be UNIQUE per row to satisfy the constraint and to make re-running this script idempotent.
// So each row's key is `slugify(storeName)--flyer-<productId>`.
//
// Run: npx tsx scripts/withhold-flyer-fanout.ts [--apply]

import { prisma } from "../src/lib/db";
import { slugify } from "../src/lib/scrape-util";

const MERCHANT = "kaufland";

const GROUPS: { storeName: string; storePrice: string; why: string }[] = [
  {
    storeName: "Nivea Gel de duş 500 ml",
    storePrice: "14,99 lei",
    why: "flyer line names no variant (no scent, no line) — matched 12 different Nivea 500 ml shower gels; asserts a price for 11 products it has no evidence names",
  },
  {
    storeName: "Lay's Chipsuri 170 g",
    storePrice: "9,49 lei",
    why: "flyer line names no flavour — matched 7 different Lay's 170 g chip flavours (sare, paprika, cascaval, smântână și mărar)",
  },
  {
    storeName: "Dove Deodorant spray 150 ml",
    storePrice: "15,99 lei",
    why: "flyer line names no scent — matched 6 different Dove 150 ml deodorant sprays (Apple, Rodie, Original, Fresh, Invisible Dry)",
  },
];

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(`\n════ WITHHOLD FLYER FAN-OUT ${apply ? "" : "(DRY RUN)"} ═══════════════════════════════\n`);

  const merchant = await prisma.merchant.findUnique({ where: { slug: MERCHANT }, select: { id: true, name: true } });
  if (!merchant) throw new Error(`no merchant ${MERCHANT}`);

  let totalOffers = 0;
  let totalRejects = 0;

  for (const g of GROUPS) {
    const offers = await prisma.offer.findMany({
      where: { merchantId: merchant.id, storeName: g.storeName, isStale: false },
      select: { id: true, priceBani: true, price: true, flagged: true, productId: true, product: { select: { name: true } } },
      orderBy: { productId: "asc" },
    });

    console.log(`  "${g.storeName}" (${g.storePrice}) -> ${offers.length} matched product(s)`);
    console.log(`     ${g.why}`);

    if (offers.length === 0) {
      console.log(`     (nothing found — already withheld, or the flyer line changed name)\n`);
      continue;
    }

    const baseKey = slugify(g.storeName);
    for (const o of offers) {
      // UNIQUE PER PRODUCT. See the file header: the storeKey text is otherwise unread, but it
      // must not collide across the 12/7/6 rows sharing one storeName, or the upserts collapse.
      const storeKey = `${baseKey}--flyer-${o.productId}`;
      const priceStr = o.priceBani != null ? `${(o.priceBani / 100).toFixed(2)} lei` : `${o.price} lei`;
      console.log(`       offer ${String(o.id).padStart(6)}  ${priceStr.padStart(9)}  -> #${o.productId} "${o.product.name.slice(0, 50)}"  key="${storeKey}"`);
      totalOffers++;

      if (!apply) continue;

      await prisma.offer.update({
        where: { id: o.id },
        data: { flagged: true, flagReason: `flyer fan-out — ${g.why}`.slice(0, 240) },
      });
      await prisma.matchOverride.upsert({
        where: { merchantId_storeKey: { merchantId: merchant.id, storeKey } },
        update: { productId: o.productId, decision: "reject", note: g.why.slice(0, 240) },
        create: { merchantId: merchant.id, storeKey, productId: o.productId, decision: "reject", note: g.why.slice(0, 240) },
      });
      totalRejects++;
    }
    console.log();
  }

  console.log(`  ${totalOffers} offer(s) found across ${GROUPS.length} flyer lines.`);
  if (apply) {
    console.log(`  ✓ ${totalRejects} withheld and rejected. Reversible: set decision to "confirm" or delete the MatchOverride row.`);
  } else {
    console.log(`  DRY RUN — nothing written. Re-run with --apply.`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
