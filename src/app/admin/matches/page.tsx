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
import { runningConfirmRate } from "@/lib/match-stats";

export const dynamic = "force-dynamic";
export const metadata = { title: "Potriviri de verificat" };

export default async function AdminMatchesPage({
  searchParams,
}: { searchParams: { merchant?: string; section?: string; type?: string } }) {
  const user = await getCurrentUser();
  if (!user?.isAdmin) notFound();

  // DUPLICATES ARE A DIFFERENT REVIEW, and they must not be mixed into this queue.
  //
  // A pending MATCH asks "does this shop's product belong on this catalog page?", and
  // confirming it publishes a price. A DUPLICATE asks "are these two catalog pages the same
  // product?", and the answer is a merge — an action that does not exist yet. Confirming one
  // through the match UI would attach an offer, which is not what the row means.
  //
  // They also cannot share the ranked queue: it takes the top 900 by score and duplicates
  // carry score 0, so 645 of them were queued and rendered nowhere at all.
  const showDuplicates = searchParams.type === "duplicates";
  const duplicates = showDuplicates
    ? await prisma.pendingMatch.findMany({
        where: { resolved: false, storeKey: { startsWith: "dup:" } },
        select: { id: true, storeKey: true, storeName: true, reason: true, productId: true, product: { select: { name: true, slug: true } } },
        orderBy: { id: "asc" },
        take: 700,
      })
    : [];
  const duplicateCount = await prisma.pendingMatch.count({
    where: { resolved: false, storeKey: { startsWith: "dup:" } },
  });

  const [queue, totalPending, byMerchant, rate] = await Promise.all([
    loadPendingQueue({ limit: 150, merchant: searchParams.merchant, section: searchParams.section }),
    prisma.pendingMatch.count({ where: { resolved: false, NOT: { storeKey: { startsWith: "dup:" } } } }),
    prisma.pendingMatch.groupBy({
      by: ["merchantId"],
      where: { resolved: false, NOT: { storeKey: { startsWith: "dup:" } } },
      _count: true,
    }),
    runningConfirmRate(),
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

      {duplicateCount > 0 && (
        <p style={{ margin: "6px 0 14px" }}>
          <a href={showDuplicates ? "/admin/matches" : "/admin/matches?type=duplicates"}>
            {showDuplicates ? "← înapoi la potriviri" : `Produse duplicate în catalog (${duplicateCount}) →`}
          </a>
        </p>
      )}

      {showDuplicates ? (
        <section className="section" style={{ paddingTop: 0 }}>
          <h2 style={{ marginTop: 0 }}>Produse duplicate</h2>
          <p className="muted" style={{ maxWidth: 760 }}>
            Același produs, două intrări în catalog — detectate prin aceleași cuvinte (indiferent
            de ordine) și aceeași mărime. <b>Nu se unesc automat:</b> detectorul este bun, dar
            unirea automată ar strica variante care diferă printr-un singur cuvânt. Sortate după
            daună: întâi cazurile în care <b>același magazin</b> apare pe ambele intrări.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="admin-table">
              <thead>
                <tr><th>Intrare păstrată</th><th>Duplicat</th><th>De ce</th></tr>
              </thead>
              <tbody>
                {duplicates.map((d) => (
                  <tr key={d.id}>
                    <td><a href={`/p/${d.product.slug}`} target="_blank" rel="noopener">{d.product.name}</a></td>
                    <td>{d.storeName}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{d.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <MatchReview initial={queue} totalPending={totalPending} rate={rate} />
      )}
    </div>
  );
}
