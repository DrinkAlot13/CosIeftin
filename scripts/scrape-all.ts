// Resilient pipeline orchestrator. Auchan MUST succeed (it builds the catalog master
// every other store matches onto); the rest run independently with one retry each, so a
// single transient failure (Playwright/Cloudflare/Akamai hiccup) no longer aborts the
// whole refresh. Cross-platform (spawns `npm run <script>` via the shell).
//
// Run: npm run scrape:all   (or npm run refresh = setup + this)

import { spawnSync } from "node:child_process";

// order matters: auchan first (catalog master); then match-only, then addNew stores,
// then the separate sections, then image self-hosting.
// Douglas was dropped deliberately: it yielded 5 products behind aggressive anti-bot, and
// beating it would have meant residential proxies — turning a manageable legal question
// into a real one. Kaufland/Penny replaced it with far more coverage, from public sources.
const AFTER_AUCHAN = ["freshful", "megaimage", "carrefour", "metro", "sezamo", "finestore", "lemanoir", "carrefour-alcohol", "dcneu", "farmaciatei", "kaufland", "penny"];

function run(script: string): boolean {
  const r = spawnSync("npm", ["run", script], { stdio: "inherit", shell: true });
  return r.status === 0;
}

function runWithRetry(script: string, retries = 1): boolean {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    if (run(script)) return true;
    console.error(`\n[scrape-all] "${script}" failed (attempt ${attempt}/${retries + 1}).`);
  }
  return false;
}

function main() {
  if (!runWithRetry("scrape:auchan")) {
    console.error("\n[scrape-all] Auchan (catalog master) failed — aborting so stores don't match an empty catalog.");
    process.exit(1);
  }
  const failed: string[] = [];
  for (const name of AFTER_AUCHAN) {
    if (!runWithRetry(`scrape:${name}`)) failed.push(name);
  }
  runWithRetry("download-images");
  console.log(`\n[scrape-all] done. ${failed.length ? "Skipped after retries: " + failed.join(", ") : "all stores OK."}`);
}

main();
