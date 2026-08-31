// CI fence for parsePriceLei.
//
// parsePriceLei is TRANSITIONAL: it exists only because the money columns are still
// Float lei. Every new import of it is new float-money debt, so the allowlist below is
// the complete set of places permitted to use it. Adding a call site is a deliberate act
// that requires editing this file — which is the point.
//
// REMOVAL CONDITION: delete parsePriceLei, this checker, and the allowlist once every
// money column is an integer `*Bani` column and all readers use `parsePrice` directly.
// (That is Prompt B's migration. See CLAUDE.md → Prices: "Every price written to the DB
// is in bani (integer), not lei (float)".)
//
// Run: npm run check:parsepricelei   (also part of `npm run verify`)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const SEARCH_DIRS = ["src", "scripts"];
const ALLOWLIST_FILE = join(ROOT, "scripts", "parsepricelei-allowlist.txt");

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

function loadAllowlist(): Set<string> {
  const raw = readFileSync(ALLOWLIST_FILE, "utf8");
  return new Set(
    raw
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean),
  );
}

function main() {
  const allowed = loadAllowlist();
  const offenders: string[] = [];
  const seen = new Set<string>();

  for (const dir of SEARCH_DIRS) {
    for (const file of listFiles(join(ROOT, dir))) {
      const rel = relative(ROOT, file).split(sep).join("/");
      // The definition and this checker both name the symbol by necessity.
      if (rel === "src/lib/price/parsePrice.ts") continue;
      if (rel === "scripts/check-parsepricelei-allowlist.ts") continue;
      const body = readFileSync(file, "utf8");
      if (!/\bparsePriceLei\b/.test(body)) continue;
      seen.add(rel);
      if (!allowed.has(rel)) offenders.push(rel);
    }
  }

  const stale = [...allowed].filter((a) => !seen.has(a));

  if (offenders.length) {
    console.error("\n✗ parsePriceLei used outside the allowlist:\n");
    for (const o of offenders) console.error(`    ${o}`);
    console.error(
      "\n  parsePriceLei is transitional float-money debt. Either use parsePrice (bani),\n" +
        `  or add the file to ${relative(ROOT, ALLOWLIST_FILE)} with a reason.\n`,
    );
    process.exit(1);
  }

  console.log(`✓ parsePriceLei confined to ${seen.size} allowlisted call sites.`);
  if (stale.length) {
    // not a failure — but a stale entry means the migration moved on and the fence should shrink
    console.log(`  (allowlist has ${stale.length} stale entr${stale.length === 1 ? "y" : "ies"} to prune: ${stale.join(", ")})`);
  }
}

main();
