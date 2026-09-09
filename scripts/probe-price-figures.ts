// ── EXTERNAL ORACLE: THE PAGE SHOWS SEVERAL PRICES. WHAT DOES IT CALL THE ONE WE STORED?
//
// Four merchants have now been caught storing the wrong figure from a tile that showed several,
// each found separately, each treated as a new bug:
//
//   mega-image  a per-kilo price beside an approximate weight and a till price
//   penny       "preț fără PENNY card 22,99 · 1 BC 0,58 · preț cu PENNY card 17,99 · 1 BC 0,45"
//               — we stored the LAST: 0,45 lei for a pack costing 17,99
//   selgros     "per BUC." / "per kg" beside a price split across two <span>s
//   carrefour   "8 29 Lei 7 99 Lei" — a was-price and a current price, both split
//
// and CLAUDE.md records a fifth from before: DCNeu systematically reading the "Fără TVA" figure.
//
// ── WHY THE DATABASE CANNOT ANSWER THIS. `audit:price-figures` checks what it can and says so:
// `rawPriceText` holds WHAT THE SELECTOR REACHED. Penny's held all four figures until the
// selector was narrowed, and the narrowing that fixed the bug erased the evidence of it. A
// merchant whose selector is confidently too narrow looks identical to one whose page shows a
// single price. Only the page can tell those apart.
//
// ── THE QUESTION, ASKED THE SHARP WAY.
//
// Not "how many prices are on this page" — a product page has dozens, most belonging to other
// products. Instead: **find OUR stored price on the page and read the words around it.** If the
// page calls it "lei/kg", or "fără TVA", or "preț cu cardul", then what we are publishing as the
// price is not the price.
//
//   MATCHED_PACK      our figure appears with no qualifying label — the plain price
//   MATCHED_PER_UNIT  the page calls it a per-kilo/litre/piece price   ← the bug
//   MATCHED_NO_VAT    the page calls it the price without VAT          ← the bug
//   MATCHED_LOYALTY   the page calls it the loyalty-card price         ← arguably the bug
//   MATCHED_WAS       the page calls it a former price                 ← the bug
//   COINCIDES         a per-unit label attaches, but the pack IS one unit — no evidence
//   NOT_IN_HTML       the page renders its price in the browser        ← says nothing here
//   UNREAD            fetch failed, or robots.txt says no              ← measured nothing
//
// UNREAD is never a pass. A run that reads nothing is a failure.
//
// Politeness: one host at a time, 2s apart, robots.txt honoured before anything is fetched.
//
//   npm run probe:price-figures
//   npm run probe:price-figures -- --n=30 --merchant=carrefour

import { PrismaClient } from "@prisma/client";
import { allowedByRobots, PROBE_UA } from "../src/lib/net/robots";
import { nullProductUrlIsExpected } from "../src/lib/source-capabilities";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

const DEFAULT_N = 33; // 3 per merchant — the nightly budget; raise with --n for a deeper sweep
const DELAY_MS = 2_000;
const TIMEOUT_MS = 25_000;
const MAX_AGE = 14 * 86_400_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const lp = (s: string | number, n: number) => String(s).padStart(n);

