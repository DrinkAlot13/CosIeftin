// ── SCOPE: EXTERNAL ORACLE — IS THE PRICE WE SHOW THE PRICE THE SHOP CHARGES? ─
//
// THE GAP THIS CLOSES, stated exactly. `audit:price-truth` established that **46,414 of 46,414
// live prices re-derive from their own `rawPriceText`** through `parsePrice`. That is a strong
// result and it is the wrong question: it proves we parse our own recorded strings correctly.
// It says NOTHING about whether the number matches what the shop charges today.
//
// Every internal check has this shape. Sezamo's 9,420 dead links were internally consistent too.
// See CLAUDE.md, "SOME FACTS CAN ONLY BE CHECKED AGAINST THE WORLD".
//
// ── THE ONE RULE THAT MAKES IT AN ORACLE RATHER THAN A MIRROR.
//
// **It does not use any scraper's selectors.** Reading the price back with the same code that
// wrote it would prove only that the code agrees with itself — CLAUDE.md's corollary, "a scraper
// reporting 0 rejected only means its own validator agreed with its own parser". So the price is
// read from the STRUCTURED DATA the merchant publishes for search engines: JSON-LD `Product`,
// `product:price:amount`, `itemprop="price"`. Those are written for Google, not for us, and a
// merchant that changes its DOM rarely changes them at the same moment.
//
// `parsePrice` IS used for string → bani, deliberately: CLAUDE.md mandates one price parser, and
// introducing a second one here would be the defect this project has already paid for twice.
// What is independent is WHERE THE STRING COMES FROM, which is the thing under test.
//
// ── THREE OUTCOMES, AND THE THIRD IS NOT A PASS.
//
//   AGREE      their published price equals ours
//   DISAGREE   both prices read, and they differ — the finding
//   UNREAD     no structured price on the page, or the page did not load
//
// UNREAD is reported separately and never counted as agreement. A page we could not read is
// unmeasured, and folding it into a pass rate is how a check comes to mean nothing.
//
// ── POLITENESS. 30 requests total, one host at a time, 2s apart, and `robots.txt` is fetched
// and honoured per merchant before anything else. A disallowed path is SKIPPED and reported as
// skipped, never fetched anyway.
//
//   npm run probe:live-prices
//   npm run probe:live-prices -- --n=30 --merchant=carrefour
//   npm run probe:live-prices -- --json logs/live-prices.json

import { PrismaClient } from "@prisma/client";
import { parsePrice } from "../src/lib/price/parsePrice";
import { nullProductUrlIsExpected } from "../src/lib/source-capabilities";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

const DEFAULT_N = 30;
const DELAY_MS = 2_000;
const TIMEOUT_MS = 25_000;
const MAX_AGE = 14 * 86_400_000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CosMicPriceCheck/1.0 (+https://cosmic.ro)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── ROBOTS.TXT ────────────────────────────────────────────────────────────────────────────
// Minimal and deliberately CONSERVATIVE: any `Disallow` under `User-agent: *` whose prefix
// matches the path blocks the fetch. It does not implement `Allow` precedence, so it errs
// toward not fetching. For a 30-request audit that is the right direction to err in.
const robotsCache = new Map<string, string[]>();

async function disallowedPrefixes(origin: string): Promise<string[]> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;
  const rules: string[] = [];
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": UA } });
    if (res.ok) {
      let applies = false;
      for (const raw of (await res.text()).split(/\r?\n/)) {
        const line = raw.split("#")[0].trim();
        if (!line) continue;
        const [k, ...rest] = line.split(":");
        const key = k.trim().toLowerCase();
        const value = rest.join(":").trim();
        if (key === "user-agent") applies = value === "*";
        else if (applies && key === "disallow" && value) rules.push(value);
      }
    }
  } catch {
    // Unreachable robots.txt is NOT permission. Reported by the caller as skipped.
    rules.push("/");
  }
  robotsCache.set(origin, rules);
  return rules;
}

