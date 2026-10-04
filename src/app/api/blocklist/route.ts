// UserBlocklist had a working READ path (resolve.ts's isBuyable already excluded a blocked
// brand/product) and NO write path anywhere in the app — the table could only be populated by
// hand in the database. This is that write path.
//
//   GET                                    -> this shopper's blocklist
//   POST { brand } | { attributeTag }      -> add one
//   DELETE ?id=<id>                        -> remove one
//
// `attributeTag` is matched as a plain substring of a product's name (see resolve.ts) — NOT a
// verified allergen database, and the UI must never present it as one.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { guard } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ signedIn: false, items: [] });
  const items = await prisma.userBlocklist.findMany({
    where: { userId: user.id },
    select: { id: true, brand: true, attributeTag: true, productId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ signedIn: true, items });
}

export async function POST(req: NextRequest) {
  const limited = guard("write", req);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Trebuie să fii autentificat." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const brand = typeof body?.brand === "string" ? body.brand.trim().slice(0, 80) : null;
  const attributeTag = typeof body?.attributeTag === "string" ? body.attributeTag.trim().slice(0, 40) : null;
  if (!brand && !attributeTag) return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });

  const row = await prisma.userBlocklist.create({
    data: { userId: user.id, brand: brand || null, attributeTag: attributeTag || null },
  });
  return NextResponse.json({ ok: true, id: row.id });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Trebuie să fii autentificat." }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });
  // Scoped to this user's own rows — deleting by id alone would let one shopper remove another's.
  await prisma.userBlocklist.deleteMany({ where: { id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
