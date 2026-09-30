// ── SCOPE: EXTERNAL ORACLE ────────────────────────────────────────────────────
// DO OUR STORED PRODUCT LINKS STILL RESOLVE? Asked over the network, not of ourselves.
//
// THIS IS A DIFFERENT CLASS OF CHECK FROM EVERY OTHER AUDIT IN THIS PROJECT.
//
// The eighteen defects catalogued so far were all INTERNAL INCONSISTENCY: two parts of our own
// system disagreeing, found by making them disagree out loud. `audit:db` compares rows against
// rules. `verify:counters` compares a page against its database. `audit:private-label-classes`
// compares an assigner's output against evidence the assigner did not use.
//
// None of them could have found Sezamo's 9,420 dead product links, because THERE WAS NO
// INTERNAL DISAGREEMENT. The scraper wrote `${BASE}/${slug}`. The pool contract saw a non-null
// string. `audit:db` checked the database and the database was not wrong — the WORLD was. The
// live path is `${BASE}/${id}-${slug}`, the same shape as the category paths, and every "vezi în
// magazin" button on our largest merchant by live products led to a 404.
//
// It was found by accident, while probing detail pages for EANs.
//
// A fact about the outside world can only be checked against the outside world. See CLAUDE.md,
// "SOME FACTS CAN ONLY BE CHECKED AGAINST THE WORLD".
//
// ── HOW IT SAMPLES, AND WHY NOT EXHAUSTIVELY.
//
// 46,000 live offers carry a product URL. Fetching all of them nightly would be both rude and
// pointless: a broken URL SCHEME breaks every link at that merchant at once, so fifty are as
// diagnostic as fifty thousand. The sample ROTATES by date, so a pattern that breaks only some
// URLs still surfaces within days instead of by accident.
//
//   npm run probe:links                     50 per merchant, rotating by today's date
//   npm run probe:links -- sezamo --n=20
//   npm run probe:links -- --json logs/links.json

import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";
import { SOURCE_CAPABILITIES, nullProductUrlIsExpected } from "../src/lib/source-capabilities";

const prisma = new PrismaClient();

