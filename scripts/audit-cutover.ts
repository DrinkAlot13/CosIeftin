// THE POSTGRES CUTOVER CHECKLIST — as a program, not a document.
//
// Every rule below is one this project relies on and the local database cannot refuse. A
// document listing them would be read once and rot; this runs, so the day the list is wrong
// it says so. Run it before the cutover to prove the data is ready, and after to prove the
// constraint actually took.
//
// WHY SQLITE CANNOT REFUSE THEM — three separate reasons, kept apart because they have
// different fixes:
//
//   (a) Prisma will not emit enums on SQLite ("the current connector does not support enums"),
//       so every enum-shaped column is a String and any spelling is accepted. This is the one
//       that already cost us: Offer.priceSource held five spellings of a four-value field and
//       two live read sites compared against a string literal.
//   (b) Prisma cannot express CHECK constraints in the schema on ANY connector. On Postgres we
//       get them by hand-editing the generated migration SQL; on SQLite, `db push` writes no
//       migration file to edit, so there is nowhere to put them.
//   (c) A NOT NULL that depends on another column is not a column property at all. It is a
//       CHECK, so it lands in (b).
//
// Foreign keys are NOT on this list. `PRAGMA foreign_keys` reads 1 here and the orphan counts
// below are all zero — SQLite is enforcing referential integrity today. Writing "FKs skipped"
// into a checklist from memory would have been wrong, which is the argument for this file.
//
// Read-only. Run: npm run audit:cutover

import { PrismaClient } from "@prisma/client";
import { PRICE_SOURCES } from "../src/lib/price-source";

const prisma = new PrismaClient();

type Rule = {
  /** The constraint we want the database to enforce, as it will read in Postgres. */
  ddl: string;
  /** What breaks in the product if nothing enforces it. */
  why: string;
  /** Rows that violate it today. Zero means the cutover can add the constraint unmodified. */
  count: () => Promise<number>;
  /** (a) enum, (b) check, (c) conditional-not-null */
  kind: "enum" | "check" | "cond-null";
};

const n = async (sql: string): Promise<number> => {
  const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(sql);
  return Number(r[0].n);
};

const SECTIONS = ["grocery", "alcohol", "dcneu", "cosmetice", "farmacie"] as const;
const UNITS = ["kg", "l", "buc"] as const;

/** Rows whose value is outside the allowed set. Quoting is ours, values are literals. */
function notIn(table: string, col: string, allowed: readonly string[], nullOk = true): () => Promise<number> {
  const list = allowed.map((v) => "'" + v + "'").join(",");
  const nullGuard = nullOk ? col + " IS NOT NULL AND " : "";
  return () => n(`SELECT COUNT(*) n FROM "${table}" WHERE ${nullGuard}${col} NOT IN (${list})`);
}

/** Same check across several tables that share one vocabulary. */
function notInAll(pairs: readonly (readonly [string, string])[], allowed: readonly string[], nullOk = false): () => Promise<number> {
  return async () => {
    let total = 0;
    for (const [t, c] of pairs) total += await notIn(t, c, allowed, nullOk)();
    return total;
  };
}

