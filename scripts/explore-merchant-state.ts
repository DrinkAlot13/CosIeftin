// What every merchant actually contributes, and what its scrape history says. READ-ONLY.
//
// Written to answer "why is Selgros excused from the nightly?" with evidence rather than with
// the note in docs/data-sources.md, which is a claim from an earlier session and may no longer
// be true.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const cutoff = new Date(Date.now() - 14 * 86_400_000);
  const merchants = await prisma.merchant.findMany({ orderBy: { slug: "asc" } });

  console.log("MERCHANT".padEnd(16), "OFFERS".padStart(8), "LIVE".padStart(7), "ACTIVE".padStart(7), " RUNS  LAST RUN            WRITTEN  POOL");
  console.log("-".repeat(104));
  for (const m of merchants) {
    const offers = await prisma.offer.count({ where: { merchantId: m.id } });
    const live = await prisma.offer.count({
      where: {
        merchantId: m.id, availability: "in stock", isStale: false, flagged: false,
        lastObservedAt: { gte: cutoff },
      },
    });
    const runs = await prisma.scraperRun.count({ where: { merchantId: m.id } });
    const last = await prisma.scraperRun.findFirst({
      where: { merchantId: m.id }, orderBy: { startedAt: "desc" },
      select: { startedAt: true, offersWritten: true, offersAttempted: true, aborted: true, abortReason: true },
    });
    const when = last ? last.startedAt.toISOString().slice(0, 16).replace("T", " ") : "never";
    const w = last ? String(last.offersWritten) : "-";
    const pool = last ? String(last.offersAttempted) : "-";
    console.log(
      m.slug.padEnd(16), String(offers).padStart(8), String(live).padStart(7),
      String(m.active).padStart(7), String(runs).padStart(5), " ", when.padEnd(18), w.padStart(7), " ", pool.padStart(6),
      last?.aborted ? `ABORTED: ${last.abortReason ?? ""}`.slice(0, 40) : "",
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
