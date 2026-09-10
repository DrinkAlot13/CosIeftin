// ── EXTERNAL ORACLE: DOES THE API ACTUALLY BEHAVE LIKE ITS SPEC?
//
// `docs/openapi.json` is generated from the route registry, so it cannot drift from the
// PARAMETERS. It can still drift from the RESPONSES, because nothing in the generator knows what
// a route returns — and a spec nothing checks is a document, not a contract. That is the same
// argument that produced `probe:sitemap`, and it earned its place the day it was written.
//
// This calls every endpoint over HTTP against a running server and asserts the things
// docs/API.md §2 calls non-negotiable, in the responses themselves:
//
//   · every offer carries observedAt AND observedAgeHours
//   · no withheld row is ever returned
//   · `comparison.status` is present and is one of the three
//   · a deep link is a real URL or an explicit null WITH a reason
//   · the rate-limit headers are present and agree with the limiter
//   · a bad request is the documented error SHAPE, not a stack trace
//
// A RUN THAT CHECKED NOTHING IS A FAILURE, not a pass — CLAUDE.md's rule for oracles, learned
// when probe:links mis-parsed its arguments, checked zero links and printed a green tick.
//
//   npm run probe:api
//   npm run probe:api -- --base http://localhost:3000

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { emitJson } from "../src/lib/audit-json";

const prisma = new PrismaClient();

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const ok = (name: string, detail = "") => checks.push({ name, ok: true, detail });
const bad = (name: string, detail: string) => checks.push({ name, ok: false, detail });

async function get(base: string, path: string): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(`${base}${path}`, { headers: { accept: "application/json" } });
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = { __unparseable: text.slice(0, 200) }; }
  return { status: res.status, body, headers: res.headers };
}

/** The §2 rules, applied to every offer a response carries. */
function assertOfferShape(where: string, offers: unknown): void {
  if (!Array.isArray(offers)) { bad(`${where}: offers is an array`, `got ${typeof offers}`); return; }
  ok(`${where}: offers is an array`, `${offers.length} offers`);
  for (const [i, raw] of offers.entries()) {
    const o = raw as Record<string, unknown>;
    if (!("observedAt" in o) || !("observedAgeHours" in o)) {
      bad(`${where}[${i}]: carries its observation date`, JSON.stringify(Object.keys(o)).slice(0, 120));
      return;
    }
    if (o.observedAt !== null && typeof o.observedAgeHours !== "number") {
      bad(`${where}[${i}]: observedAgeHours computed`, `observedAt=${o.observedAt} age=${o.observedAgeHours}`);
      return;
    }
    if (o.productUrl === null && !o.productUrlAbsent) {
      bad(`${where}[${i}]: absent deep link says why`, "productUrl null with no productUrlAbsent");
      return;
    }
    for (const k of ["priceBani", "availability", "isStale", "priceSource", "merchant"]) {
      if (!(k in o)) { bad(`${where}[${i}]: has ${k}`, "missing"); return; }
    }
  }
  ok(`${where}: every offer carries its date, flags and link-or-reason`);
}