const RULES: Rule[] = [
  // ── (a) ENUMS ──────────────────────────────────────────────────────────────────────────
  {
    kind: "enum",
    ddl:
      `CREATE TYPE "PriceSource" AS ENUM ('SHELF','ONLINE','DELIVERY_PLATFORM','FLYER');\n` +
      `ALTER TABLE "Offer" ALTER COLUMN "priceSource" TYPE "PriceSource" USING "priceSource"::"PriceSource";`,
    why: "the optimizer excludes DELIVERY_PLATFORM for markup; a fifth spelling silently takes the wrong branch",
    count: notIn("Offer", "priceSource", PRICE_SOURCES, false),
  },
  {
    kind: "enum",
    ddl:
      `CREATE TYPE "PriceChannel" AS ENUM ('shelf','delivery','aggregator');\n` +
      `ALTER TABLE "Merchant" ALTER COLUMN "priceChannel" TYPE "PriceChannel" USING "priceChannel"::"PriceChannel";`,
    why: "toPriceSource() falls through to SHELF on an unknown channel, so a typo mislabels a whole merchant",
    count: notIn("Merchant", "priceChannel", ["shelf", "delivery", "aggregator"], false),
  },
  {
    kind: "enum",
    ddl:
      `CREATE TYPE "StockStatus" AS ENUM ('IN_STOCK','OUT_OF_STOCK','LIMITED','PREORDER','UNKNOWN');\n` +
      `ALTER TABLE "Offer" ALTER COLUMN "stockStatus" TYPE "StockStatus" USING "stockStatus"::"StockStatus";`,
    why: "an unknown value reads as neither in nor out of stock, so a sold-out price can headline a page",
    count: notIn("Offer", "stockStatus", ["IN_STOCK", "OUT_OF_STOCK", "LIMITED", "PREORDER", "UNKNOWN"], false),
  },
  {
    kind: "enum",
    // `availability` is the legacy free-text twin of stockStatus and holds prose ("in stock").
    // Both are live. Collapsing them is its own migration; until then the enum locks the values.
    ddl:
      `CREATE TYPE "Availability" AS ENUM ('in stock','out of stock','limited','preorder','unknown');\n` +
      `ALTER TABLE "Offer" ALTER COLUMN "availability" TYPE "Availability" USING "availability"::"Availability";`,
    why: "isCurrent() tests availability !== 'in stock'; any other spelling silently withholds every offer",
    count: notIn("Offer", "availability", ["in stock", "out of stock", "limited", "preorder", "unknown"], false),
  },
  {
    kind: "enum",
    ddl:
      `CREATE TYPE "VatBasis" AS ENUM ('WITH_VAT','WITHOUT_VAT');\n` +
      `ALTER TABLE "Offer" ALTER COLUMN "vatBasis" TYPE "VatBasis" USING "vatBasis"::"VatBasis";`,
    why: "DCNeu prints a 'Fara TVA' figure next to the real one; reading the wrong basis understates by 21%",
    count: notIn("Offer", "vatBasis", ["WITH_VAT", "WITHOUT_VAT"], false),
  },
  {
    kind: "enum",
    ddl:
      `CREATE TYPE "Condition" AS ENUM ('NEW','REFURBISHED','USED','OPEN_BOX');\n` +
      `ALTER TABLE "Offer" ALTER COLUMN "condition" TYPE "Condition" USING "condition"::"Condition";`,
    why: "electronics compares a refurbished price against a new one unless condition is a closed set",
    count: notIn("Offer", "condition", ["NEW", "REFURBISHED", "USED", "OPEN_BOX"], false),
  },
  {
    kind: "enum",
    ddl:
      `CREATE TYPE "Section" AS ENUM ('grocery','alcohol','dcneu','cosmetice','farmacie');\n` +
      `ALTER TABLE "Product" ALTER COLUMN "section" TYPE "Section" USING "section"::"Section";\n` +
      `ALTER TABLE "Category" ALTER COLUMN "section" TYPE "Section" USING "section"::"Section";\n` +
      `ALTER TABLE "PendingMatch" ALTER COLUMN "section" TYPE "Section" USING "section"::"Section";\n` +
      `ALTER TABLE "EquivalenceClass" ALTER COLUMN "section" TYPE "Section" USING "section"::"Section";`,
    why: "a section typo hides a product from its own listing page and from every section-scoped matcher rule",
    count: notInAll(
      [["Product", "section"], ["Category", "section"], ["PendingMatch", "section"], ["EquivalenceClass", "section"]],
      SECTIONS,
    ),
  },
  {
    kind: "enum",
    ddl:
      `CREATE TYPE "Unit" AS ENUM ('kg','l','buc');\n` +
      `ALTER TABLE "Product" ALTER COLUMN "unit" TYPE "Unit" USING "unit"::"Unit";\n` +
      `ALTER TABLE "EquivalenceClass" ALTER COLUMN "unit" TYPE "Unit" USING "unit"::"Unit";`,
    why: "unit is the denominator of every per-unit price; a fourth spelling compares lei/kg against lei/l",
    count: notInAll([["Product", "unit"], ["EquivalenceClass", "unit"]], UNITS),
  },
  {
    kind: "enum",
    ddl:
      `CREATE TYPE "StoreType" AS ENUM ('online','hybrid','physical');\n` +
      `ALTER TABLE "Merchant" ALTER COLUMN "storeType" TYPE "StoreType" USING "storeType"::"StoreType";`,
    why: "storeType decides whether a merchant can be a stop on a physical shopping route",
    count: notIn("Merchant", "storeType", ["online", "hybrid", "physical"], false),
  },
  {
    kind: "enum",
    ddl:
      `CREATE TYPE "ReferencePriceKind" AS ENUM ('STRIKETHROUGH','OMNIBUS_30D','LOYALTY','RRP');\n` +
      `ALTER TABLE "Offer" ALTER COLUMN "referencePriceKind" TYPE "ReferencePriceKind" USING "referencePriceKind"::"ReferencePriceKind";`,
    why: "an Omnibus 30-day figure is a LOW, not a 'was' price; showing it struck through is a false discount claim",
    count: notIn("Offer", "referencePriceKind", ["STRIKETHROUGH", "OMNIBUS_30D", "LOYALTY", "RRP"]),
  },
  {
    kind: "enum",
    ddl:
      `CREATE TYPE "MatchDecision" AS ENUM ('confirm','reject');\n` +
      `ALTER TABLE "MatchOverride" ALTER COLUMN "decision" TYPE "MatchDecision" USING "decision"::"MatchDecision";\n` +
      `ALTER TABLE "PendingMatch" ALTER COLUMN "decision" TYPE "MatchDecision" USING "decision"::"MatchDecision";`,
    why: "a human decision that does not parse is a human decision that gets ignored on the next rebuild",
    count: async () =>
      (await notIn("MatchOverride", "decision", ["confirm", "reject"], false)()) +
      (await notIn("PendingMatch", "decision", ["confirm", "reject"], true)()),
  },
  {
    kind: "enum",
    ddl:
      `CREATE TYPE "SubstitutionMode" AS ENUM ('EXACT','EQUIVALENT','ANY');\n` +
      `ALTER TABLE "GroceryListItem" ALTER COLUMN "substitutionMode" TYPE "SubstitutionMode" USING "substitutionMode"::"SubstitutionMode";`,
    why: "the optimizer substitutes on this value; an unknown mode swaps a product the shopper pinned",
    count: notIn("GroceryListItem", "substitutionMode", ["EXACT", "EQUIVALENT", "ANY"], false),
  },
  {
    kind: "enum",
    ddl: `ALTER TABLE "Offer" ADD CONSTRAINT "offer_currency_ron" CHECK ("currency" = 'RON');`,
    why: "summarize() compares bani across offers and refuses a mixed-currency product; one EUR row silences a page",
    count: notIn("Offer", "currency", ["RON"], false),
  },

  // ── (b) CHECK CONSTRAINTS ON MONEY AND RANGES ──────────────────────────────────────────
  {
    kind: "check",
    ddl: `ALTER TABLE "Offer" ADD CONSTRAINT "offer_price_positive" CHECK ("priceBani" > 0 AND "price" > 0);`,
    why: "parsePrice never returns 0, so a zero price is always a writer bug — and it wins every cheapest-price sort",
    count: () => n(`SELECT COUNT(*) n FROM "Offer" WHERE "price" <= 0 OR ("priceBani" IS NOT NULL AND "priceBani" <= 0)`),
  },
  {
    kind: "check",
    ddl: `ALTER TABLE "Offer" ALTER COLUMN "priceBani" SET NOT NULL;`,
    why: "bani is the money of record; a null forces every reader back onto the float it was meant to replace",
    count: () => n(`SELECT COUNT(*) n FROM "Offer" WHERE "priceBani" IS NULL`),
  },
  {
    kind: "check",
    ddl: `ALTER TABLE "Offer" ADD CONSTRAINT "offer_bani_matches_float" CHECK (ABS("priceBani" - ROUND("price"*100)) <= 1);`,
    why: "the two money columns disagreeing is the exact state the priceBani migration was found in — inert, 614 rows apart",
    count: () => n(`SELECT COUNT(*) n FROM "Offer" WHERE "priceBani" IS NOT NULL AND ABS("priceBani" - CAST(ROUND("price"*100) AS INTEGER)) > 1`),
  },
  {
    kind: "check",
    ddl: `ALTER TABLE "Offer" ADD CONSTRAINT "offer_strikethrough_is_a_discount" CHECK ("oldPriceBani" IS NULL OR "oldPriceBani" > "priceBani");`,
    why: "a struck-through price at or below the current one is a discount claim the law treats as misleading",
    count: () => n(`SELECT COUNT(*) n FROM "Offer" WHERE "oldPriceBani" IS NOT NULL AND "priceBani" IS NOT NULL AND "oldPriceBani" <= "priceBani"`),
  },
  {
    kind: "check",
    ddl: `ALTER TABLE "Offer" ADD CONSTRAINT "offer_perunit_nonneg" CHECK ("pricePerUnitBani" IS NULL OR "pricePerUnitBani" >= 0);`,
    why: "per-unit is the number the ranking sorts on; a negative one takes first place",
    count: () => n(`SELECT COUNT(*) n FROM "Offer" WHERE "pricePerUnitBani" IS NOT NULL AND "pricePerUnitBani" < 0`),
  },
  {
    kind: "check",
    ddl: `ALTER TABLE "Product" ADD CONSTRAINT "product_unitsize_positive" CHECK ("unitSize" > 0);`,
    why: "unitSize is a divisor — a zero produced Infinity per-unit prices when two size parsers disagreed",
    count: () => n(`SELECT COUNT(*) n FROM "Product" WHERE "unitSize" <= 0`),
  },
  {
    kind: "check",
    ddl: `ALTER TABLE "Offer" ADD CONSTRAINT "offer_matchscore_unit_interval" CHECK ("matchScore" IS NULL OR ("matchScore" >= 0 AND "matchScore" <= 1));`,
    why: "the three bands are read off this number; a value outside 0..1 lands in no band and is treated as AUTO",
    count: () => n(`SELECT COUNT(*) n FROM "Offer" WHERE "matchScore" IS NOT NULL AND ("matchScore" < 0 OR "matchScore" > 1)`),
  },
  {
    kind: "check",
    ddl: `ALTER TABLE "BulkTier" ADD CONSTRAINT "bulktier_sane" CHECK ("unitPriceBani" > 0 AND "minQuantity" > 0);`,
    why: "a zero-price tier makes a DCNeu bulk ladder read as free at quantity N",
    count: () => n(`SELECT COUNT(*) n FROM "BulkTier" WHERE "unitPriceBani" <= 0 OR "minQuantity" <= 0`),
  },
  {
    kind: "check",
    ddl: `ALTER TABLE "Offer" ADD CONSTRAINT "offer_promo_window_ordered" CHECK ("promoValidTo" IS NULL OR "promoValidFrom" IS NULL OR "promoValidTo" >= "promoValidFrom");`,
    why: "an inverted window makes a promo permanently expired or permanently live, and FLYER offers age by it alone",
    count: () => n(`SELECT COUNT(*) n FROM "Offer" WHERE "promoValidTo" IS NOT NULL AND "promoValidFrom" IS NOT NULL AND "promoValidTo" < "promoValidFrom"`),
  },
  {
    kind: "check",
    ddl: `ALTER TABLE "Offer" ADD CONSTRAINT "offer_not_observed_in_the_future" CHECK ("lastObservedAt" IS NULL OR "lastObservedAt" <= now());`,
    why: "a future observation date makes a stale price look freshly seen — how the 26-day-old headline survived",
    count: () => n(`SELECT COUNT(*) n FROM "Offer" WHERE "lastObservedAt" > datetime('now')`),
  },

  // ── (c) NOT NULL THAT DEPENDS ON ANOTHER COLUMN ────────────────────────────────────────
  {
    kind: "cond-null",
    ddl: `ALTER TABLE "Offer" ADD CONSTRAINT "offer_observed_unless_flyer" CHECK ("priceSource" = 'FLYER' OR "lastObservedAt" IS NOT NULL);`,
    why: "the ONE exemption in isCurrent(). A writer that emits offers it never observed is invisible without this",
    count: () => n(`SELECT COUNT(*) n FROM "Offer" WHERE "lastObservedAt" IS NULL AND "priceSource" <> 'FLYER'`),
  },
  {
    kind: "cond-null",
    ddl: `ALTER TABLE "Offer" ADD CONSTRAINT "offer_flyer_has_a_window" CHECK ("priceSource" <> 'FLYER' OR "promoValidTo" IS NOT NULL);`,
    why: "a FLYER offer is exempt from the age check, so without an end date it never expires at all",
    count: () => n(`SELECT COUNT(*) n FROM "Offer" WHERE "priceSource" = 'FLYER' AND "promoValidTo" IS NULL`),
  },
  {
    kind: "cond-null",
    ddl: `ALTER TABLE "Offer" ADD CONSTRAINT "offer_strikethrough_has_a_kind" CHECK ("oldPriceBani" IS NULL OR "referencePriceKind" IS NOT NULL);`,
    why: "without the kind we cannot tell a real 'was' price from an Omnibus 30-day low, and we show them the same way",
    count: () => n(`SELECT COUNT(*) n FROM "Offer" WHERE "oldPriceBani" IS NOT NULL AND "referencePriceKind" IS NULL`),
  },
];

