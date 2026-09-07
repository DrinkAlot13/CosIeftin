// ── SCOPE: USER-FACING ────────────────────────────────────────────────────────
// A CACHED NUMBER IS STILL A CLAIM. Check it against the database it came from.
//
// The homepage is now statically generated, so its three counters are baked into an HTML file
// and served without touching the database. That is the whole point — and it is also exactly
// how a site starts telling visitors something that used to be true. "Stale but fast" is a bug
// this project has already had once.
//
// So: read the numbers a visitor actually sees out of the RENDERED PAGE, ask the database the
// same questions right now, and compare. Same for the counts that head a list, since a count
// that disagrees with the list under it is the same defect wearing different clothes.
//
// This deliberately parses the HTML rather than calling the query functions twice. Calling
// countStats() and comparing it to countStats() proves nothing; the thing under test is what
// reached the page.
//
// Run: npm run verify:counters   (needs a server; pass BASE=http://localhost:3100)

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE = process.env.BASE ?? "http://localhost:3000";
const MAX_DISPLAY_AGE_DAYS = 14;

const liveOffer = () => ({
  merchant: { active: true },
  availability: "in stock",
  isStale: false,
  NOT: { priceSource: "DELIVERY_PLATFORM" },
  flagged: false,
  lastObservedAt: { gte: new Date(Date.now() - MAX_DISPLAY_AGE_DAYS * 86_400_000) },
  product: { section: "grocery" },
});

