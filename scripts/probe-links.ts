// DO OUR STORED PRODUCT LINKS ACTUALLY RESOLVE? READ-ONLY, network only.
//
// Every offer can carry a `productUrl` — the "vezi în magazin" link a shopper clicks. Nothing
// ever checked that those URLs work. Sezamo's were ALL 404: the scraper built
// `${BASE}/${slug}` when the live path is `${BASE}/${productId}-${slug}`. The field was
// non-null, the pool contract was satisfied, and the link was dead on our largest merchant.
//
// A dead link is invisible to every check that looks at the database, because the database is
// not wrong — the world is. It has to be asked over the network.
//
//   npm run probe:links                 all active merchants, 8 links each
//   npm run probe:links -- sezamo --n=20
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const want = argv.filter((a) => !a.startsWith("--"));
  const n = Number((argv.find((a) => a.startsWith("--n=")) ?? "--n=8").split("=")[1]);

  const merchants = await prisma.merchant.findMany({ where: { active: true }, select: { id: true, slug: true } });
  console.log("MERCHANT".padEnd(16), "checked".padStart(8), "dead".padStart(6), "  sample of what is dead");
  console.log("-".repeat(96));

  for (const m of merchants) {
    if (want.length && !want.includes(m.slug)) continue;
    const rows = await prisma.offer.findMany({
      where: { merchantId: m.id, productUrl: { not: null }, isStale: false },
      select: { productUrl: true },
      take: n,
    });
    if (rows.length === 0) { console.log(`${m.slug.padEnd(16)} ${"—".padStart(8)} ${"—".padStart(6)}   no offer carries a productUrl`); continue; }
    let dead = 0;
    const examples: string[] = [];
    for (const r of rows) {
      const res = await fetch(r.productUrl!, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      if (!res || res.status >= 400) { dead++; if (examples.length < 1) examples.push(`${res ? res.status : "net"} ${r.productUrl}`); }
    }
    const flag = dead === rows.length ? "  ← ALL DEAD" : dead > 0 ? "  ← some dead" : "";
    console.log(`${m.slug.padEnd(16)} ${String(rows.length).padStart(8)} ${String(dead).padStart(6)}   ${examples[0] ?? ""}${flag}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