/** Links sampled per merchant per run. Fifty is diagnostic for a scheme-wide break. */
const DEFAULT_SAMPLE = 50;
/** Above this share of dead links, a merchant is REPORTED AS BROKEN and the run exits non-zero. */
const FAIL_RATE = 0.04;
/** Below this many checked, a rate is not a rate — reported, never used as a verdict. */
const MIN_FOR_VERDICT = 10;
/** Politeness between requests to the same host. */
const DELAY_MS = 250;
const TIMEOUT_MS = 20_000;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CosMicLinkCheck/1.0 (+https://cosieftin.ro)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Outcome = "ok" | "redirected-ok" | "not-found" | "soft-404" | "server-error" | "network";

type Row = { url: string; status: number; finalUrl: string; outcome: Outcome };

/**
 * A REDIRECT THAT LANDS ON THE HOME PAGE IS A 404 WEARING A 200.
 *
 * Several Romanian retailers answer a dead product path with a 302 to `/` or to a search page,
 * so status alone says the link is fine. The tell is the SHAPE of where it landed: a product
 * page has a deep path, a soft 404 has almost none.
 */
function classify(status: number, requested: string, final: string): Outcome {
  if (status === 0) return "network";
  if (status === 404 || status === 410) return "not-found";
  if (status >= 500) return "server-error";
  if (status >= 400) return "not-found";
  const reqPath = safePath(requested);
  const finPath = safePath(final);
  if (reqPath === finPath) return "ok";
  // Landed somewhere shallow — the root, or a one-segment page — from a deeper product path.
  const finDepth = finPath.split("/").filter(Boolean).length;
  const reqDepth = reqPath.split("/").filter(Boolean).length;
  if (finDepth <= 1 && reqDepth >= 2) return "soft-404";
  return "redirected-ok";
}

function safePath(u: string): string {
  try { return new URL(u).pathname.replace(/\/+$/, ""); } catch { return u; }
}

/** Deterministic rotation: a different slice of each merchant's links every day. */
function offsetForToday(total: number, sample: number): number {
  if (total <= sample) return 0;
  const day = Math.floor(Date.now() / 86_400_000);
  return (day * sample) % total;
}

async function check(url: string): Promise<Row> {
  try {
    // GET rather than HEAD: several of these hosts answer HEAD with 405 or with a different
    // status than the one a browser would get, and the browser's answer is the one that matters.
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { url, status: res.status, finalUrl: res.url, outcome: classify(res.status, url, res.url) };
  } catch {
    return { url, status: 0, finalUrl: "", outcome: "network" };
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // `--json <path>` puts the PATH in its own argv slot, and a naive "anything without a leading
  // dash is a merchant name" filter swallowed it. The first run of this file therefore filtered
  // every merchant out, checked ZERO links, and printed a green tick — a check that reported
  // success and did nothing, which is the exact shape this file exists to catch.
  //
  // So: skip the value after a value-taking flag, AND refuse a name that matches no merchant.
  const VALUE_FLAGS = new Set(["--json"]);
  const want: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (VALUE_FLAGS.has(argv[i])) { i++; continue; }
    if (argv[i].startsWith("--")) continue;
    want.push(argv[i]);
  }
  const sample = Number((argv.find((a) => a.startsWith("--n=")) ?? `--n=${DEFAULT_SAMPLE}`).split("=")[1]);

  const merchants = await prisma.merchant.findMany({ where: { active: true }, select: { id: true, slug: true, name: true }, orderBy: { slug: "asc" } });

  const known = new Set(merchants.map((m) => m.slug));
  const unknown = want.filter((w) => !known.has(w));
  if (unknown.length) {
    console.error(`No such active merchant: ${unknown.join(", ")}`);
    console.error(`Known: ${[...known].join(", ")}`);
    process.exit(2);
  }

  console.log("═".repeat(104));
  console.log(`STORED PRODUCT LINKS, CHECKED AGAINST THE WORLD — ${sample} per merchant, rotating by date`);
  console.log("═".repeat(104));
  console.log(`  ${"merchant".padEnd(16)} ${"live".padStart(7)} ${"checked".padStart(8)} ${"ok".padStart(5)} ${"redir".padStart(6)} ${"404".padStart(5)} ${"soft".padStart(5)} ${"5xx".padStart(4)} ${"net".padStart(4)} ${"dead%".padStart(7)}  verdict`);

  const perMerchant: Record<string, unknown>[] = [];
  const broken: string[] = [];

  for (const m of merchants) {
    if (want.length && !want.includes(m.slug)) continue;

    const total = await prisma.offer.count({
      where: { merchantId: m.id, productUrl: { not: null }, isStale: false, availability: "in stock" },
    });

    if (total === 0) {
      // Distinguish "this source has none, and we declared that" from "we lost them".
      const expected = nullProductUrlIsExpected(m.slug);
      const note = expected
        ? `no product urls — expected: ${SOURCE_CAPABILITIES[m.slug]?.note ?? ""}`
        : SOURCE_CAPABILITIES[m.slug]
          ? "DECLARED to have product urls but carries NONE — that is a scraper gap, not a source limit"
          : "UNDECLARED merchant — add it to lib/source-capabilities.ts";
      console.log(`  ${m.slug.padEnd(16)} ${String(0).padStart(7)} ${"—".padStart(8)} ${"".padStart(5)} ${"".padStart(6)} ${"".padStart(5)} ${"".padStart(5)} ${"".padStart(4)} ${"".padStart(4)} ${"".padStart(7)}  ${note}`);
      perMerchant.push({ merchant: m.slug, live: 0, checked: 0, skipped: true, expected, note });
      if (!expected && SOURCE_CAPABILITIES[m.slug]) broken.push(`${m.slug}: declared to publish product urls, carries none`);
      continue;
    }

    const rows = await prisma.offer.findMany({
      where: { merchantId: m.id, productUrl: { not: null }, isStale: false, availability: "in stock" },
      select: { productUrl: true },
      orderBy: { id: "asc" },
      skip: offsetForToday(total, sample),
      take: sample,
    });

    const results: Row[] = [];
    for (const r of rows) {
      results.push(await check(r.productUrl!));
      await sleep(DELAY_MS);
    }

    const count = (o: Outcome) => results.filter((x) => x.outcome === o).length;
    const ok = count("ok"), redir = count("redirected-ok"), nf = count("not-found");
    const soft = count("soft-404"), srv = count("server-error"), net = count("network");
    // A 5xx is the shop having a bad minute, not our link being wrong. Counted, not blamed.
    const dead = nf + soft;
    const rate = results.length ? dead / results.length : 0;
    const verdict = results.length < MIN_FOR_VERDICT
      ? `${results.length} checked — too few for a rate`
      : rate > FAIL_RATE ? `BROKEN — ${(rate * 100).toFixed(0)}% of sampled links do not resolve` : "";

    console.log(`  ${m.slug.padEnd(16)} ${String(total).padStart(7)} ${String(results.length).padStart(8)} ${String(ok).padStart(5)} ${String(redir).padStart(6)} ${String(nf).padStart(5)} ${String(soft).padStart(5)} ${String(srv).padStart(4)} ${String(net).padStart(4)} ${(rate * 100).toFixed(1).padStart(6)}%  ${verdict}`);

    if (dead > 0) {
      for (const r of results.filter((x) => x.outcome === "not-found" || x.outcome === "soft-404").slice(0, 3)) {
        console.log(`      ${r.outcome === "soft-404" ? `${r.status} -> ${r.finalUrl}` : String(r.status)}  ${r.url}`);
      }
    }
    if (results.length >= MIN_FOR_VERDICT && rate > FAIL_RATE) broken.push(`${m.slug}: ${(rate * 100).toFixed(0)}% dead (${dead}/${results.length})`);

    perMerchant.push({
      merchant: m.slug, live: total, checked: results.length,
      ok, redirected: redir, notFound: nf, soft404: soft, serverError: srv, network: net,
      deadRate: Number(rate.toFixed(4)),
      samples: results.filter((x) => x.outcome === "not-found" || x.outcome === "soft-404").slice(0, 5).map((r) => ({ url: r.url, status: r.status, finalUrl: r.finalUrl })),
    });
  }

  console.log(`\n${"═".repeat(104)}`);
  const totalChecked = perMerchant.reduce((a, m) => a + Number(m.checked ?? 0), 0);
  if (totalChecked === 0) {
    // A RUN THAT FETCHED NOTHING IS NOT A CLEAN BILL OF HEALTH. Without this, an arg-parsing
    // slip (which is how the first version failed) prints the success line below and exits 0.
    console.log(`✗ NOTHING WAS CHECKED — no link was fetched, so nothing is known about any of`);
    console.log(`  them. This is a failure of the check, not a verdict on the links.`);
    process.exitCode = 1;
  } else if (broken.length === 0) {
    console.log(`✓ Every merchant's stored links resolve (${totalChecked} checked). A URL SCHEME that`);
    console.log(`  changes shows up here within days, because the sample rotates — not by accident.`);
  } else {
    console.log(`✗ ${broken.length} merchant(s) have links that do not resolve:`);
    for (const b of broken) console.log(`    ${b}`);
    console.log(`\n  A dead link is invisible to every check that reads the database, because the`);
    console.log(`  database is not wrong. Fix the URL the scraper BUILDS, then re-scrape.`);
    process.exitCode = 1;
  }

  emitJson({
    totalChecked,
    sampledPerMerchant: sample,
    failRateThreshold: FAIL_RATE,
    merchants: perMerchant,
    broken,
    pass: broken.length === 0 && totalChecked > 0,
  });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
