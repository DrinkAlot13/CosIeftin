// GET  -> { signedIn, monthlyLimitBani: number | null }
// PUT  { monthlyLimitBani: number | null } -> set or clear the signed-in shopper's monthly
// grocery budget. null clears it — the comparator works without one, same as every other
// account feature here (see Budget's own schema comment).
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { guard } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ signedIn: false, monthlyLimitBani: null });
  const row = await prisma.budget.findUnique({ where: { userId: user.id }, select: { monthlyLimitBani: true } });
  return NextResponse.json({ signedIn: true, monthlyLimitBani: row?.monthlyLimitBani ?? null });
}

export async function PUT(req: NextRequest) {
  const limited = guard("write", req);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Trebuie să fii autentificat." }, { status: 401 });

  const body = await req.json().catch(() => null) as { monthlyLimitBani?: unknown } | null;
  if (!body) return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });

  if (body.monthlyLimitBani === null) {
    await prisma.budget.deleteMany({ where: { userId: user.id } });
    return NextResponse.json({ ok: true, monthlyLimitBani: null });
  }

  const n = Number(body.monthlyLimitBani);
  // A budget of zero or less is not a budget, and an absurdly large one is almost certainly a
  // lei/bani unit mix-up at the call site — see CLAUDE.md's "units belong in the field name"
  // for exactly this failure shape. 1,000,000 lei/month is far past any real household budget.
  if (!Number.isFinite(n) || n <= 0 || n > 100_000_000) {
    return NextResponse.json({ error: "Buget invalid." }, { status: 400 });
  }
  const monthlyLimitBani = Math.round(n);
  await prisma.budget.upsert({
    where: { userId: user.id },
    update: { monthlyLimitBani },
    create: { userId: user.id, monthlyLimitBani },
  });
  return NextResponse.json({ ok: true, monthlyLimitBani });
}
