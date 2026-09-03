// How CoșMic works, in plain Romanian.
//
// Not a legal page. `/termeni` and `/confidentialitate` are the legal pages; `/despre` is the
// short pitch. This is the one that answers "why should I believe your prices", and it has to
// be honest about the parts that are imperfect — automatic matching, weekly flyers, deposits —
// because a comparison site's only asset is that people believe the numbers.
import Link from "next/link";
import { prisma } from "@/lib/db";
import { MAX_DISPLAY_AGE_DAYS } from "@/lib/pricing";
import { sectionKind } from "@/lib/section-type";

export const revalidate = 3600;
export const metadata = {
  title: "Cum funcționează CoșMic",
  description:
    "De unde luăm prețurile, cât de des le actualizăm, ce înseamnă fiecare tip de preț și cum poți raporta o greșeală.",
};

const CHANNEL_LABEL: Record<string, string> = {
  shelf: "preț de raft",
  delivery: "preț online",
  aggregator: "platformă de livrare",
};

export default async function MetodologiePage() {
  const merchants = await prisma.merchant.findMany({
    where: { active: true },
    select: { name: true, slug: true, websiteUrl: true, priceChannel: true, storeType: true, lastScrapeAt: true },
    orderBy: { name: "asc" },
  });

  const sections = await prisma.product.groupBy({ by: ["section"], _count: { _all: true } });
  const SECTION_LABEL: Record<string, string> = {
    grocery: "Alimentare", alcohol: "Alcool", dcneu: "DCNeu (discount)",
    cosmetice: "Cosmetice", farmacie: "Farmacie",
  };

  return (
    <div className="container" style={{ maxWidth: 820, paddingBottom: 56 }}>
      <nav className="breadcrumb" aria-label="breadcrumb">
        <Link href="/">Acasă</Link>
        <span className="sep">/</span>
        <span>Cum funcționează</span>
      </nav>

      <h1 style={{ fontSize: 30, marginBottom: 6 }}>Cum funcționează CoșMic</h1>
      <p className="muted" style={{ fontSize: 15, lineHeight: 1.6, marginTop: 0 }}>
        Comparăm prețuri la alimente și produse de uz casnic din magazinele de mai jos. Nu
        vindem nimic și nu încasăm nimic de la tine — te trimitem la magazin, unde faci
        comanda. Pagina asta explică de unde vin cifrele și unde se poate înșela.
      </p>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20 }}>De unde luăm prețurile</h2>
        <p style={{ lineHeight: 1.65 }}>
          Citim automat paginile publice ale magazinelor, o dată pe zi. Fiecare preț pe care
          îl vezi are data la care l-am văzut ultima oară, iar dacă nu l-am mai văzut de{" "}
          {MAX_DISPLAY_AGE_DAYS} zile nu îl mai afișăm ca preț curent.
        </p>
        <div className="card" style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="admin-table">
            <thead>
              <tr><th>Magazin</th><th>Tip preț</th><th>Magazin fizic / online</th></tr>
            </thead>
            <tbody>
              {merchants.map((m) => (
                <tr key={m.slug}>
                  <td style={{ fontWeight: 600 }}>
                    <a href={m.websiteUrl} target="_blank" rel="nofollow noopener">{m.name}</a>
                  </td>
                  <td>{CHANNEL_LABEL[m.priceChannel] ?? m.priceChannel}</td>
                  <td className="muted">
                    {m.storeType === "physical" ? "magazin fizic" : m.storeType === "online" ? "online" : "și fizic, și online"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/*
          COMPARISON vs PRICE sections, said plainly. Three of five sections have exactly one
          merchant, so nothing in them can be compared — and a shopper who lands on a DCNeu
          page expecting a comparison and finding one shop deserves to have been told why,
          rather than concluding the site is broken.
        */}
        <h3 style={{ fontSize: 16, marginTop: 22, marginBottom: 6 }}>Ce poți compara și ce nu</h3>
        <p style={{ lineHeight: 1.65, marginTop: 0 }}>
          Nu toate secțiunile sunt comparații. La <b>Alimentare</b> și <b>Alcool</b> mai multe
          magazine vând aceleași produse, deci îți arătăm prețul fiecăruia și care e cel mai
          mic. La <b>DCNeu</b>, <b>Cosmetice</b> și <b>Farmacie</b> avem un singur magazin
          pentru fiecare — acolo îți arătăm prețul și reducerile pe cantitate, dar nu o
          comparație între magazine, pentru că nu există cu ce compara.
        </p>
        <div className="card" style={{ overflowX: "auto", marginTop: 10 }}>
          <table className="admin-table">
            <thead>
              <tr><th>Secțiune</th><th>Tip</th><th>Produse</th></tr>
            </thead>
            <tbody>
              {sections
                .filter((s) => s._count._all > 0)
                .sort((a, b) => b._count._all - a._count._all)
                .map((s) => (
                  <tr key={s.section}>
                    <td style={{ fontWeight: 600 }}>{SECTION_LABEL[s.section] ?? s.section}</td>
                    <td className="muted">
                      {sectionKind(s.section) === "comparison"
                        ? "comparație între magazine"
                        : "un singur magazin — preț, nu comparație"}
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{s._count._all}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20 }}>Ce înseamnă fiecare tip de preț</h2>
        <ul style={{ lineHeight: 1.7, paddingLeft: 20 }}>
          <li>
            <b>Preț de raft</b> — prețul din magazinul fizic, așa cum îl publică magazinul.
          </li>
          <li>
            <b>Preț online</b> — prețul din magazinul online al aceluiași lanț. Poate diferi
            de cel din raft, și de obicei nu include livrarea.
          </li>
          <li>
            <b>Preț din catalog (ofertă săptămânală)</b> — vine dintr-un catalog care este
            valabil o perioadă anunțată. Afișăm perioada, iar când se termină, prețul dispare.
            Nu îl ținem ca preț curent după expirare.
          </li>
        </ul>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20 }}>Garanția SGR</h2>
        <p style={{ lineHeight: 1.65 }}>
          La băuturi, prețul de pe raft nu include garanția pentru ambalaj (SGR) — 50 de bani
          pentru fiecare recipient. O navetă de 6 doze are 3 lei garanție, o sticlă de 2 l are
          50 de bani. Acolo unde știm valoarea, o afișăm <b>separat</b> de preț, nu inclusă în
          el. Garanția <b>se returnează</b> când duci ambalajul înapoi, deci nu este un cost —
          dar este bani pe care îi dai la casă, și diferă între produsele pe care le compari.
        </p>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20 }}>Cum potrivim produsele între magazine</h2>
        <p style={{ lineHeight: 1.65 }}>
          Aici e partea care se poate înșela, așa că o spunem pe față. Magazinele scriu
          numele diferit — „Lapte Zuzu 1,5% 1 l” la unul, „ZUZU lapte consum 1L 1.5% grăsime”
          la altul. Le potrivim automat, după cod de bare acolo unde există, altfel după
          nume, marcă și gramaj.
        </p>
        <ul style={{ lineHeight: 1.7, paddingLeft: 20 }}>
          <li>
            Când potrivirea e sigură, produsele apar pe aceeași pagină și le comparăm.
          </li>
          <li>
            Când nu suntem siguri, <b>nu ghicim</b>: potrivirea este pusă deoparte pentru
            verificare de către un om, iar produsul rămâne separat până atunci. Preferăm să
            pierdem o comparație decât să punem prețul unui produs pe altul.
          </li>
          <li>
            Diferențele de aromă, de concentrație, de grăsime sau de ambalaj opresc automat
            potrivirea. O cutie de 6×0,33 l și o sticlă de 2 l nu sunt același produs, chiar
            dacă au aproape același volum.
          </li>
        </ul>
        <p style={{ lineHeight: 1.65 }}>
          Dacă vezi o pagină care amestecă două produse diferite, sau un preț care nu e cel
          din magazin, spune-ne. Fiecare pagină de produs are un link{" "}
          <b>„raportează un preț greșit”</b>. E cel mai util lucru pe care ni-l poți trimite.
        </p>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20 }}>Cât de bine putem compara</h2>
        <p>
          Comparăm foarte bine coșul de zi cu zi și mult mai slab coada lungă a catalogului.
          Spunem ambele cifre pentru că numai prima descrie ce pățește un cumpărător:
        </p>
        <ul>
          <li>
            <b>Coșul de bază</b> — cele 40 de produse fixe din Indexul CoșMic (lapte, pâine, ouă,
            ulei, zahăr…): <b>{"~"}62% au preț în 2 sau mai multe magazine</b>.
          </li>
          <li>
            <b>Tot catalogul</b> — orice produs cu preț vizibil azi: <b>{"~"}11%</b>. Diferența nu e
            o eroare de potrivire: catalogul e plin de mărci proprii și produse de nișă pe care
            un singur magazin le vinde, și pe care nicio potrivire nu le poate perechea.
          </li>
        </ul>
        <p>
          <b>Numitorul.</b> Procentele de mai sus se raportează la produsele care au{" "}
          <i>cel puțin un preț vizibil azi</i>, nu la tot ce ținem în catalog. Un produs pe care
          nimeni nu îl are pe stoc azi e o problemă de <i>acoperire</i>, nu de comparabilitate, și
          îl raportăm separat. Dacă l-am pune în numitor, o zi în care un magazin nu răspunde ar
          „îmbunătăți” comparabilitatea — pentru că numitorul scade — ceea ce e exact pe dos.
        </p>
        <p>
          Unde se vede cel mai tare golul: legumele și fructele vândute la kilogram. Bananele,
          merele, roșiile, cartofii și ceapa au adesea un singur magazin, nu pentru că unul singur
          le vinde, ci pentru că fiecare le scrie altfel.
        </p>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20 }}>Ce nu facem</h2>
        <ul style={{ lineHeight: 1.7, paddingLeft: 20 }}>
          <li>Nu vindem produse și nu procesăm comenzi. Comanda se face pe site-ul magazinului.</li>
          <li>Nu afișăm prețuri pe care nu le-am văzut noi. Fără estimări, fără prețuri „de la”.</li>
          <li>Nu afișăm produse din tutun.</li>
          <li>
            Nu tăiem cu o linie prețul altui magazin ca să pară reducere. O linie tăiată
            înseamnă prețul anterior <b>la același magazin</b>. Diferența dintre magazine o
            scriem ca interval.
          </li>
        </ul>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20 }}>Raportează o greșeală</h2>
        <p style={{ lineHeight: 1.65 }}>
          Scrie-ne la{" "}
          <a href="mailto:contact@cosmic.ro?subject=Pret%20gresit">contact@cosmic.ro</a> cu
          linkul paginii. Dacă e o potrivire greșită între produse, spune care două produse
          sunt amestecate — corectăm potrivirea, nu doar prețul.
        </p>
      </section>

      <p className="muted" style={{ fontSize: 13, marginTop: 40 }}>
        Vezi și <Link href="/termeni">Termeni de utilizare</Link> și{" "}
        <Link href="/confidentialitate">Confidențialitate</Link>.
      </p>
    </div>
  );
}
