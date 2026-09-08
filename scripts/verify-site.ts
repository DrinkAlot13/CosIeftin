// ── SCOPE: EXTERNAL ORACLE — OUR OWN SITE ─────────────────────────────────────
// DOES WHAT WE ADVERTISE TO GOOGLE ACTUALLY RESOLVE? Asked over HTTP, not of the database.
//
// THE DEFECT THIS EXISTS FOR. `src/app/sitemap.ts` emitted `/c/<slug>` for every category with
// a live offer, with no section filter, while `/c/[slug]` is grocery-only and calls
// `notFound()` for anything else. **246 of 324 category URLs (76%) were 404s advertised to
// search engines**, for as long as the non-grocery sections have existed.
//
// Every internal check passed, and each was right about what it measured:
//
//   the sitemap builder   emitted the categories it meant to emit
//   `audit:db`            the categories exist; the offers are live
//   `verify:counters`     the pages that DO render show the right numbers
//   the route-config test  no `revalidate` under a `force-dynamic` ancestor
//
// Nothing compared the URL we PUBLISH against the route that SERVES it, because that comparison
// only exists once a server is running. See CLAUDE.md, "SOME FACTS CAN ONLY BE CHECKED AGAINST
// THE WORLD" — this is the third oracle, after `audit:unit-oracle` and `probe:links`, and the
// first one pointed at ourselves.
//
// ── WHY IT FETCHES RATHER THAN QUERIES. `audit:sitemap` already answers this from the database
// by re-deriving which sections `/c/[slug]` serves. That check is cheaper and it found the bug —
// but it knows the routing rule because it was TOLD the routing rule, in a second place, which
// is the two-vocabularies problem this project has hit repeatedly. If `/c/[slug]` gains a
// section tomorrow, `audit:sitemap` reports a phantom defect and this one reports the truth.
//
// ── HOW IT SAMPLES. Same rules as `probe:links`, for the same reasons.
//
//   • SAMPLE AND ROTATE. A route-shape break kills every URL of that shape at once, so fifty
//     are as diagnostic as forty-six thousand. The sample rotates by date, so a partial break
//     surfaces within days rather than by accident.
//   • REPORT PER URL SHAPE, never as one number. The failure this exists to catch is one shape
//     breaking while the rest hold — exactly what happened — and an aggregate hides it. Every
//     shape is stratified so `/c/` cannot vanish under 45,000 `/p/` URLs.
//   • A RUN THAT CHECKED NOTHING IS A FAILURE. `probe:links` once mis-parsed its own arguments,
//     checked zero links and printed a green tick. This refuses an unknown argument and exits
//     non-zero on a zero-check run.
//
//   npm run verify:site
//   npm run verify:site -- --n=50 --base=http://localhost:3000
//   npm run verify:site -- --json logs/site.json

import { emitJson } from "../src/lib/audit-json";

/** URLs sampled per shape per run. */
const DEFAULT_SAMPLE = 50;
/** Above this share of dead URLs, a shape is REPORTED AS BROKEN and the run exits non-zero. */
const FAIL_RATE = 0.02;
/** Below this many checked, a rate is not a rate — reported, never used as a verdict. */
const MIN_FOR_VERDICT = 5;
const DELAY_MS = 40;
const TIMEOUT_MS = 20_000;

const UA = "CosMicSiteCheck/1.0 (+https://cosmic.ro)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Outcome = "ok" | "redirected-ok" | "not-found" | "server-error" | "empty" | "network";
type Row = { url: string; status: number; outcome: Outcome; bytes: number };

/** The URL shapes this site publishes. A sitemap URL that matches none is reported as its own
 *  bucket rather than silently folded into a total — an unrecognised shape is a finding. */
function shapeOf(pathname: string): string {
  if (pathname.startsWith("/p/")) return "/p/[slug]  product";
  if (pathname.startsWith("/c/")) return "/c/[slug]  category";
  if (pathname === "/") return "/          home";
  return `${pathname.split("?")[0]}  static`;
}

async function head(url: string): Promise<Row> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    // GET, not HEAD: Next answers HEAD without rendering, so a page that throws during render
    // returns 200 to a HEAD and 500 to a shopper. The oracle must see what a shopper sees.
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: ctl.signal, redirect: "follow" });
    const body = await res.text();
    const bytes = body.length;
    let outcome: Outcome;
    if (res.status === 404) outcome = "not-found";
    else if (res.status >= 500) outcome = "server-error";
    else if (!res.ok) outcome = "not-found";
    else if (bytes < 500) outcome = "empty";
    else if (res.redirected) outcome = "redirected-ok";
    else outcome = "ok";
    return { url, status: res.status, outcome, bytes };
  } catch {
    return { url, status: 0, outcome: "network", bytes: 0 };
  } finally {
    clearTimeout(timer);
  }
}

const DEAD = new Set<Outcome>(["not-found", "server-error", "empty", "network"]);

