// Creates/ensures a demo admin account.
import crypto from "node:crypto";
import { prisma } from "../src/lib/db";

const EMAIL = process.env.ADMIN_EMAIL ?? "admin@cosmic.ro";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "admin1234";

function hash(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
}

async function main() {
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { isAdmin: true },
    create: { email: EMAIL, passwordHash: hash(PASSWORD), isAdmin: true },
  });
  console.log(`Admin ready: ${EMAIL} / ${PASSWORD}  (user#${user.id}) — log in, then open /admin`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
