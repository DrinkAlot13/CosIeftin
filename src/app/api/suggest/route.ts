import { NextResponse, type NextRequest } from "next/server";
import { suggestProducts } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length < 2) return NextResponse.json([]);
  return NextResponse.json(await suggestProducts(q));
}
