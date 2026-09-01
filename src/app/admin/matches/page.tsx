// The review queue for REVIEW-band matches.
//
// Until now these were computed and discarded — `if (!d.ok) continue` in matchPoolToCatalog,
// where `ok` is true only for AUTO_MATCH. The three-band design was specified and never landed,
// so the middle band existed in the type system and nowhere else.
import { notFound } from "next/navigation";
import { MatchReview } from "@/components/MatchReview";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadPendingQueue } from "@/lib/pending-matches";

export const dynamic = "force-dynamic";
export const metadata = { title: "Potriviri de verificat" };

export default async function AdminMatchesPage({
  searchParams,
}: { searchParams: { merchant?: string; section?: string } }) {
  const user = await getCurrentUser();
  if (!user?.isAdmin) notFound();

  const [queue, totalPending, byMerchant] = await Promise.all([
    loadPendingQueue({ limit: 150, merchant: searchParams.merchant, section: searchParams.section }),
    prisma.pendingMatch.count({ where: { resolved: false } }),
    prisma.pendingMatch.groupBy({
      by: ["merchantId"],
      where: { resolved: false },
      _count: true,
    }),
  ]);

  const merchants = await prisma.merchant.findMany({
    where: { id: { in: byMerchant.map((m) => m.merchantId) } },
    select: { id: true, slug: true, name: true },
  });
  const counts = new Map(byMerchant.map((m) => [m.merchantId, m._count]));

  return (
    <div className="container" style={{ paddingTop: 24, paddingBottom: 56 }}>
      <h1>Potriviri de verificat</h1>
      <p className="muted" style={{ maxWidth: 720 }}>
        Potriviri pe care algoritmul le consideră <b>probabile, dar nu sigure</b>. Nu sunt
        afișate nicăieri pe site și nu intră în niciun calcul până când nu le confirmi.
        O confirmare publică prețul unui magazin pe pagina unui produs — de aceea confirmarea
        se face una câte una, iar respingerea în grup.
      </p>

      <div className="mr-filters">
        <a className={!searchParams.merchant ? "is-on" : ""} href="/admin/matches">toate ({totalPending})</a>
        {merchants.map((m) => (
          <a
            key={m.id}
            className={searchParams.merchant === m.slug ? "is-on" : ""}
            href={`/admin/matches?merchant=${m.slug}`}
          >
            {m.name} ({counts.get(m.id) ?? 0})
          </a>
        ))}
      </div>

      <MatchReview initial={queue} totalPending={totalPending} />
    </div>
  );
}
