// Terms of use — DRAFT.
//
// Marked as a draft on the page itself, deliberately. This was written by reading what the
// application actually does, not by copying a template, and it is accurate on the facts. It is
// NOT legal advice and has not been reviewed by a lawyer, and a site that publishes prices
// about named retailers is exactly the kind that should have one look before launch.
//
// ── ON SECTION 6. A disclaimer is not a place to hide. The site's whole promise is that the
// numbers are worth trusting, so the honest version says plainly what we do to keep them right
// (a named methodology, gates that refuse a suspicious price, a way to report an error) and
// THEN says what we do not guarantee. A limitation of liability that arrives without that is
// asking for trust and disclaiming it in the same breath.
import Link from "next/link";

export const metadata = {
  title: "Termeni de utilizare",
  description: "Condițiile în care poate fi folosit CoșMic.",
};

const CONTACT = "contact@cosmic.ro";

export default function TermeniPage() {
  return (
    <div className="container legal">
      <div className="legal-draft">
        <b>Document în lucru.</b> Textul de mai jos descrie corect cum funcționează site-ul, dar
        nu a fost verificat de un avocat. Nu îl trata ca pe un document juridic definitiv.
      </div>

      <h1>Termeni de utilizare</h1>
      <p className="lead">Ultima actualizare: 10 septembrie 2026</p>

      <h2>1. Ce este acest serviciu</h2>
      <p>
        CoșMic este un comparator de prețuri. Afișăm prețuri colectate din paginile publice ale
        magazinelor și te ajutăm să vezi unde este mai ieftin un coș de cumpărături.{" "}
        <b>Nu vindem produse, nu încasăm plăți și nu suntem parte în relația dintre tine și
        magazin.</b> Orice cumpărare se face la magazin, pe site-ul sau în magazinul lui, după
        regulile lui.
      </p>

      <h2>2. Prețurile sunt informative</h2>
      <p>
        Prețurile sunt colectate automat, de regulă o dată pe zi, și pot fi diferite de cele din
        magazin în momentul în care cumperi. <b>Prețul valabil este cel afișat de magazin la
        finalizarea comenzii sau la casa de marcat.</b> Nu garantăm că un produs este disponibil
        și nu răspundem pentru diferențele de preț.
      </p>
      <p>
        Unele prețuri au condiții atașate și le marcăm ca atare: un preț care se obține doar cu
        cardul de fidelitate al magazinului, sau un preț dintr-o aplicație de livrare, care este
        de regulă mai mare decât cel de la raft. Dacă un preț are o astfel de condiție, scrie pe
        el.
      </p>

      <h2>3. Greșeli</h2>
      <p>
        Datele sunt colectate automat, iar procesarea automată greșește: un preț poate fi citit
        greșit, iar două produse diferite pot fi tratate din eroare ca fiind același produs.{" "}
        <Link href="/metodologie">Metodologia</Link> descrie ce verificări facem și ce refuzăm
        să publicăm. Dacă găsești o eroare, scrie-ne la{" "}
        <a href={`mailto:${CONTACT}?subject=Pret%20gresit`}>{CONTACT}</a> și o corectăm.
      </p>

      <h2>4. Mărci și denumiri</h2>
      <p>
        Denumirile magazinelor și mărcile produselor aparțin deținătorilor lor și sunt folosite
        exclusiv pentru identificarea produselor comparate. Nu suntem afiliați cu magazinele
        menționate și nu sugerăm că ele ne susțin sau ne aprobă.
      </p>

      <h2>5. Utilizare acceptabilă</h2>
      <p>
        Poți folosi site-ul liber, pentru uz personal. Nu este permisă extragerea automată a
        bazei de date în masă, revânzarea datelor sau folosirea lor pentru a construi un
        serviciu concurent.
      </p>
      <p>
        Limităm numărul de cereri pe care le poate face un vizitator, ca site-ul să rămână
        funcțional pentru toată lumea. Dacă traficul dintr-o sursă devine abuziv, îl putem
        încetini sau bloca, fără notificare prealabilă.
      </p>

      <h2>6. Ce garantăm și ce nu</h2>
      <p>
        Ne străduim ca cifrele să fie corecte: prețurile trec prin verificări automate, iar un
        preț care pare greșit este reținut în loc să fie publicat. Cu toate acestea, serviciul
        este oferit <b>„ca atare”</b>, fără garanția că orice preț de aici este corect sau
        actual la momentul la care îl citești.
      </p>
      <p>
        Nu răspundem pentru deciziile de cumpărare luate pe baza informațiilor de aici, în
        limitele permise de lege. Această limitare nu se aplică situațiilor în care legea nu
        permite excluderea răspunderii.
      </p>

      <h2>7. Conturi</h2>
      <p>
        Contul este opțional — comparatorul funcționează integral fără el. Ești responsabil de
        păstrarea parolei. Poți cere ștergerea contului oricând, conform{" "}
        <Link href="/confidentialitate">politicii de confidențialitate</Link>. Putem suspenda un
        cont folosit pentru a abuza de serviciu.
      </p>

      <h2>8. Modificări</h2>
      <p>
        Putem modifica acești termeni. Versiunea curentă este întotdeauna cea de pe această
        pagină, cu data actualizării în partea de sus.
      </p>

      <h2>9. Legea aplicabilă</h2>
      <p>
        Acestor termeni li se aplică legea română, iar eventualele litigii se soluționează de
        instanțele competente din România. Dacă ești consumator, îți păstrezi drepturile
        prevăzute de legislația de protecție a consumatorului, pe care nimic de aici nu le
        restrânge.
      </p>

      <p className="legal-foot">
        Vezi și <Link href="/despre">cum funcționează</Link>,{" "}
        <Link href="/metodologie">metodologia</Link> și{" "}
        <Link href="/confidentialitate">politica de confidențialitate</Link>.
      </p>
    </div>
  );
}