async function allowedByRobots(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const rules = await disallowedPrefixes(u.origin);
    return !rules.some((r) => u.pathname.startsWith(r));
  } catch {
    return false;
  }
}

// ── READING THE MERCHANT'S OWN PUBLISHED PRICE ────────────────────────────────────────────
/** Every price-looking string the page publishes as STRUCTURED data, most trustworthy first. */
function publishedPriceStrings(html: string): { source: string; raw: string }[] {
  const out: { source: string; raw: string }[] = [];

  // 1. JSON-LD. The richest and the least likely to be a decoration.
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    const block = m[1];
    // Pull price fields without parsing the whole graph: these documents are frequently
    // malformed, and a JSON.parse failure would throw away a page we can otherwise read.
    for (const p of block.matchAll(/"(price|lowPrice)"\s*:\s*"?([\d.,]+)"?/g)) {
      out.push({ source: `json-ld ${p[1]}`, raw: p[2] });
    }
  }

  // 2. Open Graph / product meta, which most Romanian retailers emit for Facebook.
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount)["'][^>]+content=["']([^"']+)["']/gi)) {
    out.push({ source: "meta price:amount", raw: m[1] });
  }
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount)["']/gi)) {
    out.push({ source: "meta price:amount", raw: m[1] });
  }

  // 3. Microdata.
  for (const m of html.matchAll(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/gi)) {
    out.push({ source: "itemprop=price", raw: m[1] });
  }
  for (const m of html.matchAll(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/gi)) {
    out.push({ source: "itemprop=price", raw: m[1] });
  }
  return out;
}

type Outcome = "AGREE" | "DISAGREE" | "UNREAD" | "SKIPPED";

