// Privacy policy — DRAFT.
//
// The third-party section is generated from the DATABASE, not written by hand. A privacy
// policy listing the hosts a page contacts is only true on the day it is written; this one
// lists whatever the catalog actually points at right now.
//
// That section exists because `npm run audit:images` found 33,868 of 34,430 product images
// hotlinked from 13 retailer CDNs. Every visitor's browser connects to all of them, handing
// each one an IP address, a User-Agent and a Referer naming the page being read. That is a
// disclosure, it was undeclared, and nobody had counted the hosts.
import Link from "next/link";
import { prisma } from "@/lib/db";

export const revalidate = 3600;

export const metadata = {
  title: "Politica de confidențialitate",
  description: "Ce date colectăm, ce nu colectăm, și cu cine comunică browserul tău pe acest site.",
};

export default async function ConfidentialitatePage() {
  const rows = await prisma.product.findMany({
    where: { image: { startsWith: "http" } },
    select: { image: true },
  });
  const hosts = new Map<string, number>();
  for (const r of rows) {
    if (!r.image) continue;
    try {
      const h = new URL(r.image).hostname;
      hosts.set(h, (hosts.get(h) ?? 0) + 1);
    } catch { /* skip */ }
  }
  const ranked = [...hosts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="container legal">
      <div className="legal-draft">
        <b>Document în lucru.</b> Textul descrie corect ce face aplicația, dar nu a fost
        verificat de un avocat specializat în protecția datelor.
      </div>

      <h1>Politica de confidențialitate</h1>
      <p className="lead">Ultima actualizare: 31 august 2026</p>

      <h2>Ce NU colectăm</h2>
      <ul className="legal-list">
        <li>Nu îți cerem numele sau adresa ca să folosești comparatorul.</li>
        <li>Nu vindem date către nimeni.</li>
        <li>Nu folosim cookie-uri de publicitate și nu urmărim vizitatorii între site-uri.</li>
      </ul>

      <h2>Lista de cumpărături</h2>
      <p>
        Lista ta este salvată <b>în browserul tău</b> (localStorage), nu pe serverele noastre.
        Dacă golești datele site-ului, lista dispare — nu avem o copie. Când lista este
        calculată, trimitem către server doar produsele și cantitățile, ca să putem returna
        prețurile; nu atașăm un identificator de persoană.
      </p>
      <p>
        Dacă îți faci cont, salvăm adresa de e-mail și listele pe care alegi să le sincronizezi.
        Poți cere ștergerea lor oricând.
      </p>

      <h2>Cu cine comunică browserul tău pe acest site</h2>
      <p>
        Imaginile produselor sunt, în cea mai mare parte, servite direct de pe serverele
        magazinelor. Asta înseamnă că, atunci când se încarcă o pagină cu produse,{" "}
        <b>browserul tău face cereri către domeniile de mai jos</b>, iar acestea pot vedea
        adresa ta IP, tipul browserului și pagina de pe care a pornit cererea. Nu controlăm ce
        fac aceste companii cu informația respectivă.
      </p>
      {ranked.length > 0 ? (
        <>
          <ul className="legal-list">
            {ranked.map(([h, n]) => (
              <li key={h}><code>{h}</code> — imagini pentru {n.toLocaleString("ro-RO")} produse</li>
            ))}
          </ul>
          <p>
            Mutăm treptat imaginile pe serverul nostru, ca aceste cereri să dispară. Lista de mai
            sus este generată automat din catalog, deci reflectă situația de acum, nu de la data
            redactării.
          </p>
        </>
      ) : (
        <p>Toate imaginile sunt servite de pe serverul nostru. Browserul tău nu contactează terți.</p>
      )}

      <h2>Cookie-uri</h2>
      <p>
        Folosim un cookie de sesiune doar dacă îți faci cont, plus preferințele salvate local
        (tema, magazinele tale). Nu există cookie-uri de publicitate.
      </p>

      <h2>Drepturile tale (GDPR)</h2>
      <p>
        Ai dreptul să ceri o copie a datelor tale, corectarea lor sau ștergerea contului. Scrie-ne
        și rezolvăm. Datele despre prețuri nu sunt date personale: sunt informații publice
        despre produse, nu despre persoane.
      </p>

      <p className="legal-foot">
        Vezi și <Link href="/despre">cum funcționează</Link> și{" "}
        <Link href="/termeni">termenii de utilizare</Link>.
      </p>
    </div>
  );
}