/** Visible text, scripts and styles removed, entities decoded, whitespace collapsed. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/\s+/g, " ");
}

// ── WHAT THE PAGE CALLS *THIS* FIGURE. THE LABEL MUST ATTACH TO IT.
//
// The first version scanned a ±70-character window and flagged 18 of 30 pages. Every single one
// was a false positive, and reading them is what produced this rule:
//
//     Freshful   "…7,99 Lei Economisești 25% 5,99 Lei 66,56 Lei/kg…"   we store 5,99
//     Mega       "…8.62 Lei/L … 8.62 Lei/L 5 69 Lei + 0.5 Lei x 1 buc" we store 5,69
//     Sezamo     "…110 g 349,91 lei/kg 38 49 lei Adaugă…"              we store 38,49
//     Finestore  "…82 01 lei TVA inclus 67 78 lei fara TVA…"           we store 82,01
//
// In every one our figure is the right one and the qualifying label belongs to a DIFFERENT
// number sitting beside it. A window is not attachment. `66,56 Lei/kg` says nothing about 5,99.
//
// **A LABEL ATTACHES ONLY IF NO OTHER NUMBER SITS BETWEEN IT AND OUR FIGURE.** That single rule
// clears all four above and still catches the real shapes, which run in both directions:
//
//     after   "2,79 lei/l"                    the slash form — Sezamo, Mega, Freshful, Auchan
//     before  "1 BC 0,45 LEI" / "per kg 34 99" the label leads — Penny, Selgros
//
// A window that ignored direction and distance is how a check comes to fire on everything and
// mean nothing; CLAUDE.md already records that outcome for `audit:discriminator`.
const AFTER_LABELS: { kind: string; re: RegExp }[] = [
  { kind: "PER_UNIT", re: /^\s*(?:lei|ron)?\s*\/\s*(?:kg|l|buc|100\s*(?:g|ml))/i },
  { kind: "PER_UNIT", re: /^\s*(?:lei|ron)\s*\/\s*(?:kg|l|buc)/i },
  { kind: "NO_VAT", re: /^\s*(?:lei|ron)?\s*f[aă]r[aă]\s*TVA/i },
  { kind: "WITH_VAT", re: /^\s*(?:lei|ron)?\s*(?:cu\s*TVA|TVA\s*inclus)/i },
];

/**
 * A LABEL ENDING IN A COLON INTRODUCES THE NEXT FIGURE, NOT THE PREVIOUS ONE.
 *
 *     "24.69 Lei Fără TVA: 20.41 Lei"
 *
 * 24,69 is the price WITH VAT and 20,41 is the one without — the colon says so. Read as a
 * suffix, that text labels our correct 24,69 as a no-VAT figure and reports DCNeu as broken,
 * on the very merchant whose real historical defect was reading the "Fără TVA" number. A check
 * that reproduces the old bug's symptom on the fixed code is worse than no check.
 */
const INTRODUCES_NEXT = /:\s*$/;

const BEFORE_LABELS: { kind: string; re: RegExp }[] = [
  // "per kg 34 99" (Selgros) and "1 BC 0,45" / "1 KG 8,99" (Penny). The leading digit of
  // "1 KG" is part of the LABEL, so it is allowed to be the number that precedes.
  { kind: "PER_UNIT", re: /(?:per\s*(?:kg|buc|l)\.?|\b1\s*(?:KG|BC|L)\b|pe\s*kilogram)\s*$/i },
  // "preț CU cardul" is the loyalty price; "preț FĂRĂ card" is the shelf price and is what we
  // want. Distinguishing them is the difference between a finding and a false accusation.
  { kind: "LOYALTY", re: /\bcu\s+[\w]*\s*card\w*\s*$/i },
  { kind: "WAS", re: /(?:pre[tțţ]\s*vechi|[iî]n\s*loc\s*de|pre[tțţ]\s*anterior)\s*$/i },
  { kind: "OMNIBUS_30D", re: /30\s*(?:de\s*)?zile\s*:?\s*$/i },
  // "24.69 Lei Fără TVA: 20.41 Lei" — the colon form introduces the next figure, so from
  // 20,41's side the label is BEHIND it. This is the direction DCNeu's real defect had.
  { kind: "NO_VAT", re: /f[aă]r[aă]\s*TVA\s*:?\s*$/i },
];

/** Which price labels appear ANYWHERE on the page — the "how many kinds of figure" answer. */
const PAGE_LABELS: { kind: string; re: RegExp }[] = [
  { kind: "per-unit", re: /(?:lei|ron)\s*\/\s*(?:kg|l|buc)|per\s*(?:kg|buc|l)\b|\b1\s*(?:KG|BC)\b/i },
  { kind: "no-VAT", re: /f[aă]r[aă]\s*TVA/i },
  { kind: "with-VAT", re: /cu\s*TVA|TVA\s*inclus/i },
  { kind: "loyalty", re: /\bcard\b|fidelitate|abonat/i },
  { kind: "was", re: /pre[tțţ]\s*vechi|[iî]n\s*loc\s*de|economise[sșş]ti/i },
  { kind: "omnibus-30d", re: /30\s*(?:de\s*)?zile/i },
  { kind: "deposit", re: /garan[tțţ]ie|SGR\b/i },
];

