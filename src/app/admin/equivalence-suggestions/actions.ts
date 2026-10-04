"use server";
// Confirm/reject a shopper-submitted equivalence suggestion. See review-equivalence-suggestions.ts
// for why CONFIRMED does not write an EquivalenceClass itself: seed-equivalence.ts deletes any
// class not defined in code, so a class written only to the database would be silently wiped the
// next time anyone runs the existing seed step. Confirming here just records the human judgement;
// turning it into a real class is still a code change in src/data/*.ts.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

async function requireAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return Boolean(user?.isAdmin);
}

export async function decideSuggestion(id: number, decision: "CONFIRMED" | "REJECTED", note?: string) {
  if (!(await requireAdmin())) return { ok: false, error: "Admin only." };
  await prisma.equivalenceSuggestion.update({
    where: { id },
    data: { status: decision, reviewedAt: new Date(), reviewNote: note?.trim() || null },
  });
  revalidatePath("/admin/equivalence-suggestions");
  return { ok: true };
}
