"use server";

import { redirect } from "next/navigation";
import { clearSession, hashPassword, setSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function register(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const pw = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/cont");
  if (!EMAIL_RE.test(email) || pw.length < 6) redirect("/login?e=invalid");
  if (await prisma.user.findUnique({ where: { email } })) redirect("/login?e=exists");
  const user = await prisma.user.create({ data: { email, passwordHash: hashPassword(pw) } });
  setSession(user.id);
  redirect(next);
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const pw = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/cont");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(pw, user.passwordHash)) redirect("/login?e=bad");
  setSession(user.id);
  redirect(next);
}

export async function logout() {
  clearSession();
  redirect("/");
}
