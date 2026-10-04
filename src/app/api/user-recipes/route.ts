// Shopper-submitted recipes — an explicit opt-in public contribution, not a private list.
//
//   GET                                         -> public recipe listing (newest first)
//   POST { name, note?, ingredients: string[] } -> submit one
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { guard } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await prisma.userRecipe.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, name: true, note: true, ingredients: true, createdAt: true, user: { select: { username: true } } },
  });
  return NextResponse.json({
    recipes: rows.map((r) => ({
      id: r.id,
      name: r.name,
      note: r.note,
      ingredients: JSON.parse(r.ingredients) as string[],
      username: r.user.username,
      createdAt: r.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const limited = guard("write", req);
  if (limited) return limited;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Trebuie să fii autentificat." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { name?: unknown; note?: unknown; ingredients?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : null;
  const ingredients = Array.isArray(body?.ingredients)
    ? body.ingredients.filter((i): i is string => typeof i === "string" && i.trim().length > 0).map((i) => i.trim().slice(0, 80)).slice(0, 30)
    : [];
  if (!name || ingredients.length === 0) return NextResponse.json({ error: "Numele și cel puțin un ingredient sunt obligatorii." }, { status: 400 });

  const row = await prisma.userRecipe.create({
    data: { userId: user.id, name, note, ingredients: JSON.stringify(ingredients) },
  });
  return NextResponse.json({ ok: true, id: row.id });
}
