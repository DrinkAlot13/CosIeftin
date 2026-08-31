// SQLite → PostgreSQL data migration, with a row-count + checksum verification pass.
//
// Usage:
//   1. Provision Postgres and put its URL in POSTGRES_URL
//   2. Create the schema there:
//        npx prisma db push --schema prisma/schema.postgres.prisma
//        (with DATABASE_URL temporarily pointing at Postgres)
//   3. Copy the data:
//        SQLITE_URL="file:./prisma/dev.db" POSTGRES_URL="postgresql://…" npm run db:migrate-postgres
//   4. Verify — the script re-reads both sides and compares counts and money checksums.
//
// The target database must be EMPTY — this copies rows verbatim, it does not merge.
// (skipDuplicates is Postgres-only and the locally generated client is SQLite-typed,
// so we rely on a clean target instead of relying on that flag.)
//
// Order matters (foreign keys): Category → Merchant → Product → Offer → PriceHistory → …
// Identity columns are copied as-is, then each Postgres sequence is advanced past the max id.

import { PrismaClient as SqliteClient } from "@prisma/client";
import { PrismaClient as PgClient } from "@prisma/client";

const SQLITE_URL = process.env.SQLITE_URL ?? "file:./prisma/dev.db";
const POSTGRES_URL = process.env.POSTGRES_URL ?? "";
const BATCH = 1000;

if (!POSTGRES_URL) {
  console.error("Set POSTGRES_URL (and optionally SQLITE_URL) before running.");
  process.exit(1);
}

const src = new SqliteClient({ datasources: { db: { url: SQLITE_URL } } });
const dst = new PgClient({ datasources: { db: { url: POSTGRES_URL } } });

/** Copy one table in batches, preserving ids. */
async function copy<T extends { id: number }>(
  label: string,
  read: (skip: number, take: number) => Promise<T[]>,
  write: (rows: T[]) => Promise<unknown>,
): Promise<number> {
  let skip = 0;
  let total = 0;
  for (;;) {
    const rows = await read(skip, BATCH);
    if (rows.length === 0) break;
    await write(rows);
    total += rows.length;
    skip += rows.length;
    process.stdout.write(`\r  ${label.padEnd(16)} ${total}`);
  }
  console.log(`\r  ${label.padEnd(16)} ${total} ✓`);
  return total;
}

