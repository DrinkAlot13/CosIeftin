// Review queue for shopper-submitted "something's wrong" reports (ReportProblem.tsx on every
// product page). Two kinds, read separately because they point at different fixes: wrong_price
// is a scraper/parser problem, wrong_product is a matcher problem.
//
//   npm run review:product-reports                     list OPEN, grouped by kind
//   npm run review:product-reports -- --resolve=<id> [--note="..."]
//   npm run review:product-reports -- --dismiss=<id> [--note="..."]

import { prisma } from "../src/lib/db";

const bani = (n: number | null | undefined) => (n == null ? "—" : (n / 100).toFixed(2));
const KIND_LABEL: Record<string, string> = { wrong_price: "PREȚ GREȘIT", wrong_product: "PRODUS GREȘIT", other: "ALTCEVA" };

async function printOpen() {
  const rows = await prisma.productReport.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "asc" },
    include: {
      product: {
        select: {
          id: true, name: true, brand: true, slug: true,
          offers: { where: { isStale: false, flagged: false }, select: { priceBani: true, merchant: { select: { slug: true } } } },
        },
      },
      user: { select: { username: true } },
    },
  });
  if (rows.length === 0) { console.log("No open reports."); return; }

  console.log(`${rows.length} OPEN report(s):\n`);
  for (const r of rows) {
    const prices = r.product.offers.map((o) => `${o.merchant.slug} ${bani(o.priceBani)}`).join(", ");
    console.log(`[#${r.id}] ${KIND_LABEL[r.kind] ?? r.kind}${r.user ? ` — ${r.user.username}` : " — anonim"}`);
    console.log(`  ${r.product.name}${r.product.brand ? ` (${r.product.brand})` : ""}  /p/${r.product.slug}`);
    console.log(`  live prices: ${prices || "none"}`);
    if (r.note) console.log(`  note: "${r.note}"`);
    console.log();
  }
  console.log("npm run review:product-reports -- --resolve=<id> [--note=\"...\"]");
  console.log("npm run review:product-reports -- --dismiss=<id> [--note=\"...\"]");
}

async function setStatus(id: number, status: "RESOLVED" | "DISMISSED", note: string | null) {
  await prisma.productReport.update({ where: { id }, data: { status, resolvedAt: new Date(), resolveNote: note } });
  console.log(`[#${id}] marked ${status}.${note ? ` Note: ${note}` : ""}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const resolveArg = argv.find((a) => a.startsWith("--resolve="));
  const dismissArg = argv.find((a) => a.startsWith("--dismiss="));
  const noteArg = argv.find((a) => a.startsWith("--note="));
  const note = noteArg ? noteArg.slice("--note=".length).replace(/^"|"$/g, "") : null;

  if (resolveArg) await setStatus(Number(resolveArg.split("=")[1]), "RESOLVED", note);
  else if (dismissArg) await setStatus(Number(dismissArg.split("=")[1]), "DISMISSED", note);
  else await printOpen();

  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
