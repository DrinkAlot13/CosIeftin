// Tell the running site that the prices have changed.
//
// The last step of the nightly, after the scrapers and after `compute:home`. Everything the
// site caches is derived from the catalog, and the catalog changes at exactly this moment.
//
// IT REPORTS A SKIP AS A SKIP. If no site is running — which is the normal case on a machine
// that scrapes but does not serve — this exits 0 and says so. What it must never do is exit 0
// silently, because "the nightly went green" would then mean "the nightly went green and the
// site may still be serving yesterday's prices", and those must not look alike.
//
// Run: npm run revalidate

// Every other script reaches the environment through lib/db's `import "dotenv/config"`. This
// one talks to HTTP and touches no database, so it has to load .env itself — without this it
// read an empty REVALIDATE_SECRET and reported "not set" while the variable sat in .env.
import "dotenv/config";
import { siteUrl } from "../src/lib/config/siteUrl";

/**
 * `REVALIDATE_BASE` overrides for a local check against a server on another port. Everything
 * else goes through `siteUrl()` — reading SITE_URL here directly is how the same variable ended
 * up with two different defaults, and `tests/site-url.test.ts` fails the moment it happens
 * again. It caught this file on its first run.
 */
const BASE = process.env.REVALIDATE_BASE ?? siteUrl();
const SECRET = process.env.REVALIDATE_SECRET ?? "";

async function main(): Promise<void> {
  console.log(`\n════ CACHE INVALIDATION ═════════════════════════════════════════════════════`);
  if (!SECRET) {
    console.log(`  ⚠ REVALIDATE_SECRET is not set, so nothing was purged.`);
    console.log(`    Set it in .env and in the running site's environment. Until then the site`);
    console.log(`    refreshes on its 24-hour backstop instead of when the scrape finishes.\n`);
    process.exit(0);
  }

  const url = `${BASE.replace(/\/+$/, "")}/api/revalidate`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "x-revalidate-secret": SECRET },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    console.log(`  ⚠ no site answered at ${url}`);
    console.log(`    (${String(e).slice(0, 90)})`);
    console.log(`    Nothing was purged. If a site IS running, its caches are now stale until`);
    console.log(`    the 24-hour backstop expires.\n`);
    process.exit(0); // a machine that scrapes but does not serve is a normal configuration
  }

  const body = await res.text();
  if (!res.ok) {
    console.error(`  ✗ ${url} returned HTTP ${res.status}: ${body.slice(0, 200)}\n`);
    process.exit(1);
  }
  console.log(`  ✓ purged: ${body.slice(0, 300)}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
