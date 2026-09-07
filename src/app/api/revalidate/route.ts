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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
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
  for (const p of REVALIDATE_PATHS) revalidatePath(p);
  // Every category page and every product page, by layout: these are generated on demand and
  // there are hundreds of them, so purging the whole subtree beats enumerating it.
  revalidatePath("/c/[slug]", "page");
  revalidatePath("/p/[slug]", "page");

  return NextResponse.json({
    ok: true,
    tag: CATALOG_TAG,
    paths: [...REVALIDATE_PATHS, "/c/[slug]", "/p/[slug]"],
    at: new Date().toISOString(),
  });
}
