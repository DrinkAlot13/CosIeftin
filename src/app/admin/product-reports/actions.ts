"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

async function requireAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return Boolean(user?.isAdmin);
}

export async function decideReport(id: number, status: "RESOLVED" | "DISMISSED") {
  if (!(await requireAdmin())) return { ok: false, error: "Admin only." };
  await prisma.productReport.update({ where: { id }, data: { status, resolvedAt: new Date() } });
  revalidatePath("/admin/product-reports");
  return { ok: true };
}
