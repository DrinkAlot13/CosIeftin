// Drop the caches when the prices actually change.
//
// Called by `npm run revalidate` as the last step of the nightly, after the scrapers and after
// `compute:home`. Cache invalidation tied to the data changing, not to a clock — see
// lib/cache-tags.ts for why a timer is wrong at both ends.
//
// AUTHENTICATED, because an unauthenticated invalidation endpoint is a free way to make the
// site rebuild every page on demand. The secret is REVALIDATE_SECRET; without it set, the route
// refuses rather than defaulting to open. A missing secret is a configuration error, not
// permission.

import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { CATALOG_TAG, REVALIDATE_PATHS } from "@/lib/cache-tags";
import { resetSearchIndex, getSearchableCatalog, searchIndexStatus } from "@/lib/search/index-cache";
import { guard } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Rate-limited even though it is secret-gated: without this the secret can be brute-forced
  // at line speed, and a cache purge on every guess is its own denial of service.
  const limited = guard("write", req);
  if (limited) return limited;
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "REVALIDATE_SECRET is not set. Refusing to run an unauthenticated cache purge." },
      { status: 500 },
    );
  }
  const given = req.headers.get("x-revalidate-secret") ?? new URL(req.url).searchParams.get("secret");
  if (given !== secret) return NextResponse.json({ ok: false, error: "bad secret" }, { status: 401 });

  revalidateTag(CATALOG_TAG);
  // The search index is an in-process memo, not a Next cache entry, so revalidateTag cannot
  // reach it. Dropped here so a nightly that adds 5,800 products makes them searchable at once
  // rather than up to ten minutes later.
  resetSearchIndex();
  for (const p of REVALIDATE_PATHS) revalidatePath(p);
  // Every category page and every product page, by layout: these are generated on demand and
  // there are hundreds of them, so purging the whole subtree beats enumerating it.
  revalidatePath("/c/[slug]", "page");
  revalidatePath("/p/[slug]", "page");

  // ── AND REBUILD IT HERE, awaited, rather than leaving the bill for the first shopper.
  //
  // Dropping the index is instant; rebuilding it costs about 1.3 s. Whoever triggers that
  // rebuild waits for it, and after a purge that is whoever searches next — a real person, at
  // the worst possible moment, on a site that just got faster everywhere else. The nightly is
  // not in a hurry, so it pays instead.
  await getSearchableCatalog().catch(() => { /* a failed warm-up must not fail the purge */ });
  const idx = searchIndexStatus();

  return NextResponse.json({
    ok: true,
    searchIndex: { rebuilt: idx.cached, products: idx.size, buildMs: idx.buildMs },
    tag: CATALOG_TAG,
    paths: [...REVALIDATE_PATHS, "/c/[slug]", "/p/[slug]"],
    at: new Date().toISOString(),
  });
}