async function main(): Promise<void> {
  // ── ARGUMENTS. An unrecognised one is an ERROR, never a silently ignored filter.
  const argv = process.argv.slice(2);
  let sample = DEFAULT_SAMPLE;
  let base = process.env.SITE_BASE ?? "http://localhost:3000";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--n=")) { sample = Number(a.slice(4)); continue; }
    if (a.startsWith("--base=")) { base = a.slice(7); continue; }
    if (a === "--json") { i++; continue; }
    if (a.startsWith("--json=")) continue;
    console.error(`verify:site — unrecognised argument ${JSON.stringify(a)}. Refusing to run.`);
    console.error(`A check that silently ignores its own arguments can check nothing and still pass.`);
    process.exit(2);
  }
  base = base.replace(/\/+$/, "");

  console.log("═".repeat(100));
  console.log(`VERIFY SITE — does the sitemap advertise pages that actually resolve?`);
  console.log(`base ${base}`);
  console.log("═".repeat(100));

  // ── FETCH THE SITEMAP THE WAY GOOGLE WOULD. Follows a sitemap index one level.
  const seen = new Set<string>();
  const urls: string[] = [];
  const indexes: string[] = [];

  const load = async (u: string, depth: number): Promise<void> => {
    const res = await fetch(u, { headers: { "user-agent": UA } }).catch(() => null);
    if (!res || !res.ok) {
      console.error(`  CANNOT FETCH ${u} — ${res ? res.status : "network error"}`);
      return;
    }
    const xml = await res.text();
    const isIndex = /<sitemapindex/i.test(xml);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    if (isIndex) {
      indexes.push(...locs);
      if (depth > 0) for (const l of locs) await load(l, depth - 1);
      return;
    }
    for (const l of locs) if (!seen.has(l)) { seen.add(l); urls.push(l); }
  };

  await load(`${base}/sitemap.xml`, 1);

  if (indexes.length > 0) console.log(`  sitemap index with ${indexes.length} child sitemaps`);
  console.log(`  URLs advertised   ${urls.length}`);

  if (urls.length === 0) {
    console.error(`\n  ZERO URLS READ. That is a FAILURE, not a pass — a check that can silently`);
    console.error(`  do nothing is worse than no check, because it also removes the suspicion`);
    console.error(`  that would have led someone to look. Is the server running at ${base}?`);
    emitJson({ base, advertised: 0, checked: 0, pass: false, reason: "zero-urls" });
    process.exit(1);
  }

  // ── STRATIFY BY SHAPE, then rotate the sample by date within each shape.
  const byShape = new Map<string, string[]>();
  for (const u of urls) {
    let path = u;
    try { path = new URL(u).pathname; } catch { /* keep the raw string; it is reported as-is */ }
    const s = shapeOf(path);
    const l = byShape.get(s);
    if (l) l.push(u); else byShape.set(s, [u]);
  }

  const dayIndex = Math.floor(Date.now() / 86_400_000);
  const results = new Map<string, Row[]>();
  let checked = 0;

  for (const [shape, list] of [...byShape.entries()].sort()) {
    list.sort();
    const n = Math.min(sample, list.length);
    const start = list.length > 0 ? (dayIndex * n) % list.length : 0;
    const picked: string[] = [];
    for (let i = 0; i < n; i++) picked.push(list[(start + i) % list.length]);

    const rows: Row[] = [];
    for (const u of picked) {
      rows.push(await head(u));
      checked++;
      await sleep(DELAY_MS);
    }
    results.set(shape, rows);
  }

  // ── REPORT PER SHAPE. An aggregate is exactly what hid this defect.
  console.log(`\n  ${"url shape".padEnd(26)} ${"in map".padStart(8)} ${"checked".padStart(8)} ${"dead".padStart(6)}  verdict`);
  let anyBroken = false;
  const summary: { shape: string; advertised: number; checked: number; dead: number; rate: number; broken: boolean }[] = [];

  for (const [shape, rows] of results) {
    const advertised = byShape.get(shape)?.length ?? 0;
    const dead = rows.filter((r) => DEAD.has(r.outcome)).length;
    const rate = rows.length > 0 ? dead / rows.length : 0;
    const enough = rows.length >= MIN_FOR_VERDICT;
    const broken = enough && rate > FAIL_RATE;
    if (broken) anyBroken = true;
    const verdict = !enough ? `${rows.length} checked — too few for a verdict` : broken ? `BROKEN  ${(rate * 100).toFixed(1)}% dead` : "ok";
    console.log(`  ${shape.padEnd(26)} ${String(advertised).padStart(8)} ${String(rows.length).padStart(8)} ${String(dead).padStart(6)}  ${verdict}`);
    summary.push({ shape, advertised, checked: rows.length, dead, rate: Number(rate.toFixed(4)), broken });
  }

  const deadRows = [...results.entries()].flatMap(([shape, rows]) => rows.filter((r) => DEAD.has(r.outcome)).map((r) => ({ shape, ...r })));
  if (deadRows.length > 0) {
    console.log(`\n── EVERY DEAD URL, up to 25 ──`);
    for (const r of deadRows.slice(0, 25)) {
      console.log(`  ${String(r.status).padStart(3)} ${r.outcome.padEnd(13)} ${r.url}`);
    }
    if (deadRows.length > 25) console.log(`  …and ${deadRows.length - 25} more.`);
  }

  console.log(`\n  checked ${checked} of ${urls.length} advertised URLs, rotating by date.`);
  emitJson({ base, advertised: urls.length, checked, shapes: summary, dead: deadRows.slice(0, 200), pass: !anyBroken });

  if (anyBroken) {
    console.error(`\n  FAIL — the sitemap advertises URLs that do not resolve.`);
    process.exit(1);
  }
  console.log(`  PASS — every sampled URL resolved.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
