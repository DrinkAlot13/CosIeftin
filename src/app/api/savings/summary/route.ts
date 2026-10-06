// GET -> { signedIn: boolean, monthBani: number } — this month's recorded savings for the
// signed-in shopper. Anonymous callers get signedIn:false rather than a 401: the counter is
// read-only and the honest answer for "no account" is "nothing to show", not an error.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { monthlySavingsBani } from "@/lib/savings";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ signedIn: false, monthBani: 0 });
  const monthBani = await monthlySavingsBani(user.id);
  return NextResponse.json({ signedIn: true, monthBani });
}
