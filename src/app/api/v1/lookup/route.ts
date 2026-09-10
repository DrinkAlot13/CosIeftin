// GET /api/v1/lookup — the extension's call. See docs/API.md §3.2–3.4.
//
// THREE KEYS, IN THE ORDER THE DATA SUPPORTS:
//
//   url          PRIMARY.   100% of live offers at 12 of 16 merchants.
//   merchant+sku SECONDARY. 19.9% overall, and 96% of those are DCNeu alone.
//   name+size    FALLBACK.  Runs the SAME `decide()` the ingestion path runs.
//
// The brief named `sku` primary; the measurement in docs/API.md §0 is why it is not.
import { type NextRequest } from "next/server";
import { apiError, apiGuard, apiOk, apiPreflight } from "@/lib/api/respond";
import { readParams } from "@/lib/api/schema";
import { LOOKUP_PARAMS } from "@/lib/api/routes";
import { merchantHasSkus, productById, productBySku, productByUrl } from "@/lib/api/queries";
import { prisma } from "@/lib/db";
import { AUTO_MATCH_THRESHOLD, REVIEW_THRESHOLD, decide, prep } from "@/lib/scrape-util";
import { parseSize } from "@/lib/ingest-core";
import { tokensRo } from "@/lib/text/normalizeRo";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight("public-get");
}

type Params = {
  url?: string; merchant?: string; sku?: string; name?: string; size?: string;
  includeDeliveryPlatform: boolean;
};

export async function GET(req: NextRequest) {
  const g = apiGuard("apiLookup", req);
  if (g.limited) return g.limited;
  const opts = { cache: { sMaxAge: 3600, swr: 86_400 }, rateLimit: g.budget };

  const p = readParams<Params>(LOOKUP_PARAMS, (n) => req.nextUrl.searchParams.get(n));
  if (!p.ok) return apiError("bad_request", p.message, { field: p.field }, opts);
  const { url, merchant, sku, name, size, includeDeliveryPlatform } = p.value;

  if (!url && !(merchant && sku) && !name) {
    return apiError(
      "bad_request",
      "Trebuie una dintre: url, merchant+sku, sau name (opțional cu size și merchant).",
      { expected: ["url", "merchant+sku", "name"] },
      opts,
    );
  }

  // ── 1. BY URL. Exact, then normalised. No score, no threshold: a URL names a row or it does not.
  if (url) {
    const hit = await productByUrl(url, includeDeliveryPlatform);
    if (!hit) {
      return apiOk({ match: { status: "none", by: "url", reason: "url-not-in-catalog" }, product: null, comparison: null, offers: [] }, opts);
    }
    return apiOk({ match: { status: "exact", by: "url", merchant: hit.merchant, confidence: 1 }, ...hit.payload }, opts);
  }

  // ── 2. BY SKU. Says `unsupported` where we hold none, rather than returning an empty result
  // that a client would read as "this product does not exist".
  if (merchant && sku) {
    if (!(await merchantHasSkus(merchant))) {
      return apiOk({
        match: { status: "unsupported", by: "sku", reason: "no-sku-stored-for-merchant", merchant },
        product: null, comparison: null, offers: [],
      }, opts);
    }
    const payload = await productBySku(merchant, sku, includeDeliveryPlatform);
    if (!payload) {
      return apiOk({ match: { status: "none", by: "sku", reason: "sku-not-found", merchant }, product: null, comparison: null, offers: [] }, opts);
    }
    return apiOk({ match: { status: "exact", by: "sku", merchant, confidence: 1 }, ...payload }, opts);
  }

  // ── 3. BY NAME + SIZE, through the REAL matcher.
  //
  // Not a second implementation: `prep` and `decide` are the functions ingestion uses, so the
  // extension gets exactly the answer the catalog would have given — including the refusals.
  // A parallel "API matcher" would be the restatement this project has paid for repeatedly, and
  // it would drift toward being more permissive, because nobody watching it would see the false
  // matches it published.
  const stSize = parseSize(`${name} ${size ?? ""}`.trim());
  const st = prep(name!, null, null);

  // Candidates by head-noun-ish token overlap, bounded. The full catalog is 56,609 rows and an
  // API call may not scan it.
  const tokens = tokensRo(`${name} ${size ?? ""}`).slice(0, 4);
  if (tokens.length === 0) {
    return apiOk({ match: { status: "none", by: "name+size", reason: "no-usable-tokens" }, product: null, comparison: null, offers: [] }, opts);
  }
  const candidates = await prisma.product.findMany({
    where: {
      AND: tokens.slice(0, 2).map((t) => ({ nameNorm: { contains: t } })),
      offers: { some: { merchant: { active: true }, flagged: false, isStale: false } },
    },
    select: { id: true, name: true, brand: true, ean: true, unit: true, unitSize: true, section: true },
    take: 200,
  });

  let best: { id: number; score: number; reason: string } | null = null;
  for (const c of candidates) {
    if (c.unitSize == null || !c.unit) continue;
    const cat = prep(c.name, c.brand, c.ean);
    const d = decide(cat, { unit: c.unit, unitSize: c.unitSize }, st, stSize, c.section);
    if (!best || d.score > best.score) best = { id: c.id, score: d.score, reason: d.reason };
  }

  const score = best?.score ?? 0;
  const status = score >= AUTO_MATCH_THRESHOLD ? "confident" : score >= REVIEW_THRESHOLD ? "review" : "none";

  // A `review`-grade match returns product: null. The client may say "posibil acesta"; WE do not
  // assert it. That is what makes "answer no confident match rather than guessing" real rather
  // than a sentence in a spec.
  if (status !== "confident" || !best) {
    return apiOk({
      match: { status, by: "name+size", score: Number(score.toFixed(3)), reason: best?.reason ?? "no-candidate", threshold: AUTO_MATCH_THRESHOLD },
      product: null, comparison: null, offers: [],
    }, opts);
  }

  const payload = await productById(best.id, includeDeliveryPlatform);
  if (!payload) {
    return apiOk({ match: { status: "none", by: "name+size", score: 0, reason: "candidate-vanished" }, product: null, comparison: null, offers: [] }, opts);
  }
  return apiOk({
    match: { status: "confident", by: "name+size", score: Number(score.toFixed(3)), reason: best.reason, threshold: AUTO_MATCH_THRESHOLD },
    ...payload,
  }, opts);
}
