// GET -> a downloadable JSON file of everything this account's data (GDPR Articles 15 & 20),
// self-serve. Calls the exact same `exportUserData` the `export:user` CLI script calls, so an
// admin exporting on request and a shopper clicking "download my data" can never disagree.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { exportUserData } from "@/lib/account-gdpr";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Trebuie să fii autentificat." }, { status: 401 });

  const payload = await exportUserData(user.id);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="cosieftin-${user.username}.json"`,
    },
  });
}