type Row = {
  offerId: number; merchant: string; product: string; storeName: string | null;
  url: string; ourBani: number; theirBani: number | null; theirSource: string | null;
  observedAgeDays: number; outcome: Outcome; note: string;
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let n = DEFAULT_N;
  let only: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--n=")) { n = Number(a.slice(4)); continue; }
    if (a.startsWith("--merchant=")) { only = a.slice(11); continue; }
    if (a === "--json") { i++; continue; }
    if (a.startsWith("--json=")) continue;
    console.error(`probe:live-prices — unrecognised argument ${JSON.stringify(a)}. Refusing to run.`);
    process.exit(2);
  }

  const cutoff = new Date(Date.now() - MAX_AGE);
  const offers = await prisma.offer.findMany({
    where: {
      merchant: { active: true }, availability: "in stock", isStale: false, flagged: false,
      lastObservedAt: { gte: cutoff }, productUrl: { not: null },
      ...(only ? { merchant: { slug: only, active: true } } : {}),
    },
    select: {
      id: true, price: true, priceBani: true, productUrl: true, storeName: true, lastObservedAt: true,
      merchant: { select: { slug: true } },
      product: { select: { name: true } },
    },
  });

  if (offers.length === 0) {
    console.error(`No live offers with a productUrl${only ? ` for ${only}` : ""}. Nothing to check — that is a FAILURE, not a pass.`);
    emitJson({ pass: false, reason: "no-candidates" });
    process.exit(1);
  }

  // ── THE SAMPLE. Weighted toward the largest merchants, as briefed, but with a FLOOR so a
  // small merchant is never invisible: a merchant we never check is a merchant we know nothing
  // about, and "weighted" must not collapse into "only the big two".
  const byMerchant = new Map<string, typeof offers>();
  for (const o of offers) {
    if (nullProductUrlIsExpected(o.merchant.slug)) continue;
    const l = byMerchant.get(o.merchant.slug) ?? [];
    l.push(o);
    byMerchant.set(o.merchant.slug, l);
  }
  const total = [...byMerchant.values()].reduce((a, l) => a + l.length, 0);
  const merchants = [...byMerchant.entries()].sort((a, b) => b[1].length - a[1].length);

  const picked: typeof offers = [];
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  for (const [slug, list] of merchants) {
    const share = Math.round((list.length / total) * n);
    const want = Math.max(1, Math.min(share, list.length));
    list.sort((a, b) => a.id - b.id);
    // Rotate by date so consecutive nights cover different products.
    const start = (dayIndex * want) % list.length;
    for (let i = 0; i < want && picked.length < n + merchants.length; i++) {
      picked.push(list[(start + i) % list.length]);
    }
    void slug;
  }
  const sample = picked.slice(0, n);

  console.log("═".repeat(104));
  console.log(`LIVE PRICE COMPARISON — our stored price against the shop's own page, fetched now`);
  console.log(`${sample.length} offers · ${merchants.length} merchants · structured data only, no scraper selectors`);
  console.log("═".repeat(104));

  const rows: Row[] = [];
  for (const o of sample) {
    const url = o.productUrl as string;
    const ourBani = o.priceBani ?? Math.round(o.price * 100);
    const ageDays = (Date.now() - new Date(o.lastObservedAt ?? Date.now()).getTime()) / 86_400_000;
    const base: Omit<Row, "outcome" | "note" | "theirBani" | "theirSource"> = {
      offerId: o.id, merchant: o.merchant.slug, product: o.product.name,
      storeName: o.storeName, url, ourBani, observedAgeDays: Number(ageDays.toFixed(1)),
    };

    if (!(await allowedByRobots(url))) {
      rows.push({ ...base, theirBani: null, theirSource: null, outcome: "SKIPPED", note: "robots.txt disallows this path" });
      console.log(`  ⊘ ${o.merchant.slug.padEnd(14)} robots.txt — skipped`);
      continue;
    }

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let html = "";
    let status = 0;
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ro-RO,ro;q=0.9" }, signal: ctl.signal, redirect: "follow" });
      status = res.status;
      html = await res.text();
    } catch {
      status = 0;
    } finally {
      clearTimeout(timer);
    }

    if (status !== 200 || html.length < 500) {
      rows.push({ ...base, theirBani: null, theirSource: null, outcome: "UNREAD", note: status === 0 ? "network error or timeout" : `HTTP ${status}` });
      console.log(`  ? ${o.merchant.slug.padEnd(14)} ${status === 0 ? "network" : `HTTP ${status}`}`);
      await sleep(DELAY_MS);
      continue;
    }

    const candidates = publishedPriceStrings(html);
    const parsed = candidates
      .map((c) => ({ ...c, bani: parsePrice(c.raw) }))
      .filter((c): c is typeof c & { bani: number } => c.bani !== null && c.bani > 0);

    if (parsed.length === 0) {
      rows.push({ ...base, theirBani: null, theirSource: null, outcome: "UNREAD", note: "no structured price on the page" });
      console.log(`  ? ${o.merchant.slug.padEnd(14)} no structured price`);
      await sleep(DELAY_MS);
      continue;
    }

    // A page may publish several (variants, a strikethrough, a bundle). Take the one CLOSEST to
    // ours: this measure exists to find disagreement, and picking the furthest would manufacture
    // it. A real disagreement survives the most charitable reading.
    const best = parsed.reduce((a, b) => (Math.abs(b.bani - ourBani) < Math.abs(a.bani - ourBani) ? b : a));
    const agree = best.bani === ourBani;
    rows.push({
      ...base, theirBani: best.bani, theirSource: best.source,
      outcome: agree ? "AGREE" : "DISAGREE",
      note: agree ? "" : `${((best.bani - ourBani) / ourBani * 100).toFixed(1)}% vs ours`,
    });
    const lei = (b: number) => (b / 100).toFixed(2);
    console.log(`  ${agree ? "✓" : "✗"} ${o.merchant.slug.padEnd(14)} ours ${lei(ourBani).padStart(8)}   theirs ${lei(best.bani).padStart(8)}   ${agree ? "" : `(${rows[rows.length - 1].note})`}`);
    await sleep(DELAY_MS);
  }

  // ── REPORT, PER MERCHANT. An aggregate hides one source breaking while the rest hold.
  const lei = (b: number) => (b / 100).toFixed(2);
  const per = new Map<string, { agree: number; disagree: number; unread: number; skipped: number }>();
  for (const r of rows) {
    const e = per.get(r.merchant) ?? { agree: 0, disagree: 0, unread: 0, skipped: 0 };
    if (r.outcome === "AGREE") e.agree++;
    else if (r.outcome === "DISAGREE") e.disagree++;
    else if (r.outcome === "UNREAD") e.unread++;
    else e.skipped++;
    per.set(r.merchant, e);
  }

  console.log(`\n${"─".repeat(104)}`);
  console.log(`PER MERCHANT — the disagreement rate is our real price accuracy`);
  console.log("─".repeat(104));
  console.log(`  ${"merchant".padEnd(16)} ${"agree".padStart(6)} ${"DISAGREE".padStart(9)} ${"unread".padStart(7)} ${"skipped".padStart(8)}   accuracy`);
  for (const [m, e] of [...per.entries()].sort((a, b) => (b[1].agree + b[1].disagree) - (a[1].agree + a[1].disagree))) {
    const compared = e.agree + e.disagree;
    const acc = compared > 0 ? `${((e.agree / compared) * 100).toFixed(0)}% of ${compared}` : "not measured";
    console.log(`  ${m.padEnd(16)} ${String(e.agree).padStart(6)} ${String(e.disagree).padStart(9)} ${String(e.unread).padStart(7)} ${String(e.skipped).padStart(8)}   ${acc}`);
  }

  const compared = rows.filter((r) => r.outcome === "AGREE" || r.outcome === "DISAGREE").length;
  const disagreed = rows.filter((r) => r.outcome === "DISAGREE");
  const unread = rows.filter((r) => r.outcome === "UNREAD").length;
  const skipped = rows.filter((r) => r.outcome === "SKIPPED").length;

  console.log(`\n  COMPARED ${compared} of ${rows.length}.  ${unread} unread, ${skipped} skipped by robots.txt.`);
  console.log(`  UNREAD IS NOT AGREEMENT. The accuracy figure above is over what could be compared,`);
  console.log(`  and ${unread + skipped} offers contributed nothing to it either way.`);
  if (compared > 0) {
    console.log(`\n  OVERALL: ${rows.filter((r) => r.outcome === "AGREE").length}/${compared} agree` +
      `  (${((rows.filter((r) => r.outcome === "AGREE").length / compared) * 100).toFixed(1)}%)`);
  }

  if (disagreed.length > 0) {
    console.log(`\n${"─".repeat(104)}`);
    console.log(`EVERY DISAGREEMENT — diagnose each; the categories are stale, promo ended, wrong match, parse error`);
    console.log("─".repeat(104));
    for (const r of disagreed) {
      console.log(`  offer ${r.offerId} [${r.merchant}]  ours ${lei(r.ourBani)}  theirs ${lei(r.theirBani ?? 0)}  ${r.note}`);
      console.log(`     observed ${r.observedAgeDays} days ago, read from ${r.theirSource}`);
      console.log(`     we say:   ${r.product.slice(0, 72)}`);
      console.log(`     they say: ${(r.storeName ?? "(no store name)").slice(0, 72)}`);
      console.log(`     ${r.url.slice(0, 96)}`);
    }
  }

  emitJson({
    sampled: rows.length, compared, unread, skipped,
    agree: rows.filter((r) => r.outcome === "AGREE").length,
    disagree: disagreed.length,
    accuracy: compared > 0 ? Number((rows.filter((r) => r.outcome === "AGREE").length / compared).toFixed(4)) : null,
    perMerchant: [...per.entries()].map(([merchant, e]) => ({ merchant, ...e })),
    disagreements: disagreed,
    rows,
    pass: true,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
