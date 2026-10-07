// POST { password } -> delete the signed-in account and everything attached to it (GDPR
// Article 17), self-serve. Calls the exact same `eraseUserAccount` the `erase:user` CLI script
// calls — see src/lib/account-gdpr.ts for what is and is not deleted, and why.
//
// REQUIRES THE PASSWORD AGAIN, not just an active session. Deleting your own account from a
// web button is irreversible, and a session cookie alone is also what a stolen-but-still-valid
// session already has — the same reasoning a bank re-asks for a password before a transfer,
// not before a balance check. `limitAuth`-style rate limiting applies via the shared `guard`.
import { NextResponse, type NextRequest } from "next/server";
import { clearSession, getCurrentUser, verifyPassword } from "@/lib/auth";
import { eraseUserAccount } from "@/lib/account-gdpr";
import { guard } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const limited = guard("login", req); // same tight bucket as a sign-in attempt
  if (limited) return limited;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Trebuie să fii autentificat." }, { status: 401 });

  const body = await req.json().catch(() => null) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!password) return NextResponse.json({ error: "Parola este obligatorie." }, { status: 400 });

  const withHash = await prisma.user.findUnique({ where: { id: me.id }, select: { passwordHash: true } });
  if (!withHash || !verifyPassword(password, withHash.passwordHash)) {
    return NextResponse.json({ error: "Parolă greșită." }, { status: 403 });
  }

  const result = await eraseUserAccount(me.id);
  clearSession();
  if (result.left > 0 || result.orphans > 0) {
    // Same "do not report success on a half-erased account" rule the CLI script enforces.
    console.error(`[account-delete] user #${me.id} erase left ${result.left} account row(s), ${result.orphans} orphan(s)`);
    return NextResponse.json({ error: "Ștergerea nu s-a finalizat complet. Scrie-ne, te rugăm." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