async function main() {
  console.log(`\nMigrating\n  from ${SQLITE_URL}\n  to   ${POSTGRES_URL.replace(/:[^:@]+@/, ":***@")}\n`);

  // ── copy, parents first ────────────────────────────────────────────────────────
  // Category is self-referential: insert parents before children by ordering on id
  // and clearing parentId on the first pass, then patching it afterwards.
  const cats = await src.category.findMany({ orderBy: { id: "asc" } });
  await dst.category.createMany({ data: cats.map((c) => ({ ...c, parentId: null })) });
  for (const c of cats) if (c.parentId != null) await dst.category.update({ where: { id: c.id }, data: { parentId: c.parentId } });
  console.log(`  categories       ${cats.length} ✓`);

  await copy("merchants", (s, t) => src.merchant.findMany({ orderBy: { id: "asc" }, skip: s, take: t }),
    (rows) => dst.merchant.createMany({ data: rows }));

  await copy("products", (s, t) => src.product.findMany({ orderBy: { id: "asc" }, skip: s, take: t }),
    (rows) => dst.product.createMany({ data: rows }));

  await copy("offers", (s, t) => src.offer.findMany({ orderBy: { id: "asc" }, skip: s, take: t }),
    (rows) => dst.offer.createMany({ data: rows }));

  await copy("price history", (s, t) => src.priceHistory.findMany({ orderBy: { id: "asc" }, skip: s, take: t }),
    (rows) => dst.priceHistory.createMany({ data: rows }));

  await copy("overrides", (s, t) => src.matchOverride.findMany({ orderBy: { id: "asc" }, skip: s, take: t }),
    (rows) => dst.matchOverride.createMany({ data: rows }));

  await copy("alerts", (s, t) => src.priceAlert.findMany({ orderBy: { id: "asc" }, skip: s, take: t }),
    (rows) => dst.priceAlert.createMany({ data: rows }));

  await copy("index snapshots", (s, t) => src.indexSnapshot.findMany({ orderBy: { id: "asc" }, skip: s, take: t }),
    (rows) => dst.indexSnapshot.createMany({ data: rows }));

  await copy("users", (s, t) => src.user.findMany({ orderBy: { id: "asc" }, skip: s, take: t }),
    (rows) => dst.user.createMany({ data: rows }));

  await copy("lists", (s, t) => src.groceryList.findMany({ orderBy: { id: "asc" }, skip: s, take: t }),
    (rows) => dst.groceryList.createMany({ data: rows }));

  await copy("list items", (s, t) => src.groceryListItem.findMany({ orderBy: { id: "asc" }, skip: s, take: t }),
    (rows) => dst.groceryListItem.createMany({ data: rows }));

  // ── advance sequences past the copied ids ──────────────────────────────────────
  console.log("\nResetting sequences…");
  const TABLES = ["Category", "Merchant", "Product", "Offer", "PriceHistory", "MatchOverride", "PriceAlert", "IndexSnapshot", "User", "GroceryList", "GroceryListItem"];
  for (const t of TABLES) {
    await dst.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), COALESCE((SELECT MAX(id) FROM "${t}"), 1), true)`,
    ).catch((e: Error) => console.log(`  (skip ${t}: ${e.message.slice(0, 60)})`));
  }

  // ── verification: counts AND money checksums ───────────────────────────────────
  console.log("\nVerifying…");
  let ok = true;
  const checks: [string, () => Promise<number>, () => Promise<number>][] = [
    ["categories", () => src.category.count(), () => dst.category.count()],
    ["merchants", () => src.merchant.count(), () => dst.merchant.count()],
    ["products", () => src.product.count(), () => dst.product.count()],
    ["offers", () => src.offer.count(), () => dst.offer.count()],
    ["priceHistory", () => src.priceHistory.count(), () => dst.priceHistory.count()],
    ["overrides", () => src.matchOverride.count(), () => dst.matchOverride.count()],
    ["alerts", () => src.priceAlert.count(), () => dst.priceAlert.count()],
    ["indexSnapshots", () => src.indexSnapshot.count(), () => dst.indexSnapshot.count()],
    ["users", () => src.user.count(), () => dst.user.count()],
    ["lists", () => src.groceryList.count(), () => dst.groceryList.count()],
    ["listItems", () => src.groceryListItem.count(), () => dst.groceryListItem.count()],
  ];
  for (const [label, a, b] of checks) {
    const [x, y] = await Promise.all([a(), b()]);
    const good = x === y;
    if (!good) ok = false;
    console.log(`  ${good ? "✓" : "✗"} ${label.padEnd(16)} sqlite=${x} postgres=${y}`);
  }

  // Money checksum — a count match can still hide corrupted values.
  const [sSum, dSum] = await Promise.all([
    src.offer.aggregate({ _sum: { price: true } }),
    dst.offer.aggregate({ _sum: { price: true } }),
  ]);
  const s = Number(sSum._sum.price ?? 0);
  const d = Number(dSum._sum.price ?? 0);
  const sumOk = Math.abs(s - d) < 0.01;
  if (!sumOk) ok = false;
  console.log(`  ${sumOk ? "✓" : "✗"} offer price sum  sqlite=${s.toFixed(2)} postgres=${d.toFixed(2)}`);

  console.log(ok ? "\n✅ Migration verified.\n" : "\n❌ Migration MISMATCH — do not cut over.\n");
  await src.$disconnect();
  await dst.$disconnect();
  if (!ok) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await src.$disconnect().catch(() => {});
  await dst.$disconnect().catch(() => {});
  process.exit(1);
});
