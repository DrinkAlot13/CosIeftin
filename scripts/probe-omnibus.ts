// ── SCOPE: EXTERNAL ORACLE — DOES THE SHOP PUBLISH ITS 30-DAY MINIMUM, AND DO WE READ IT?
//
// `/reduceri-reale` rests on ONE number: the lowest price of the previous 30 days. EU Omnibus
// (OUG 34/2014 in Romania) obliges every retailer to print it beside any announced reduction,
// and `parsePrice` has carried an `OMNIBUS_30D` extractor since the beginning.
//
// The database holds **zero** of them. 770 reference prices exist and every one is a
// STRIKETHROUGH. That single fact has two completely different explanations, and they lead to
// opposite decisions:
//
//   A. THE SHOPS DO NOT PUBLISH IT on the pages we fetch — the figure appears only in the
//      cart, on the shelf label, or behind a click. Then the page cannot make its central
//      claim from the retailer's own words, and never will without a different source.
//
//   B. THE SHOPS DO PUBLISH IT and we never look — the scrapers read a price node and drop
//      the surrounding text. Then it is OUR gap, worth closing, and the page becomes
//      publishable the moment it is.
//
// No query can tell these apart. Both produce exactly the same empty column. See CLAUDE.md,
// "SOME FACTS CAN ONLY BE CHECKED AGAINST THE WORLD".
//
// ── WHAT MAKES IT AN ORACLE RATHER THAN A MIRROR.
//
// The PRESENCE test is a plain phrase search over the page's visible text, deliberately
// sharing nothing with `parsePrice`: a folded search for "30 de zile" and its cousins. If it
// used the parser's own regexes, a parser that cannot see the figure would report that the
// world does not publish it — the exact self-confirming loop this project has paid for before.
//
// The READ test then runs `parsePriceDetailed` — the project's ONE price parser, per CLAUDE.md
// — over the same text. Two independent answers, and the gap between them is the finding:
//
//   ABSENT     the phrase is not on the page          → explanation A, for that merchant
//   PARSED     phrase present, parser extracted it    → we could store it today
//   MISSED     phrase present, parser found nothing   → explanation B, and a parser bug
//   UNREAD     fetch failed, or robots.txt says no    → measured nothing; never a pass
//
// UNREAD is reported separately and never counted as anything. A run that reads nothing is a
// FAILURE, not a pass.
//
// ── POLITENESS. One host at a time, 2s apart, robots.txt fetched and honoured per merchant
// before anything else. A disallowed path is SKIPPED and reported as skipped, never fetched.
//
//   npm run probe:omnibus
//   npm run probe:omnibus -- --n=24 --merchant=carrefour
//   npm run probe:omnibus -- --json logs/omnibus.json

import { PrismaClient } from "@prisma/client";
import { parsePriceDetailed } from "../src/lib/price/parsePrice";

import { nullProductUrlIsExpected } from "../src/lib/source-capabilities";
import { emitJson } from "../src/lib/audit-json";
import { allowedByRobots, PROBE_UA } from "../src/lib/net/robots";

const prisma = new PrismaClient();

const DEFAULT_N = 24;
const DELAY_MS = 2_000;
const TIMEOUT_MS = 25_000;
const MAX_AGE = 14 * 86_400_000;
const UA = PROBE_UA;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// robots.txt handling lives in `src/lib/net/robots.ts`. There were two copies of it — this
// file's and probe-live-prices' — and `check:concepts` now names that module as the only one.

// ── THE PRESENCE TEST, sharing nothing with the parser ─────────────────────────────────────
//
// The wordings Romanian chains actually use, written to tolerate every diacritic form in one
// pattern: `preț` / `pret` / the cedilla variant `preţ` all match — the U+0219/U+015F trap
// CLAUDE.md names explicitly. Searching the ORIGINAL text rather than a folded copy, because
// the fold changes the string's length and a position in it does not map back.
const T = "[tțţ]";
const PHRASES: { name: string; re: RegExp }[] = [
  { name: "30 de zile", re: /30\s*(?:de\s*)?zile/i },
  { name: "pret minim", re: new RegExp(`pre${T}\\s*minim`, "i") },
  { name: "cel mai mic pret", re: new RegExp(`cel\\s*mai\\s*(?:mic|sc[aă]zut)\\s*pre${T}`, "i") },
];

