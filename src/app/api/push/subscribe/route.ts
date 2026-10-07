// POST { endpoint, keys: { p256dh, auth } } -> subscribe the signed-in shopper's browser to
// push. Upserts on `endpoint` (unique) so re-subscribing the same browser (e.g. after
// re-granting permission) updates the row rather than leaving a dead duplicate — see
// PushSubscription's own schema comment.
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { guard } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function parseBody(raw: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const endpoint = typeof r.endpoint === "string" ? r.endpoint : "";
  const keys = r.keys as Record<string, unknown> | undefined;
  const p256dh = typeof keys?.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys?.auth === "string" ? keys.auth : "";
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

export async function POST(req: NextRequest) {
  const limited = guard("write", req);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Trebuie să fii autentificat." }, { status: 401 });

  const body = parseBody(await req.json().catch(() => null));
  if (!body) return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });

  await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    update: { userId: user.id, p256dh: body.p256dh, auth: body.auth },
    create: { userId: user.id, endpoint: body.endpoint, p256dh: body.p256dh, auth: body.auth },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const limited = guard("write", req);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Trebuie să fii autentificat." }, { status: 401 });

  const body = await req.json().catch(() => null) as { endpoint?: unknown } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });

  // Scoped to this user too, not just the endpoint — a signed-in shopper may only remove their
  // OWN subscriptions, even though endpoint alone would already be unique enough to find it.
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
  return NextResponse.json({ ok: true });
}