const KIND_LABEL: Record<Rule["kind"], string> = {
  enum: "(a) Prisma will not emit enums on SQLite",
  check: "(b) Prisma cannot express CHECK on any connector",
  "cond-null": "(c) a NOT NULL that depends on another column IS a CHECK",
};

async function main(): Promise<void> {
  const fk = await prisma.$queryRawUnsafe<{ foreign_keys: number }[]>("PRAGMA foreign_keys");
  const orphans =
    (await n(`SELECT COUNT(*) n FROM "Offer" o LEFT JOIN "Merchant" m ON m.id=o.merchantId WHERE m.id IS NULL`)) +
    (await n(`SELECT COUNT(*) n FROM "Offer" o LEFT JOIN "Product" p ON p.id=o.productId WHERE p.id IS NULL`)) +
    (await n(`SELECT COUNT(*) n FROM "PriceHistory" h LEFT JOIN "Offer" o ON o.id=h.offerId WHERE o.id IS NULL`));

  console.log("\n════ POSTGRES CUTOVER CHECKLIST ═══════════════════════════════════════════════");
  console.log("  Every rule this project relies on that the LOCAL database cannot refuse.");
  console.log(`  Foreign keys: PRAGMA foreign_keys = ${fk[0]?.foreign_keys}, orphan rows = ${orphans}.`);
  console.log("  SQLite IS enforcing referential integrity, so FKs are not on this list.");

  let blocked = 0;
  for (const kind of ["enum", "check", "cond-null"] as const) {
    const label = KIND_LABEL[kind];
    console.log(`\n\n── ${label} ${"─".repeat(Math.max(3, 62 - label.length))}`);
    for (const r of RULES.filter((x) => x.kind === kind)) {
      const c = await r.count();
      if (c > 0) blocked++;
      const lines = r.ddl.split("\n");
      console.log(`\n  ${c === 0 ? "✓ ready " : `✗ ${String(c).padStart(5)} BLOCK`}  ${lines[0]}`);
      for (const l of lines.slice(1)) console.log(`            ${l}`);
      console.log(`            why: ${r.why}`);
    }
  }

  console.log(`\n\n  ${RULES.length} constraints. ${RULES.length - blocked} apply as written; ${blocked} need data repair first.`);
  console.log("  A ✓ is not permission to skip the constraint — it means the constraint will apply");
  console.log("  cleanly today. The point of adding it is the rows that do not exist yet.\n");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