// ── IS A REDUCTION EVEN ANNOUNCED ON THIS PAGE?
//
// Omnibus attaches to an ANNOUNCED reduction. A page with no promo on it owes no 30-day
// figure, so counting its silence as "the shop does not publish it" would be reading our own
// sampling choice back as a fact about the world. These split ABSENT into evidence and
// non-evidence.
//
// THIS HEURISTIC OVERCOUNTS AND THE NUMBER MUST BE READ AS AN UPPER BOUND. It scans the whole
// document, so a site-wide "Promoții" nav link marks every page on that site as announcing a
// reduction. Tightening it would need a per-merchant notion of "near the product", which is
// exactly the scraper-selector coupling that would turn this oracle back into a mirror.
//
// So PROMO_NO_OMNIBUS is soft evidence and is labelled as such. The POSITIVE finding — this
// merchant prints a 30-day figure and we store none of it — does not depend on it at all.
const PROMO_SIGNALS: { name: string; re: RegExp }[] = [
  { name: "struck price", re: /<\s*(?:del|s|strike)\b/i },
  { name: "reducere", re: /reducer[ei]|redus\b/i },
  { name: "percent off", re: /-\s*\d{1,2}\s*%/ },
  { name: "pret vechi", re: new RegExp(`pre${T}\\s*vechi|[iî]n\\s*loc\\s*de`, "i") },
  { name: "promo", re: /\bpromo(?:tie|ție|ţie)?\b/i },
];

/** Visible text of an HTML document, with scripts and styles removed and entities decoded. */
function visibleText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return stripped
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ");
}

/** Where the phrase appears, plus the surrounding text a parser would be handed. */
function findPhrase(text: string): { phrase: string; window: string } | null {
  for (const p of PHRASES) {
    const m = p.re.exec(text);
    if (!m) continue;
    // A real window around the REAL position. The phrase leads the value ("preț minim ultimele
    // 30 de zile: 6,99 LEI"), so the window leans forward.
    const lo = Math.max(0, m.index - 80);
    return { phrase: p.name, window: text.slice(lo, Math.min(text.length, m.index + 220)).trim() };
  }
  return null;
}

/** Which reduction signals the page carries, if any. */
function promoSignals(html: string, text: string): string[] {
  return PROMO_SIGNALS.filter((s) => s.re.test(html) || s.re.test(text)).map((s) => s.name);
}

type Outcome = "NO_PROMO" | "PROMO_NO_OMNIBUS" | "PARSED" | "MISSED" | "UNREAD" | "SKIPPED";