let failures = 0;
function check(label: string, page: number | null, db: number, note = ""): void {
  const ok = page !== null && page === db;
  if (!ok) failures++;
  const shown = page === null ? "not found on page" : page.toLocaleString("ro-RO");
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(48)} page ${shown.padStart(12)}   db ${db.toLocaleString("ro-RO").padStart(12)}`);
  if (!ok && note) console.log(`      ${note}`);
}

/**
 * Strip Romanian digit grouping.
 *
 * `toLocaleString("ro-RO")` emits U+00A0 or U+202F between groups depending on the runtime, and
 * plain HTML uses a dot. `\D` covers all of them without this file having to name each
 * invisible character — naming them is how the pattern silently stopped matching once already.
 */
function num(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\D/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function get(path: string): Promise<string> {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.text();
}

async function main(): Promise<void> {
  console.log(`\n════ DO THE NUMBERS ON THE PAGE STILL MATCH THE DATABASE? ═══════════════════`);
  console.log(`  Reading ${BASE} — the rendered page, not the functions behind it.\n`);

  // ── 1. The homepage's three counters, now served from a static file.
  const home = await get("/");
  const live = liveOffer();
  const [dbProducts, dbOffers, dbChains] = await Promise.all([
    prisma.product.count({ where: { section: "grocery", offers: { some: live } } }),
    prisma.offer.count({ where: live }),
    prisma.merchant.count({ where: { active: true, offers: { some: live } } }),
  ]);

  console.log(`  HOMEPAGE COUNTERS (static HTML)`);
  // The markup is `<b>17919</b> produse`. Anchored on the tag: a looser pattern matches the
  // meta description ("prețuri la alimente") and then reports a number that is not the counter.
  const products = num(/<b>([^<]+)<\/b>\s*produse/i.exec(home)?.[1]);
  const offers = num(/<b>([^<]+)<\/b>\s*prețuri/i.exec(home)?.[1]);
  const chains = num(/<b>([^<]+)<\/b>\s*magazine/i.exec(home)?.[1]);
  const staleNote = "the page was generated before the last scrape — the nightly runs `npm run revalidate` for exactly this";
  check("produse", products, dbProducts, staleNote);
  check("prețuri", offers, dbOffers, staleNote);
  check("magazine", chains, dbChains, staleNote);

  // ── 2. A category page: the sidebar's number for this shelf vs the cards it heads.
  console.log(`\n  CATEGORY PAGE — the sidebar count vs the list under it`);
  const cat = await get("/c/lapte");
  const cards = (cat.match(/class="card pcard"/g) ?? []).length;
  const toolbar = num(/<span class="muted">([^<]+)<!-- --> produse<\/span>/i.exec(cat)?.[1]);
  check("cards rendered vs the page's own count", toolbar, cards);
  const sidebar = num(/aria-current="page"[\s\S]{0,200}?<span class="cat-nav__count">([^<]+)</i.exec(cat)?.[1]);
  if (sidebar !== null) check("sidebar figure for this shelf", sidebar, cards);
  else console.log(`  – sidebar figure not matched (markup changed?) — not counted either way`);

  // ── 3. /necategorisate is paginated now. The TOTAL it reports must be the true total,
  //      not the size of the page — that is the whole reason the listing exists.
  console.log(`\n  UNCATEGORISED — paginated, so the total must still be the true total`);
  const unc = await get("/necategorisate");
  const uncCards = (unc.match(/class="card pcard"/g) ?? []).length;
  // "produse cu preț azi" appears TWICE: once in the sidebar's section total (17,919) and once
  // in the page's own lead paragraph. Anchor on the second half of the sentence, which only the
  // page has — the loose pattern matched the sidebar and would have "verified" the wrong number.
  const uncTotal = num(/<p class="muted"[^>]*>([^<]+)<!-- --> produse cu preț azi[\s\S]{0,40}pe care nu le-am putut/i.exec(unc)?.[1]);
  const dbUnc = await prisma.product.count({
    where: { categoryId: null, section: "grocery", offers: { some: live } },
  });
  check("reported total vs database", uncTotal, dbUnc,
    "a paginated page reporting its page size instead of its total hides the tail it exists to show");
  console.log(`    ${uncCards} cards on page one of ${uncTotal ?? "?"}`);
  if (uncTotal !== null && uncTotal > 120 && uncCards >= uncTotal) {
    failures++;
    console.log(`  ✗ every product is still on one page — pagination is not in effect`);
  }

  // ── 4. /oferte: every card must be a real comparison.
  console.log(`\n  DEALS — a deal needs two shops, or it is one shop changing its own price`);
  // Ask what the PAGE shows, not what the table holds. 508 products carry a dealScore over 8
  // with a single live offer — a real drop at one shop — and /oferte's own query excludes them.
  // A check counting those would report a filter working as a filter failing.
  const dealsHtml = await get("/oferte");
  const dealCards = (dealsHtml.match(/class="card pcard"/g) ?? []).length;
  const eligible = await prisma.product.count({
    where: { section: "grocery", dealScore: { gte: 8 }, liveOfferCount: { gte: 2 } },
  });
  check("deal cards rendered", dealCards, Math.min(60, eligible),
    "the page takes the top 60 of everything scoring 8%+ at two or more shops");
  if (/cel mai ieftin la null/.test(dealsHtml)) {
    failures++;
    console.log(`  ✗ a deal card names no cheapest shop`);
  } else {
    console.log(`  ✓ every deal card names the shop it is cheapest at`);
  }

  // ── 5. Search: the count in the heading is the number of MATCHES, not the page size.
  console.log(`\n  SEARCH — the heading counts matches, not the page`);
  const s = await get("/search?q=lapte");
  const shown = (s.match(/class="card pcard"/g) ?? []).length;
  const heading = num(/\(<!-- -->([^<]+)<!-- -->\)<\/span>/.exec(s)?.[1]);
  if (heading === null) {
    failures++;
    console.log(`  ✗ no result count found in the search heading`);
  } else if (heading < shown) {
    failures++;
    console.log(`  ✗ heading claims ${heading} matches but ${shown} cards are on the page`);
  } else {
    console.log(`  ✓ heading claims ${heading} matches, page shows ${shown} of them`);
  }

  console.log(`\n${"─".repeat(78)}`);
  console.log(failures === 0
    ? `  ✓ every number on the page matches the database behind it\n`
    : `  ✗ ${failures} number(s) on the page disagree with the database — fast and wrong\n`);
  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
