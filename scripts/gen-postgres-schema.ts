// Generate prisma/schema.postgres.prisma FROM prisma/schema.prisma.
//
// This file exists because hand-maintaining a parallel schema does not work. The Postgres
// schema was written as a migration prepared in advance, and then the SQLite schema grew past
// it: by the time anyone checked, **11 models and 45 fields** were missing from it — BulkTier,
// PriceAnomaly, ScraperRun, EquivalenceClass, Offer.priceBani and more. Nothing complained,
// because nothing runs against it. The drift would have been discovered on cutover night,
// which is the worst possible moment to discover anything.
//
// So the Postgres schema is no longer a copy anyone edits. It is generated, and a test fails
// if the checked-in file does not match what this script produces. Parity stops being a
// discipline and becomes a build step.
//
// The three deliberate differences, applied here:
//   1. provider = "postgresql"
//   2. @db.Text on genuinely long free-text columns (SQLite has no length types, so the
//      SQLite schema cannot express this and should not try)
//   3. indexes on the columns the hot queries filter and sort by
//
// Run: npm run gen:postgres          (writes the file)
//      npm run gen:postgres -- --check (exits non-zero if the file is stale)

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SQLITE_PATH = join(process.cwd(), "prisma", "schema.prisma");
const PG_PATH = join(process.cwd(), "prisma", "schema.postgres.prisma");

/** Columns that hold long free text. Everything else is fine as Postgres' default varchar. */
const TEXT_COLUMNS: Record<string, string[]> = {
  Product: ["image", "description"],
  Offer: ["url", "bulkTiers", "rawPriceText", "rawSourceBlob", "productUrl", "flagReason", "image"],
  MatchOverride: ["storeKey", "note"],
  Receipt: ["lines", "raw"],
  ScraperRun: ["note", "error"],
  PriceAnomaly: ["reason", "rawPriceText"],
  Merchant: ["websiteUrl", "logo"],
  FeedSource: ["url"],
  FeedRun: ["error"],
  ProductSpec: ["value"],
  ProductAttribute: ["value"],
};

/** Indexes the hot queries need. Keyed by model; each entry is a field list. */
const EXTRA_INDEXES: Record<string, string[][]> = {
  Category: [["section"]],
  Product: [["section"], ["nameNorm"], ["categoryId"], ["section", "categoryId"]],
  Offer: [["merchantId"], ["productId", "price"], ["flagged"], ["isStale", "isExpired"]],
  MatchOverride: [["merchantId"]],
  PriceHistory: [["offerId", "recordedAt"]],
  PriceAlert: [["active"]],
  Receipt: [["day"]],
  ScraperRun: [["merchantId", "startedAt"]],
  PriceAnomaly: [["resolved"]],
  BulkTier: [["offerId"]],
};

const HEADER = `// PRODUCTION schema — PostgreSQL.
//
// GENERATED FILE — do not edit by hand. Run \`npm run gen:postgres\`.
//
// Source of truth is prisma/schema.prisma (SQLite, local dev). This file is generated from it
// so the two cannot drift: a parallel schema maintained by hand fell 11 models and 45 fields
// behind before anyone noticed, and nothing complained, because nothing runs against it.
// tests/schema-parity.test.ts fails if this file is stale.
//
// Differences from the SQLite schema, all applied by the generator:
//   • provider = "postgresql"
//   • @db.Text on long free-text columns (SQLite has no length types)
//   • indexes on the columns the hot queries filter/sort by
//
// Why Postgres before launch: SQLite + a nightly bulk write + concurrent reads is the first
// outage. Postgres also brings pg_trgm + unaccent, which product search and matching want
// anyway (accent-insensitive fuzzy search over 30k products).
//
// Migrate with: npm run db:migrate-postgres  (see scripts/migrate-to-postgres.ts)
`;

/** Does this field line declare a scalar String (so @db.Text is meaningful)? */
function isStringField(line: string, field: string): boolean {
  const m = line.trim().match(/^(\w+)\s+(\S+)/);
  return !!m && m[1] === field && /^String\??$/.test(m[2]);
}

export function generate(sqlite: string): string {
  const lines = sqlite.split(/\r?\n/);
  const out: string[] = [];
  let model: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = line.match(/^model\s+(\w+)\s*\{/);
    if (open) model = open[1];

    // datasource: the one block that genuinely differs
    if (/^\s*provider\s*=\s*"sqlite"/.test(line)) {
      out.push(line.replace('"sqlite"', '"postgresql"'));
      continue;
    }

    // closing brace of a model: append its indexes, avoiding duplicates
    if (model && /^\}/.test(line)) {
      const wanted = EXTRA_INDEXES[model] ?? [];
      const already = out.join("\n");
      for (const fields of wanted) {
        const decl = `  @@index([${fields.join(", ")}])`;
        // only look inside the current model block
        const start = already.lastIndexOf(`model ${model} {`);
        if (start >= 0 && already.slice(start).includes(decl.trim())) continue;
        out.push(decl);
      }
      out.push(line);
      model = null;
      continue;
    }

    // @db.Text on the long free-text columns of this model
    if (model) {
      const cols = TEXT_COLUMNS[model] ?? [];
      const hit = cols.find((c) => isStringField(line, c));
      if (hit && !line.includes("@db.")) {
        out.push(line.replace(/\s*$/, "") + " @db.Text");
        continue;
      }
    }

    out.push(line);
  }

  // Replace the SQLite header comment block with the Postgres one.
  const body = out.join("\n").replace(/^(\/\/[^\n]*\n)+/, "");
  return HEADER + "\n" + body.replace(/^\n+/, "");
}

function main(): void {
  const sqlite = readFileSync(SQLITE_PATH, "utf8");
  const generated = generate(sqlite);
  const check = process.argv.includes("--check");

  if (check) {
    let current = "";
    try { current = readFileSync(PG_PATH, "utf8"); } catch { /* missing counts as stale */ }
    if (current.replace(/\r\n/g, "\n") !== generated.replace(/\r\n/g, "\n")) {
      console.error("✗ prisma/schema.postgres.prisma is STALE. Run: npm run gen:postgres");
      process.exit(1);
    }
    console.log("✓ prisma/schema.postgres.prisma is up to date with schema.prisma");
    return;
  }

  writeFileSync(PG_PATH, generated, "utf8");
  const models = (generated.match(/^model\s+\w+/gm) ?? []).length;
  console.log(`✓ wrote prisma/schema.postgres.prisma — ${models} models`);
}

const invokedDirectly = process.argv[1]
  ? process.argv[1].split("\\").join("/").endsWith("gen-postgres-schema.ts")
  : false;
if (invokedDirectly) main();