/** Every way this amount could be written on a Romanian retail page. */
function renderings(bani: number): RegExp[] {
  const lei = Math.floor(bani / 100);
  const dec = String(bani % 100).padStart(2, "0");
  const esc = String(lei);
  return [
    new RegExp(`\\b${esc}[.,]${dec}\\b`),                      // 34,99  /  34.99
    new RegExp(`\\b${esc}\\s+${dec}\\s*(?:lei|ron)\\b`, "i"),  // 34 99 Lei — Selgros, Carrefour
    new RegExp(`\\b${esc}\\s*[.,]\\s+${dec}\\b`),              // 2 , 79 — Auchan's spacing
    // Selgros prints NO currency word anywhere on a card, so its split price has nothing to
    // anchor on and the pattern above cannot see it. Loose on purpose, and safe in the only
    // direction that matters: an unqualified occurrence always wins, so a spurious match reads
    // as MATCHED_PACK and can never manufacture a finding.
    new RegExp(`\\b${esc}\\s+${dec}\\b`),
  ];
}

type Outcome = "MATCHED_PACK" | "MATCHED_PER_UNIT" | "MATCHED_NO_VAT" | "MATCHED_LOYALTY"
  | "MATCHED_WAS" | "MATCHED_OTHER" | "COINCIDES" | "NOT_IN_HTML" | "UNREAD" | "SKIPPED";

/**
 * Find our figure in the page text and read what the page calls it. Pure, so
 * `tests/price-figures.test.ts` can run it over the exact strings the four known bugs produced
 * — a probe that reports zero findings and has never been shown to report one is indistinguishable
 * from a probe that cannot.
 *
 * `packIsOneUnit` collapses PER_UNIT to COINCIDES: a 1-litre bottle's price and its price per
 * litre are the same number, and no evidence about our correctness is available from it.
 */
export function classifyOurFigure(
  text: string,
  storedBani: number,
  packIsOneUnit: boolean,
): { outcome: Outcome; label: string | null; context: string | null } {
  const hits: number[] = [];
  for (const re of renderings(storedBani)) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(g)) hits.push(m.index ?? -1);
  }
  if (hits.length === 0) return { outcome: "NOT_IN_HTML", label: null, context: null };

  let best: { kind: string | null; ctx: string } | null = null;
  for (const at of hits.filter((h) => h >= 0)) {
    // BEFORE: back to the previous digit, capped — so a label two numbers away cannot reach.
    const beforeRaw = text.slice(Math.max(0, at - 30), at);
    const lastDigit = beforeRaw.search(/\d(?![\s\S]*\d)/);
    const before = lastDigit >= 0 ? beforeRaw.slice(lastDigit) : beforeRaw;
    // AFTER: forward to the next digit, capped.
    const afterRaw = text.slice(at, Math.min(text.length, at + 60)).replace(/^[\d.,\s]{1,10}/, "");
    const nextDigit = afterRaw.search(/\d/);
    const after = nextDigit >= 0 ? afterRaw.slice(0, nextDigit) : afterRaw.slice(0, 24);

    const hit = INTRODUCES_NEXT.test(after)
      ? BEFORE_LABELS.find((l) => l.re.test(before))
      : (AFTER_LABELS.find((l) => l.re.test(after)) ?? BEFORE_LABELS.find((l) => l.re.test(before)));
    const ctx = text.slice(Math.max(0, at - 42), Math.min(text.length, at + 34)).trim();
    const kind = hit ? hit.kind : null;
    // An unqualified occurrence settles it; otherwise keep the first qualified one.
    if (kind === null) { best = { kind: null, ctx }; break; }
    if (!best) best = { kind, ctx };
  }

  const kind = best?.kind ?? null;
  const outcome: Outcome =
    kind === "PER_UNIT" && packIsOneUnit ? "COINCIDES"
    : kind === null ? "MATCHED_PACK"
    : kind === "PER_UNIT" ? "MATCHED_PER_UNIT"
    : kind === "NO_VAT" ? "MATCHED_NO_VAT"
    : kind === "LOYALTY" ? "MATCHED_LOYALTY"
    : kind === "WAS" ? "MATCHED_WAS"
    // A with-VAT figure IS the price a Romanian shopper pays, so it is the right thing to have
    // stored. Only its absence of VAT is a defect.
    : kind === "WITH_VAT" ? "MATCHED_PACK"
    : "MATCHED_OTHER";
  return { outcome, label: kind, context: best?.ctx ?? null };
}

