// Match-review queue actions. A human decision is persisted as a MatchOverride, which
// survives a full rebuild — the whole point: corrections must never be re-learned.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { slugify } from "@/lib/scrape-util";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { offerId?: number; action?: string; note?: string } | null;
  const offerId = Number(body?.offerId);
  const action = String(body?.action ?? "");
  if (!offerId || !["confirm", "reject", "clear"].includes(action)) {
    return NextResponse.json({ error: "offerId and action (confirm|reject|clear) required" }, { status: 400 });
  }

  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: { product: { select: { id: true, name: true } } },
  });
  if (!offer) return NextResponse.json({ error: "offer not found" }, { status: 404 });

  // storeKey must match what the scraper computes from the STORE product name. We only
  // have the catalog name here, so key on the offer URL path when present (stable), else slug.
  const storeKey = offer.url ? new URL(offer.url, "https://x.invalid").pathname.slice(0, 180) : slugify(offer.product.name);

  if (action === "clear") {
    await prisma.matchOverride.deleteMany({ where: { merchantId: offer.merchantId, storeKey } });
    await prisma.offer.update({ where: { id: offerId }, data: { flagged: false, flagReason: null } });
    return NextResponse.json({ ok: true, cleared: true });
  }

  await prisma.matchOverride.upsert({
    where: { merchantId_storeKey: { merchantId: offer.merchantId, storeKey } },
    update: { productId: offer.product.id, decision: action, note: body?.note ?? null },
    create: { merchantId: offer.merchantId, storeKey, productId: offer.product.id, decision: action, note: body?.note ?? null },
  });

  if (action === "confirm") {
    // trusted from now on
    await prisma.offer.update({ where: { id: offerId }, data: { flagged: false, flagReason: null, matchScore: 1, matchedBy: "override" } });
  } else {
    // rejected pairing — drop the bad offer so it stops showing a wrong price
    await prisma.priceHistory.deleteMany({ where: { offerId } });
    await prisma.offer.delete({ where: { id: offerId } }).catch(() => {});
  }
  return NextResponse.json({ ok: true, action, storeKey });
}