type Row = {
  offerId: number; merchant: string; product: string; url: string;
  outcome: Outcome; phrase: string | null; refBani: number | null;
  refKind: string | null; promo: string[]; note: string; window: string | null;
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
    console.error(`probe:omnibus — unrecognised argument ${JSON.stringify(a)}. Refusing to run.`);
    process.exit(2);
  }

  const cutoff = new Date(Date.now() - MAX_AGE);
  const offers = await prisma.offer.findMany({
    where: {
      merchant: { active: true, ...(only ? { slug: only } : {}) },
      availability: "in stock", isStale: false, flagged: false,
      lastObservedAt: { gte: cutoff }, productUrl: { not: null },
    },
    select: {
      id: true, productUrl: true, oldPrice: true, referencePriceBani: true,
      merchant: { select: { slug: true } }, product: { select: { name: true } },
    },
  });

  if (offers.length === 0) {
    console.error(`No live offers with a productUrl${only ? ` for ${only}` : ""}. Nothing to check — that is a FAILURE, not a pass.`);
    emitJson({ pass: false, reason: "no-candidates" });
    process.exit(1);
  }

  // ── THE SAMPLE. One per merchant as a floor, then weighted by size. A merchant we never
  // check is a merchant we know nothing about, and the question here is per-merchant.
  const byMerchant = new Map<string, typeof offers>();
  for (const o of offers) {
    if (nullProductUrlIsExpected(o.merchant.slug)) continue;
    const l = byMerchant.get(o.merchant.slug) ?? [];
    l.push(o);
    byMerchant.set(o.merchant.slug, l);
  }
  const merchants = [...byMerchant.entries()].sort((a, b) => b[1].length - a[1].length);
  const perMerchant = Math.max(1, Math.floor(n / Math.max(1, merchants.length)));
  const dayIndex = Math.floor(Date.now() / 86_400_000);

  const sample: typeof offers = [];
  for (const [, list] of merchants) {
    // PREFER OFFERS THAT ADVERTISE A REDUCTION. Omnibus attaches to an announced discount, so
    // a page with no promo on it legitimately carries no 30-day figure, and sampling those
    // would report "the world does not publish it" from pages where it is not owed.
    list.sort((a, b) => {
      const pa = a.oldPrice != null || a.referencePriceBani != null ? 0 : 1;
      const pb = b.oldPrice != null || b.referencePriceBani != null ? 0 : 1;
      return pa - pb || a.id - b.id;
    });
    const want = Math.min(perMerchant, list.length);
    const promoCount = list.filter((o) => o.oldPrice != null || o.referencePriceBani != null).length;
    // Rotate only within the non-promo tail, so the promo rows are always covered.
    for (let i = 0; i < want; i++) {
      const idx = i < promoCount ? i : promoCount + ((dayIndex + i) % Math.max(1, list.length - promoCount));
      sample.push(list[Math.min(idx, list.length - 1)]);
    }
  }

  console.log("═".repeat(104));
  console.log("PROBE: OMNIBUS — is the 30-day minimum on the page, and can our parser see it?");
  console.log(`${sample.length} pages across ${merchants.length} merchants, ${DELAY_MS}ms apart, robots.txt honoured`);
  console.log("═".repeat(104));

  const rows: Row[] = [];
  let lastHost = "";

  for (const o of sample) {
    const url = o.productUrl as string;
    const host = (() => { try { return new URL(url).host; } catch { return ""; } })();
    if (host && host === lastHost) await sleep(DELAY_MS);
    lastHost = host;

    const base = {
      offerId: o.id, merchant: o.merchant.slug, product: o.product.name, url,
      phrase: null, refBani: null, refKind: null, promo: [] as string[], window: null,
    };

    if (!(await allowedByRobots(url))) {
      rows.push({ ...base, outcome: "SKIPPED", note: "robots.txt disallows" });
      continue;
    }

    let html = "";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "ro-RO,ro;q=0.9" }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) {
        rows.push({ ...base, outcome: "UNREAD", note: `HTTP ${res.status}` });
        continue;
      }
      html = await res.text();
    } catch (e) {
      rows.push({ ...base, outcome: "UNREAD", note: String((e as Error).message).slice(0, 60) });
      continue;
    }

    const text = visibleText(html);
    const promo = promoSignals(html, text);
    const found = findPhrase(text);

    if (!found) {
      // SILENCE IS ONLY EVIDENCE WHERE A REDUCTION IS ANNOUNCED.
      rows.push({
        ...base, promo,
        outcome: promo.length > 0 ? "PROMO_NO_OMNIBUS" : "NO_PROMO",
        note: promo.length > 0 ? `announces [${promo.join(", ")}] with no 30-day figure` : `no reduction announced (${text.length} chars read)`,
      });
      continue;
    }

    // THE READ TEST. Our one parser, over the window the phrase sits in.
    const parsed = parsePriceDetailed(found.window);
    const gotOmnibus = parsed.referencePriceKind === "OMNIBUS_30D" && parsed.referencePriceBani != null;
    rows.push({
      ...base, promo,
      outcome: gotOmnibus ? "PARSED" : "MISSED",
      phrase: found.phrase,
      refBani: parsed.referencePriceBani ?? null,
      refKind: parsed.referencePriceKind ?? null,
      note: gotOmnibus ? "parser extracted it" : "phrase present, parser found no 30-day figure",
      window: found.window.slice(0, 240),
    });
  }

  // ── REPORT PER MERCHANT. The failure this exists to catch is one source differing from the
  // rest, and an aggregate hides exactly that.
  const slugs = [...new Set(rows.map((r) => r.merchant))].sort();
  console.log(`\n  ${"merchant".padEnd(16)}${"pages".padStart(6)}${"PARSED".padStart(8)}${"MISSED".padStart(8)}${"PROMO-".padStart(8)}${"noPromo".padStart(9)}${"UNREAD".padStart(8)}${"SKIP".padStart(6)}`);
  console.log(`  ${" ".repeat(38)}${"noOmni".padStart(8)}`);
  console.log("  " + "─".repeat(94));
  for (const s of slugs) {
    const rs = rows.filter((r) => r.merchant === s);
    const c = (o: Outcome) => rs.filter((r) => r.outcome === o).length;
    console.log(`  ${s.padEnd(16)}${String(rs.length).padStart(6)}${String(c("PARSED")).padStart(8)}${String(c("MISSED")).padStart(8)}${String(c("PROMO_NO_OMNIBUS")).padStart(8)}${String(c("NO_PROMO")).padStart(9)}${String(c("UNREAD")).padStart(8)}${String(c("SKIPPED")).padStart(6)}`);
  }
  console.log(`\n  PROMO-noOmni = a reduction IS announced and no 30-day figure appears. That column is`);
  console.log(`  the evidence. noPromo pages owe no such figure, so their silence proves nothing and`);
  console.log(`  is counted separately rather than folded into a rate.`);

  const read = rows.filter((r) => r.outcome !== "UNREAD" && r.outcome !== "SKIPPED");
  const publishes = rows.filter((r) => r.outcome === "PARSED" || r.outcome === "MISSED");
  const missed = rows.filter((r) => r.outcome === "MISSED");
  const owed = rows.filter((r) => r.outcome === "PROMO_NO_OMNIBUS" || r.outcome === "PARSED" || r.outcome === "MISSED");

  if (publishes.length > 0) {
    console.log(`\n${"─".repeat(104)}`);
    console.log("PAGES THAT CARRY THE PHRASE — the text, verbatim, so the parser gap is readable:");
    console.log("─".repeat(104));
    for (const r of publishes.slice(0, 14)) {
      console.log(`\n  [${r.outcome}] ${r.merchant}  #${r.offerId}  ${r.product.slice(0, 52)}`);
      console.log(`    phrase "${r.phrase}"  parsed ${r.refBani ?? "—"} (${r.refKind ?? "—"})`);
      console.log(`    ...${(r.window ?? "").replace(/\s+/g, " ").slice(0, 200)}...`);
    }
  }

  console.log(`\n${"═".repeat(104)}`);
  if (read.length === 0) {
    console.log("  VERDICT: INCONCLUSIVE — every page was unread or skipped. This run measured nothing.");
    emitJson({ pass: false, reason: "nothing-read", rows });
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`  ${read.length} pages read.  ${owed.length} announce a reduction; of those ${publishes.length} print a 30-day figure.`);
  if (publishes.length > 0) {
    const who = [...new Set(publishes.map((r) => r.merchant))].sort();
    console.log(`\n  PUBLISHED BY: ${who.join(", ")} — and we store ZERO OMNIBUS_30D values for any of`);
    console.log(`  them. The figure is on the page; the scraper does not keep it. That is OUR gap,`);
    console.log(`  and it is the difference between /reduceri-reale citing the retailer's own sworn`);
    console.log(`  number and citing only our own five weeks of history.`);
  }
  if (missed.length > 0) {
    console.log(`\n  ${missed.length} pages print it and our parser did not extract it — a second, separate gap.`);
    console.log(`  Read the windows above before touching the extractor.`);
  }
  if (owed.length === 0) {
    console.log(`\n  INCONCLUSIVE ON THE MAIN QUESTION: not one sampled page announced a reduction, so`);
    console.log(`  none owed a 30-day figure. This says nothing about whether the shops publish one.`);
  }
  console.log("═".repeat(104));

  emitJson({
    pass: read.length > 0, sampled: sample.length, read: read.length,
    owed: owed.length, publishes: publishes.length,
    parsed: rows.filter((r) => r.outcome === "PARSED").length,
    missed: missed.length,
    promoNoOmnibus: rows.filter((r) => r.outcome === "PROMO_NO_OMNIBUS").length,
    noPromo: rows.filter((r) => r.outcome === "NO_PROMO").length,
    unread: rows.filter((r) => r.outcome === "UNREAD").length,
    skipped: rows.filter((r) => r.outcome === "SKIPPED").length,
    rows,
  });
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