type Row = {
  offerId: number; merchant: string; product: string; url: string;
  storedBani: number; outcome: Outcome; label: string | null; context: string | null;
  otherKinds: string[]; packNote?: string;
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
    console.error(`probe:price-figures — unrecognised argument ${JSON.stringify(a)}. Refusing to run.`);
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
      id: true, priceBani: true, price: true, productUrl: true,
      merchant: { select: { slug: true } },
      product: { select: { name: true, unitSize: true, unit: true } },
    },
  });

  if (offers.length === 0) {
    console.error(`No live offers with a productUrl${only ? ` for ${only}` : ""}. Nothing checked — a FAILURE, not a pass.`);
    emitJson({ pass: false, reason: "no-candidates" });
    process.exit(1);
  }

  const byMerchant = new Map<string, typeof offers>();
  for (const o of offers) {
    if (nullProductUrlIsExpected(o.merchant.slug)) continue;
    const l = byMerchant.get(o.merchant.slug) ?? [];
    l.push(o);
    byMerchant.set(o.merchant.slug, l);
  }
  const merchants = [...byMerchant.entries()].sort((a, b) => b[1].length - a[1].length);
  const per = Math.max(1, Math.floor(n / Math.max(1, merchants.length)));
  const dayIndex = Math.floor(Date.now() / 86_400_000);

  const sample: typeof offers = [];
  for (const [, list] of merchants) {
    list.sort((a, b) => a.id - b.id);
    const want = Math.min(per, list.length);
    const start = (dayIndex * want) % list.length;
    for (let i = 0; i < want; i++) sample.push(list[(start + i) % list.length]);
  }

  console.log("═".repeat(104));
  console.log("PROBE: PRICE FIGURES — we found our price on the page. What does the page call it?");
  console.log(`${sample.length} pages across ${merchants.length} merchants, ${DELAY_MS}ms apart, robots.txt honoured`);
  console.log("═".repeat(104));

  const rows: Row[] = [];
  let lastHost = "";

  for (const o of sample) {
    const url = o.productUrl as string;
    const stored = o.priceBani ?? Math.round(o.price * 100);
    const host = (() => { try { return new URL(url).host; } catch { return ""; } })();
    if (host && host === lastHost) await sleep(DELAY_MS);
    lastHost = host;

    const base = {
      offerId: o.id, merchant: o.merchant.slug, product: o.product.name, url,
      storedBani: stored, label: null, context: null, otherKinds: [] as string[],
    };

    if (!(await allowedByRobots(url))) { rows.push({ ...base, outcome: "SKIPPED" }); continue; }

    let html = "";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, { headers: { "user-agent": PROBE_UA, "accept-language": "ro-RO,ro;q=0.9" }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) { rows.push({ ...base, outcome: "UNREAD", context: `HTTP ${res.status}` }); continue; }
      html = await res.text();
    } catch (e) {
      rows.push({ ...base, outcome: "UNREAD", context: String((e as Error).message).slice(0, 50) });
      continue;
    }

    const text = visibleText(html);

    // WHICH KINDS OF PRICE LABEL APPEAR ANYWHERE ON THIS PAGE — the "how many figures" answer.
    const otherKinds = PAGE_LABELS.filter((l) => l.re.test(text)).map((l) => l.kind);

    // Find OUR figure. EVERY occurrence is classified, not just the first: a page that prints
    // the same number twice — once plain and once as a per-kilo figure — would otherwise be
    // reported by whichever came first, which is a coin toss dressed as a measurement. The
    // least-alarming reading wins, because a figure that appears anywhere unqualified is a
    // figure the page does present as the price.
    const size = o.product.unitSize;
    const coincides = size != null && Math.abs(size - 1) < 0.001;
    const cls = classifyOurFigure(text, stored, coincides);

    rows.push({
      ...base,
      outcome: cls.outcome,
      label: cls.label,
      context: cls.outcome === "NOT_IN_HTML" ? `${text.length} chars of text, no price among them` : cls.context,
      otherKinds,
      packNote: coincides ? `pack is 1 ${o.product.unit ?? "unit"}, so pack and unit price are the same number` : undefined,
    });
  }

  const slugs = [...new Set(rows.map((r) => r.merchant))].sort();
  console.log(`\n  ${pad("merchant", 16)}${lp("pages", 6)}${lp("PACK", 6)}${lp("perUnit", 8)}${lp("noVAT", 7)}${lp("loyalty", 8)}${lp("was", 5)}${lp("1unit", 7)}${lp("notInHTML", 10)}${lp("unread", 7)}${lp("skip", 5)}`);
  console.log("  " + "─".repeat(96));
  for (const s of slugs) {
    const rs = rows.filter((r) => r.merchant === s);
    const c = (o: Outcome) => rs.filter((r) => r.outcome === o).length;
    console.log(
      `  ${pad(s, 16)}${lp(rs.length, 6)}${lp(c("MATCHED_PACK"), 6)}${lp(c("MATCHED_PER_UNIT"), 8)}` +
      `${lp(c("MATCHED_NO_VAT"), 7)}${lp(c("MATCHED_LOYALTY"), 8)}${lp(c("MATCHED_WAS"), 5)}` +
      `${lp(c("COINCIDES"), 7)}${lp(c("NOT_IN_HTML"), 8)}${lp(c("UNREAD"), 7)}${lp(c("SKIPPED"), 5)}`,
    );
  }

  console.log(`\n  WHICH PRICE LABELS EACH MERCHANT'S PAGE CARRIES AT ALL:`);
  for (const s of slugs) {
    const kinds = [...new Set(rows.filter((r) => r.merchant === s).flatMap((r) => r.otherKinds))].sort();
    console.log(`    ${pad(s, 16)} ${kinds.length > 0 ? kinds.join(", ") : "(none detected)"}`);
  }

  const bugs = rows.filter((r) => r.outcome.startsWith("MATCHED_") && r.outcome !== "MATCHED_PACK" && r.outcome !== "MATCHED_OTHER");
  if (bugs.length > 0) {
    console.log(`\n${"─".repeat(104)}`);
    console.log(`  OUR STORED PRICE CARRIES A QUALIFYING LABEL — the words around it, verbatim:`);
    console.log("─".repeat(104));
    for (const b of bugs.slice(0, 20)) {
      console.log(`\n  [${b.outcome}] ${b.merchant} #${b.offerId}  we store ${(b.storedBani / 100).toFixed(2)}`);
      console.log(`    ${b.product.slice(0, 74)}`);
      console.log(`    …${b.context}…`);
    }
  }

  const absent = rows.filter((r) => r.outcome === "NOT_IN_HTML");
  if (absent.length > 0) {
    console.log(`\n  OUR PRICE IS NOT ON THE PAGE AT ALL (${absent.length}) — stale, or a different figure:`);
    for (const a of absent.slice(0, 12)) {
      console.log(`    ${pad(a.merchant, 14)} #${a.offerId}  ${(a.storedBani / 100).toFixed(2)}  ${a.product.slice(0, 54)}`);
    }
  }

  const read = rows.filter((r) => r.outcome !== "UNREAD" && r.outcome !== "SKIPPED");
  console.log(`\n${"═".repeat(104)}`);
  if (read.length === 0) {
    console.log(`  INCONCLUSIVE — every page was unread or skipped. This run measured nothing.`);
    emitJson({ pass: false, reason: "nothing-read", rows });
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`  ${read.length} pages read. ${bugs.length} store a figure the page itself qualifies as`);
  console.log(`  something other than the price. ${absent.length} carry no price in their HTML at all.`);
  console.log("═".repeat(104));

  emitJson({
    pass: read.length > 0, sampled: sample.length, read: read.length,
    qualified: bugs.length, absent: absent.length,
    unread: rows.filter((r) => r.outcome === "UNREAD").length,
    skipped: rows.filter((r) => r.outcome === "SKIPPED").length,
    rows,
  });
  await prisma.$disconnect();
}

// Only run when invoked directly — `classifyOurFigure` above is imported by the offline test,
// and importing this file used to start a live crawl. CLAUDE.md's rule for scrapers ("a module
// must not run on import") applies to a probe for the same reason: the test run would fetch
// thirty merchant pages before failing on an argument it never passed.
const invokedDirectly = process.argv[1]
  ? process.argv[1].replace(/\\/g, "/").endsWith("probe-price-figures.ts")
  : false;
if (invokedDirectly) {
  main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
}
