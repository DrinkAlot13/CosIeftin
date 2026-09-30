// Who is signed in — asked for by the client, not baked into the page.
//
// WHY THIS EXISTS. The root layout's <Header> called `getCurrentUser()`, which reads a cookie.
// In Next 14 a `cookies()` call anywhere in the tree opts THE WHOLE ROUTE out of static
// generation, and the root layout is in every route — so all 32 pages of the site rendered
// dynamically, `revalidate = 3600` on seven of them had never once taken effect, and the build
// prerendered nothing but robots.txt and sitemap.xml.
//
// That was invisible: the pages worked, the numbers were right, and the only symptom was that
// every visitor paid for a fresh render. It is the same shape as the force-dynamic layout bug
// this file's neighbours describe — a declaration and the reality disagreeing with nothing to
// say which was true — except one component deeper, where the earlier fix did not look.
//
// So the session moves to a request the browser makes. The page is now the same for everyone
// and can be cached; the one part that differs per person arrives after paint.

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic"; // reads a cookie — correct here, and here only
export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json(
    { username: user?.username ?? null, isAdmin: user?.isAdmin ?? false },
    // Per-user and never shared. A cached response here would show one visitor another's name.
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
