// GET /api/v1/product/{slug} — the item page as JSON. See docs/API.md §3.1.
import { type NextRequest } from "next/server";
import { apiError, apiGuard, apiOk, apiPreflight } from "@/lib/api/respond";
import { productBySlug } from "@/lib/api/queries";
import { readParams } from "@/lib/api/schema";
import { PRODUCT_PARAMS } from "@/lib/api/routes";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return apiPreflight("public-get");
}

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const g = apiGuard("apiRead", req);
  if (g.limited) return g.limited;
  const opts = { cache: { sMaxAge: 3600, swr: 86_400 }, rateLimit: g.budget };

  const p = readParams<{ includeDeliveryPlatform: boolean }>(PRODUCT_PARAMS, (n) => req.nextUrl.searchParams.get(n));
  if (!p.ok) return apiError("bad_request", p.message, { field: p.field }, opts);

  const payload = await productBySlug(params.slug, p.value.includeDeliveryPlatform);
  // A slug we do not have is a 404. A product we DO have with no current price is a 200 whose
  // comparison says `no-price` — it exists, and that is a different answer.
  if (!payload) return apiError("not_found", "Nu avem acest produs în catalog.", { slug: params.slug }, opts);
  return apiOk(payload, opts);
}
