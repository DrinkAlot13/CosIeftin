// Terms of use — DRAFT.
//
// Marked as a draft on the page itself, deliberately. This was written by reading what the
// application actually does, not by copying a template, and it is accurate on the facts. It is
// NOT legal advice and has not been reviewed by a lawyer, and a site that publishes prices
// about named retailers is exactly the kind that should have one look before launch.
import Link from "next/link";

export const metadata = {
  title: "Termeni de utilizare",
  description: "Condițiile în care poate fi folosit CoșMic.",
};

export default function TermeniPage() {
  return (
    <div className="container legal">
      <div className="legal-draft">
        <b>Document în lucru.</b> Textul de mai jos descrie corect cum funcționează site-ul, dar
        nu a fost verificat de un avocat. Nu îl trata ca pe un document juridic definitiv.
      </div>

      <h1>Termeni de utilizare</h1>
      <p className="lead">Ultima actualizare: 31 august 2026</p>

      <h2>1. Ce este acest serviciu</h2>
      <p>
        CoșMic este un comparator de prețuri. Afișăm prețuri colectate din paginile publice ale
        magazinelor și te ajutăm să vezi unde este mai ieftin un coș de cumpărături. Nu vindem
        produse, nu procesăm plăți și nu suntem parte în relația dintre tine și magazin.
      </p>

      <h2>2. Prețurile sunt informative</h2>
      <p>
        Prețurile se actualizează o dată pe zi și pot fi diferite de cele din magazin în
        momentul în care cumperi. <b>Prețul valabil este cel afișat de magazin la finalizarea
        comenzii sau la casa de marcat.</b> Nu garantăm disponibilitatea unui produs și nu
        răspundem pentru diferențele de preț.
      </p>

      <h2>3. Greșeli</h2>
      <p>
        Datele sunt colectate automat, iar procesarea automată greșește: un preț poate fi citit
        greșit, iar două produse diferite pot fi tratate din eroare ca fiind același produs.
        Corectăm ce ni se semnalează. Dacă găsești o eroare, scrie-ne.
      </p>

      <h2>4. Mărci și denumiri</h2>
      <p>
        Denumirile magazinelor și mărcile produselor aparțin deținătorilor lor și sunt folosite
        exclusiv pentru identificarea produselor comparate. Nu suntem afiliați cu magazinele
        menționate și nu sugerăm că ele ne susțin sau ne aprobă.
      </p>

      <h2>5. Utilizare acceptabilă</h2>
      <p>
        Poți folosi site-ul liber pentru uz personal. Nu este permisă extragerea automată a
        bazei de date în masă, revânzarea datelor sau folosirea lor pentru a construi un
        serviciu concurent.
      </p>

      <h2>6. Limitarea răspunderii</h2>
      <p>
        Serviciul este oferit „ca atare”. Nu răspundem pentru decizii de cumpărare luate pe baza
        informațiilor de aici, în limitele permise de lege.
      </p>

      <h2>7. Modificări</h2>
      <p>
        Putem modifica acești termeni. Versiunea curentă este întotdeauna cea de pe această
        pagină, cu data actualizării în partea de sus.
      </p>

      <p className="legal-foot">
        Vezi și <Link href="/despre">cum funcționează</Link> și{" "}
        <Link href="/confidentialitate">politica de confidențialitate</Link>.
      </p>
    </div>
  );
}
