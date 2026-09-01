import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
const p = new PrismaClient();
async function main() {
  const rows = await p.priceAnomaly.findMany({
    where: { rejectedPriceBani: { gt: 0 }, acceptedPriceBani: { not: null }, merchant: { slug: "dcneu" } },
    select: { offerId: true, rejectedPriceBani: true, acceptedPriceBani: true,
              offer: { select: { product: { select: { name: true } } } } },
  });
  writeFileSync("dcneu-arbitration.json", JSON.stringify(rows.map((r) => ({
    offerId: r.offerId, refused: r.rejectedPriceBani, kept: r.acceptedPriceBani,
    name: r.offer?.product.name ?? "",
  }))), "utf8");
  console.log(`snapshot: ${rows.length} dcneu rows to arbitrate`);
  await p.$disconnect();
}
main();
