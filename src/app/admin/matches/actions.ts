"use server";
// Decisions on pending matches.
//
// A decision writes a MatchOverride, which is the thing the matcher obeys forever and which
// survives a full catalog rebuild. The PendingMatch row is marked resolved rather than deleted:
// a rejected pairing is evidence about where the matcher is wrong, and throwing it away means
// the same bad candidate is re-queued on the next scrape with nothing to show it was already
// judged.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export type DecisionResult = { ok: boolean; error?: string; done?: number };

async function requireAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return { ok: false, error: "Admin only." };
  return { ok: true };
}

/**
 * CONFIRM binds the store product to the catalog product permanently. REJECT forbids it.
 *
 * Both write a MatchOverride keyed by (merchantId, storeKey) — the same key the matcher checks
 * before any heuristic runs — so the next scrape acts on the decision without re-asking.
 */
export async function decideMatch(id: number, decision: "confirm" | "reject"): Promise<DecisionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };

  const pm = await prisma.pendingMatch.findUnique({ where: { id } });
  if (!pm) return { ok: false, error: "Not found." };
  if (pm.resolved) return { ok: true, done: 0 };

  await prisma.$transaction([
    prisma.matchOverride.upsert({
      where: { merchantId_storeKey: { merchantId: pm.merchantId, storeKey: pm.storeKey } },
      update: { productId: pm.productId, decision },
      create: { merchantId: pm.merchantId, storeKey: pm.storeKey, productId: pm.productId, decision },
    }),
    prisma.pendingMatch.update({
      where: { id },
      data: { resolved: true, decision, decidedAt: new Date() },
    }),
  ]);

  revalidatePath("/admin/matches");
  return { ok: true, done: 1 };
}

/**
 * Reject many at once.
 *
 * Bulk CONFIRM is deliberately absent. Confirming publishes one merchant's price on another
 * merchant's product page, and doing that to fifty rows on one keystroke is how a bad batch
 * becomes a wrong number on fifty pages. Rejecting in bulk only ever withholds a comparison,
 * which is the cheap direction.
 */
export async function bulkReject(ids: number[]): Promise<DecisionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (ids.length === 0) return { ok: true, done: 0 };
  if (ids.length > 200) return { ok: false, error: "Refusing more than 200 at once." };

  const rows = await prisma.pendingMatch.findMany({ where: { id: { in: ids }, resolved: false } });
  if (rows.length === 0) return { ok: true, done: 0 };

  await prisma.$transaction([
    ...rows.map((pm) =>
      prisma.matchOverride.upsert({
        where: { merchantId_storeKey: { merchantId: pm.merchantId, storeKey: pm.storeKey } },
        update: { productId: pm.productId, decision: "reject" },
        create: { merchantId: pm.merchantId, storeKey: pm.storeKey, productId: pm.productId, decision: "reject" },
      }),
    ),
    prisma.pendingMatch.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { resolved: true, decision: "reject", decidedAt: new Date() },
    }),
  ]);

  revalidatePath("/admin/matches");
  return { ok: true, done: rows.length };
}

/** Undo the last decision on a row — a wrong keystroke must be recoverable. */
export async function undoDecision(id: number): Promise<DecisionResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };

  const pm = await prisma.pendingMatch.findUnique({ where: { id } });
  if (!pm) return { ok: false, error: "Not found." };

  await prisma.$transaction([
    prisma.matchOverride.deleteMany({ where: { merchantId: pm.merchantId, storeKey: pm.storeKey } }),
    prisma.pendingMatch.update({ where: { id }, data: { resolved: false, decision: null, decidedAt: null } }),
  ]);

  revalidatePath("/admin/matches");
  return { ok: true, done: 1 };
}
