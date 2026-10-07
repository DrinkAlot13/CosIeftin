// GET -> { publicKey: string | null } — the VAPID public key the browser needs to create a
// PushSubscription. Not a secret: it is how the browser's push service knows which site this
// subscription belongs to, the same role a client ID plays elsewhere.
import { NextResponse } from "next/server";
import { vapidPublicKey } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ publicKey: vapidPublicKey() });
}
