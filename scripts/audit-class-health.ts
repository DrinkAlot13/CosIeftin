// IS EACH EQUIVALENCE CLASS STILL A COMPARISON TODAY? READ-ONLY.
//
// A class is not a durable fact. It is a claim that two shops both sell something interchangeable
// RIGHT NOW, and stock moves daily. `sos-salsa-branza-300g` was written with two merchants and
// dropped to one within hours of being created, because Auchan's *Sos salsa cu branza 300 g*
// aged out of the live window. Nothing announced that; the class simply stopped being a
// comparison while continuing to exist.
//
// That is the failure mode of the whole approach, so it gets its own nightly check. The
// distinction that matters:
//
//   MEMBERS         products assigned to the class (a fact about our rules)
//   LIVE MEMBERS    those with a price we would show (a fact about today)
//   MERCHANT SPAN   distinct shops among those live prices — THE number that decides whether
//                   the class is a comparison at all
//
// A class at span 0 or 1 is not broken and must not be deleted: the rule may be perfectly good
// and the shelf temporarily empty. It is REPORTED, so a comparison that quietly stopped
// existing does so loudly instead.
//
//   npm run audit:class-health
//   npm run audit:class-health -- --all      (every class, not only the 30 strict ones)

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

/** Restated rather than imported: this file grades, so it may not share the graded code. */
const MAX_DISPLAY_AGE_DAYS = 14;

async function main(): Promise<void> {
  const all = process.argv.includes("--all");
  const cutoff = new Date(Date.now() - MAX_DISPLAY_AGE_DAYS * 86_400_000);

  const classes = await prisma.equivalenceClass.findMany({
    orderBy: { slug: "asc" },
    select: {
      id: true, slug: true, label: true, attributes: true, createdAt: true,
      products: {
        select: {
          id: true, name: true,
          offers: {
            where: {
              merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
              NOT: { priceSource: "DELIVERY_PLATFORM" }, lastObservedAt: { gte: cutoff },
            },
            select: { priceBani: true, merchant: { select: { slug: true } } },
          },
        },
      },
    },
  });

  const rows = classes
    .filter((c) => {
      if (all) return true;
      try { return (JSON.parse(c.attributes ?? "{}") as { strictRules?: boolean }).strictRules === true; }
      catch { return false; }
    })
    .map((c) => {
      const liveMembers = c.products.filter((p) => p.offers.some((o) => o.priceBani != null && o.priceBani > 0));
      const shops = new Set(liveMembers.flatMap((p) => p.offers.map((o) => o.merchant.slug)));
      return {
        slug: c.slug, label: c.label,
        members: c.products.length,
        liveMembers: liveMembers.length,
        span: shops.size,
        shops: [...shops].sort(),
        // A class whose live rows all sit at ONE shop is the dangerous state: it still has
        // members, so a naive "do we have equivalents?" test says yes, and every one of them
        // is at the same shop the shopper is already looking at.
        singleShopWithMembers: shops.size === 1 && liveMembers.length >= 1,
      };
    });

  const comparable = rows.filter((r) => r.span >= 2);
  const stranded = rows.filter((r) => r.span === 1);
  const dark = rows.filter((r) => r.span === 0);

  console.log("═".repeat(100));
  console.log(`EQUIVALENCE CLASS HEALTH — ${rows.length} classes${all ? "" : " (the 30 strict ones)"}`);
  console.log("═".repeat(100));
  console.log(`  a comparison today (2+ shops)    ${comparable.length}`);
  console.log(`  stranded at ONE shop             ${stranded.length}`);
  console.log(`  no live member at all            ${dark.length}`);

  if (stranded.length) {
    console.log(`\n${"─".repeat(100)}\nSTRANDED AT ONE SHOP — the class exists, the comparison does not\n${"─".repeat(100)}`);
    for (const r of stranded) {
      console.log(`  ${r.slug.padEnd(34)} ${String(r.liveMembers).padStart(3)} live of ${String(r.members).padStart(3)} members · only ${r.shops[0]}`);
    }
  }
  if (dark.length) {
    console.log(`\n${"─".repeat(100)}\nNO LIVE MEMBER — the rule may be fine and the shelf empty; not a reason to delete\n${"─".repeat(100)}`);
    for (const r of dark) console.log(`  ${r.slug.padEnd(34)} ${String(r.members).padStart(3)} members, none priced`);
  }

  console.log(`\n${"─".repeat(100)}\nEVERY CLASS, BY SPAN\n${"─".repeat(100)}`);
  console.log(`  ${"class".padEnd(34)} ${"mem".padStart(4)} ${"live".padStart(5)} ${"span".padStart(5)}  shops`);
  for (const r of [...rows].sort((a, b) => a.span - b.span || a.slug.localeCompare(b.slug))) {
    const mark = r.span >= 2 ? " " : "!";
    console.log(`  ${mark}${r.slug.padEnd(33)} ${String(r.members).padStart(4)} ${String(r.liveMembers).padStart(5)} ${String(r.span).padStart(5)}  ${r.shops.join(" ")}`);
  }

  emitJson({
    total: rows.length,
    comparable: comparable.length,
    stranded: stranded.map((r) => ({ slug: r.slug, shop: r.shops[0], liveMembers: r.liveMembers })),
    dark: dark.map((r) => r.slug),
    classes: rows,
    pass: true, // a stranded class is INFORMATION, not a failure — the shelf is allowed to be empty
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