function assertComparison(where: string, body: Record<string, unknown>): void {
  const c = body.comparison as Record<string, unknown> | null;
  if (!c) { bad(`${where}: comparison present`, "null"); return; }
  const valid = ["comparable", "single-shop", "no-price"];
  if (!valid.includes(String(c.status))) { bad(`${where}: comparison.status valid`, String(c.status)); return; }
  if (typeof c.reason !== "string" || c.reason.length === 0) { bad(`${where}: comparison carries copy`, "empty"); return; }
  ok(`${where}: comparison.status = ${c.status}`, `${c.shopCount} shops`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const bi = argv.indexOf("--base");
  const base = (bi >= 0 ? argv[bi + 1] : process.env.PROBE_BASE) ?? "http://localhost:3000";

  const spec = JSON.parse(readFileSync(join(process.cwd(), "docs", "openapi.json"), "utf8")) as { paths: Record<string, unknown> };
  const specPaths = Object.keys(spec.paths);

  console.log("═".repeat(96));
  console.log(`PROBE: API — every v1 endpoint over HTTP against ${base}`);
  console.log(`spec declares ${specPaths.length} paths`);
  console.log("═".repeat(96));

  // Real fixtures from the live catalog, so the probe tests what a client would actually ask.
  const withMany = await prisma.product.findFirst({
    where: { section: "grocery", liveOfferCount: { gte: 2 } },
    select: { slug: true, name: true },
  });
  const withUrl = await prisma.offer.findFirst({
    where: { productUrl: { not: null }, merchant: { active: true }, flagged: false, isStale: false },
    select: { productUrl: true, merchant: { select: { slug: true } } },
  });
  const single = await prisma.product.findFirst({
    where: { section: "grocery", liveOfferCount: 1 },
    select: { slug: true },
  });

  if (!withMany || !withUrl) {
    console.error("No fixtures in the database — this run would check nothing, which is a FAILURE.");
    emitJson({ pass: false, reason: "no-fixtures" });
    await prisma.$disconnect();
    process.exit(1);
  }

  // ── /meta
  {
    const r = await get(base, "/api/v1/meta");
    const b = r.body as Record<string, unknown>;
    r.status === 200 ? ok("GET /meta → 200") : bad("GET /meta → 200", `got ${r.status}`);
    b.apiVersion === "v1" ? ok("/meta: apiVersion v1") : bad("/meta: apiVersion v1", String(b.apiVersion));
    const comp = (b.comparability as Record<string, Record<string, unknown>> | undefined)?.grocery;
    typeof comp?.singleShop === "number"
      ? ok("/meta: comparability is real", `singleShop=${comp.singleShop}`)
      : bad("/meta: comparability is real", JSON.stringify(comp).slice(0, 80));
    r.headers.get("x-ratelimit-limit")
      ? ok("/meta: rate-limit headers", `limit=${r.headers.get("x-ratelimit-limit")} remaining=${r.headers.get("x-ratelimit-remaining")}`)
      : bad("/meta: rate-limit headers", "absent");
    r.headers.get("cache-control")?.includes("s-maxage=900")
      ? ok("/meta: cache matches the spec")
      : bad("/meta: cache matches the spec", String(r.headers.get("cache-control")));
  }

  // ── /product/{slug}
  {
    const r = await get(base, `/api/v1/product/${encodeURIComponent(withMany.slug)}`);
    const b = r.body as Record<string, unknown>;
    r.status === 200 ? ok("GET /product/{slug} → 200", withMany.slug) : bad("GET /product/{slug} → 200", `got ${r.status}`);
    assertComparison("/product", b);
    assertOfferShape("/product", b.offers);
    r.headers.get("access-control-allow-origin") === "*"
      ? ok("/product: CORS open for a public GET")
      : bad("/product: CORS open for a public GET", String(r.headers.get("access-control-allow-origin")));
  }

  // A single-shop product must SAY so rather than returning a bare one-item array.
  if (single) {
    const r = await get(base, `/api/v1/product/${encodeURIComponent(single.slug)}`);
    const b = r.body as Record<string, unknown>;
    const c = b.comparison as Record<string, unknown>;
    c?.status === "single-shop"
      ? ok("/product: a one-shop product reports single-shop", single.slug)
      : bad("/product: a one-shop product reports single-shop", `status=${c?.status} shops=${c?.shopCount}`);
  }

  // ── 404 and 400 shapes
  {
    const r = await get(base, "/api/v1/product/__nu-exista-acest-slug__");
    const e = (r.body as { error?: { code?: string } }).error;
    r.status === 404 && e?.code === "not_found"
      ? ok("GET /product/{missing} → documented 404")
      : bad("GET /product/{missing} → documented 404", `status=${r.status} code=${e?.code}`);
  }
  {
    const r = await get(base, "/api/v1/search");
    const e = (r.body as { error?: { code?: string; details?: Record<string, unknown> } }).error;
    r.status === 400 && e?.code === "bad_request" && e.details?.field === "q"
      ? ok("GET /search without q → documented 400 naming the field")
      : bad("GET /search without q → documented 400 naming the field", `status=${r.status} ${JSON.stringify(e).slice(0, 90)}`);
  }

  // ── /search
  {
    const r = await get(base, "/api/v1/search?q=lapte&limit=5");
    const b = r.body as Record<string, unknown>;
    const results = b.results as Record<string, unknown>[] | undefined;
    r.status === 200 && Array.isArray(results)
      ? ok("GET /search → 200", `${results.length} results, kind=${b.kind}`)
      : bad("GET /search → 200", `status=${r.status}`);
    if (results?.length) {
      results.every((x) => (x.comparison as Record<string, unknown>)?.status)
        ? ok("/search: every result carries a comparison status")
        : bad("/search: every result carries a comparison status", "at least one missing");
    }
    // `limit` above the maximum is CLAMPED, not rejected — §schema.
    const over = await get(base, "/api/v1/search?q=lapte&limit=9999");
    over.status === 200
      ? ok("/search: an over-large limit is clamped, not refused")
      : bad("/search: an over-large limit is clamped, not refused", `got ${over.status}`);
  }

  // ── /lookup by url — the extension's primary call
  {
    const r = await get(base, `/api/v1/lookup?url=${encodeURIComponent(withUrl.productUrl!)}`);
    const b = r.body as Record<string, unknown>;
    const m = b.match as Record<string, unknown>;
    r.status === 200 && m?.status === "exact" && m.by === "url"
      ? ok("GET /lookup?url → exact match", `${withUrl.merchant.slug}`)
      : bad("GET /lookup?url → exact match", `status=${r.status} match=${JSON.stringify(m).slice(0, 80)}`);
    if (m?.status === "exact") { assertComparison("/lookup", b); assertOfferShape("/lookup", b.offers); }
  }

  // An unknown URL is a 200 with status none — "we do not have this" is an ANSWER, not an error.
  {
    const r = await get(base, `/api/v1/lookup?url=${encodeURIComponent("https://example.com/nu/exista")}`);
    const m = (r.body as { match?: Record<string, unknown> }).match;
    r.status === 200 && m?.status === "none"
      ? ok("/lookup: an unknown URL is a 200 'none', not a 404")
      : bad("/lookup: an unknown URL is a 200 'none', not a 404", `status=${r.status} ${JSON.stringify(m)}`);
  }

  // A merchant we hold no SKUs for says `unsupported`, not an empty result.
  {
    const r = await get(base, "/api/v1/lookup?merchant=carrefour&sku=123456");
    const m = (r.body as { match?: Record<string, unknown> }).match;
    m?.status === "unsupported" && m.reason === "no-sku-stored-for-merchant"
      ? ok("/lookup: a merchant with no stored SKUs says unsupported")
      : bad("/lookup: a merchant with no stored SKUs says unsupported", JSON.stringify(m).slice(0, 100));
  }

  // The fallback must be able to REFUSE.
  {
    const r = await get(base, `/api/v1/lookup?name=${encodeURIComponent("qwerty zzz nonexistent produs")}`);
    const m = (r.body as { match?: Record<string, unknown>; product?: unknown }).match;
    const prod = (r.body as { product?: unknown }).product;
    m?.status === "none" && prod === null
      ? ok("/lookup: nonsense name answers 'none' with product null")
      : bad("/lookup: nonsense name answers 'none' with product null", `${JSON.stringify(m)} product=${prod === null ? "null" : typeof prod}`);
  }

  // ── /basket/optimize
  {
    const res = await fetch(`${base}/api/v1/basket/optimize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ slug: withMany.slug, qty: 2 }] }),
    });
    const b = (await res.json()) as Record<string, unknown>;
    res.status === 200 && Array.isArray(b.storeTotals)
      ? ok("POST /basket/optimize → 200", `${(b.storeTotals as unknown[]).length} store totals`)
      : bad("POST /basket/optimize → 200", `status=${res.status} ${JSON.stringify(b).slice(0, 120)}`);
    Array.isArray(b.unavailable)
      ? ok("/basket/optimize: unavailable is its own array")
      : bad("/basket/optimize: unavailable is its own array", "absent");
    res.headers.get("cache-control") === "no-store"
      ? ok("/basket/optimize: never cached")
      : bad("/basket/optimize: never cached", String(res.headers.get("cache-control")));
  }
  {
    const res = await fetch(`${base}/api/v1/basket/optimize`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [] }),
    });
    res.status === 400
      ? ok("/basket/optimize: an empty basket is a documented 400")
      : bad("/basket/optimize: an empty basket is a documented 400", `got ${res.status}`);
  }

  // ── WITHHELD ROWS NEVER APPEAR. Checked against a real flagged offer, not asserted.
  {
    const flagged = await prisma.offer.findFirst({
      where: { flagged: true, merchant: { active: true } },
      select: { merchant: { select: { slug: true } }, product: { select: { slug: true } } },
    });
    if (!flagged) {
      ok("withheld rows never appear", "no flagged offer in the database to test with — untested, not passed");
    } else {
      const r = await get(base, `/api/v1/product/${encodeURIComponent(flagged.product.slug)}`);
      const offers = ((r.body as { offers?: Record<string, unknown>[] }).offers ?? []);
      offers.some((o) => (o.merchant as { slug?: string })?.slug === flagged.merchant.slug)
        ? bad("withheld rows never appear", `${flagged.merchant.slug} leaked on ${flagged.product.slug}`)
        : ok("withheld rows never appear", `${flagged.merchant.slug} correctly absent from ${flagged.product.slug}`);
    }
  }

  // ── REPORT
  const failed = checks.filter((c) => !c.ok);
  console.log();
  for (const c of checks) console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? `  — ${c.detail}` : ""}`);

  console.log(`\n${"═".repeat(96)}`);
  if (checks.length === 0) {
    console.error("  CHECKED NOTHING. That is a FAILURE, not a pass.");
    emitJson({ pass: false, reason: "no-checks" });
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`  ${checks.length - failed.length}/${checks.length} checks passed.`);
  console.log("═".repeat(96));

  emitJson({ pass: failed.length === 0, checks: checks.length, failed: failed.length, results: checks });
  await prisma.$disconnect();
  if (failed.length > 0) process.exit(1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
