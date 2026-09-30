// Download one nightly log file. Admin-only — a log can name real prices, merchant URLs and
// internal counts, none of which is for a signed-out visitor or an ordinary account.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readNightlyLog } from "@/lib/admin/logs";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const file = new URL(req.url).searchParams.get("file") ?? "";
  const content = readNightlyLog(file);
  if (content == null) return NextResponse.json({ error: "not found" }, { status: 404 });

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="nightly-${file}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
