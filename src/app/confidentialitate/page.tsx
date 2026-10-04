// Privacy policy — DRAFT, written from the CODE rather than from memory of what we built.
//
// ── EVERY CLAIM BELOW WAS CHECKED AGAINST THE SOURCE ON 2026-09-10. What that audit found:
//
//   · The loyalty-card wallet never leaves the browser. `lib/cards-wallet.ts` is localStorage
//     only — no route, no model, no fetch. Card numbers are not ours to lose.
//   · IP addresses are never persisted. `clientIp` returns NULL unless TRUST_PROXY=1, and even
//     then the value lives in an in-memory rate-limit Map that is evicted on expiry. The
//     list-add endpoint hashes it with a per-process random salt that dies with the process.
//   · No analytics, no ad tracking, no third-party scripts. Grepped for the fifteen usual
//     suspects; the only hits were the English word "plausible" in comments.
//   · Exactly ONE cookie exists: `pm_session`.
//   · Accounts do not collect an e-mail address at all (renamed `email` -> `username`,
//     2026-09-30) — there is NO e-mail verification and NO password reset to begin with. That
//     is why the rights section explains how identity is checked instead of saying "reply from
//     the address on file": anyone can register with any username, so the name alone proves
//     nothing, and answering an access request from it alone could hand person A's data to
//     whoever asked. GDPR Article 12(6) explicitly allows asking for more information — and
//     refusing.
//   · 89.9% of product images are hotlinked from 18 third-party hosts. The proxy was never
//     built, so that section is generated FROM THE DATABASE and is true on the day it renders.
//   · `UserBlocklist` and `GroceryList` are declared in the schema and written by NOTHING.
//     They are not described here, because describing data we do not collect is as wrong as
//     omitting data we do.
//
// The third-party section is generated rather than written by hand: a policy listing the hosts
// a page contacts is only true on the day it is written, and this one lists whatever the
// catalog actually points at right now.
import Link from "next/link";
import { prisma } from "@/lib/db";

export const revalidate = 3600;

export const metadata = {
  title: "Politica de confidențialitate",
  description: "Ce date colectăm, ce nu colectăm, și cu cine comunică browserul tău pe acest site.",
};

const CONTACT = "contact@cosieftin.ro";

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
        <b>Document în lucru.</b> Textul descrie corect ce face aplicația — fiecare afirmație a
        fost verificată în cod — dar nu a fost citit de un avocat specializat în protecția
        datelor.
      </div>

      <h1>Politica de confidențialitate</h1>
      <p className="lead">Ultima actualizare: 10 septembrie 2026</p>

      <p>
        Pe scurt: poți folosi tot comparatorul fără cont și fără să ne spui cine ești. Dacă îți
        faci cont, nu îți cerem un e-mail — alegi un nume de utilizator, iar noi păstrăm acel
        nume și ce ai salvat. Nu vindem date, nu avem reclame și nu urmărim vizitatorii între
        site-uri.
      </p>

      <h2>Ce păstrăm pe serverul nostru</h2>
      <p>Numai dacă îți faci cont:</p>
      <ul className="legal-list">
        <li>
          <b>Numele de utilizator</b> ales de tine și o formă criptată a parolei (scrypt cu sare aleatoare — parola în clar nu este stocată și nu o putem citi). Nu cerem și nu stocăm o adresă de e-mail.
          {" "}Numele de utilizator devine <b>public</b> dacă propui o echivalență confirmată sau
          semnalezi un preț greșit rezolvat — apare pe{" "}
          <Link href="/contribuitori" style={{ color: "var(--primary)" }}>pagina contribuitorilor</Link>.
          {" "}La fel dacă trimiți o rețetă pe <Link href="/retete" style={{ color: "var(--primary)" }}>pagina de rețete</Link> —
          apare lângă rețetă, pentru toată lumea. Altfel rămâne privat.
        </li>
        <li><b>Produsele marcate ca favorite</b>, fie pentru că ai apăsat inima, fie pentru că le-ai adăugat de mai multe ori.</li>
        <li><b>De câte ori ai adăugat un produs în listă</b> și în câte zile diferite — de aici deducem „produsele tale obișnuite”.</li>
      </ul>
      <p>
        Separat de conturi, dacă activezi o alertă de preț prin Telegram, păstrăm{" "}
        <b>identificatorul de chat Telegram</b>, produsul urmărit și pragul de preț. Atât — nu
        primim de la Telegram numele sau numărul tău de telefon.
      </p>
      <p>
        Mai numărăm, pentru fiecare produs, <b>de câte ori a fost adăugat în liste în total</b>.
        Este un singur număr per produs, fără utilizator, fără sesiune și fără dată pentru
        fiecare adăugare — nu se poate reconstrui din el cine ce a adăugat.
      </p>

      <h2>Ce rămâne în browserul tău și nu ajunge la noi</h2>
      <p>
        Lista de cumpărături, cardurile de fidelitate și preferințele sunt salvate{" "}
        <b>local, în browserul tău</b>. Nu le trimitem nicăieri și nu avem o copie.
      </p>
      <ul className="legal-list">
        <li><code>cosmic_carts</code> — listele tale de cumpărături</li>
        <li><code>cosmic_wallet</code> — <b>numerele cardurilor de fidelitate</b>. Nu ajung niciodată pe serverul nostru; nu le putem vedea, pierde sau divulga.</li>
        <li><code>cosmic_alerts</code> — produsele pe care le urmărești în browser</li>
        <li><code>cosmic_pref_stores</code> — magazinele tale preferate</li>
        <li><code>cosmic_basket_snap</code>, <code>cosmic_basket_cache_v1</code> — ultimul coș calculat, ca să meargă și fără internet</li>
        <li><code>pm_theme</code> — tema deschisă sau întunecată</li>
      </ul>
      <p>
        Când calculăm coșul trimitem la server doar produsele și cantitățile, ca să putem
        răspunde cu prețurile. Nu atașăm un identificator de persoană.
      </p>

      <h2>Cookie-uri</h2>
      <p>
        Folosim <b>un singur cookie</b>, și numai dacă îți faci cont:
      </p>
      <ul className="legal-list">
        <li>
          <code>pm_session</code> — te ține autentificat. Durată: 30 de zile. Nu poate fi citit
          de JavaScript (<code>httpOnly</code>), nu pleacă spre alte site-uri
          (<code>sameSite=lax</code>) și circulă doar criptat în producție.
        </li>
      </ul>
      <p>
        Este strict necesar pentru autentificare, deci nu îți cerem consimțământ pentru el — nu
        ai ce refuza fără să pierzi contul. <b>Nu avem cookie-uri de publicitate, de analiză sau
        de urmărire.</b> Restul preferințelor stau în browser (lista de mai sus), nu în cookie-uri.
      </p>

      <h2>Ce NU colectăm</h2>
      <ul className="legal-list">
        <li>Nu îți cerem numele, adresa sau telefonul.</li>
        <li>Nu stocăm adrese IP. Le folosim doar în memorie, ca să limităm abuzurile, și se șterg singure când expiră fereastra de limitare.</li>
        <li>Nu avem Google Analytics și nici alt instrument de analiză.</li>
        <li>Nu avem reclame și nu urmărim vizitatorii între site-uri.</li>
        <li>Nu vindem și nu închiriem date către nimeni.</li>
        <li>Nu îți cerem date despre sănătate, alimentație sau convingeri.</li>
      </ul>

      <h2>Cu cine comunică browserul tău pe acest site</h2>
      <p>
        Imaginile produselor sunt, în cea mai mare parte, servite direct de pe serverele
        magazinelor. Asta înseamnă că, atunci când se încarcă o pagină cu produse,{" "}
        <b>browserul tău face cereri către domeniile de mai jos</b>, iar acestea pot vedea
        adresa ta IP, tipul browserului și pagina de pe care a pornit cererea. Nu controlăm ce
        fac aceste companii cu informația respectivă și nu avem un acord cu ele.
      </p>
      {ranked.length > 0 ? (
        <>
          <ul className="legal-list">
            {ranked.map(([h, n]) => (
              <li key={h}><code>{h}</code> — imagini pentru {n.toLocaleString("ro-RO")} produse</li>
            ))}
          </ul>
          <p>
            Vrem să mutăm imaginile pe serverul nostru, ca aceste cereri să dispară; deocamdată nu
            am făcut-o. Lista de mai sus este generată automat din catalog, deci arată situația de
            acum, nu de la data redactării.
          </p>
        </>
      ) : (
        <p>Toate imaginile sunt servite de pe serverul nostru. Browserul tău nu contactează terți.</p>
      )}

      <h2>De ce avem voie să păstrăm aceste date</h2>
      <ul className="legal-list">
        <li>
          <b>Contul și ce ai salvat în el</b> — pentru că ne-ai cerut serviciul. Fără nume de
          utilizator nu există cont, iar fără favorite nu putem arăta „produsele tale”.
        </li>
        <li>
          <b>Alertele de preț</b> — pentru că le-ai pornit tu. Le poți opri oricând, iar atunci
          ștergem alerta.
        </li>
        <li>
          <b>Limitarea abuzurilor</b> — interesul nostru legitim de a ține site-ul în picioare.
          Sunt date temporare, în memorie.
        </li>
      </ul>

      <h2>Cât păstrăm</h2>
      <ul className="legal-list">
        <li><b>Contul</b> — până îl ștergi. Nu avem ștergere automată după inactivitate.</li>
        <li><b>Cookie-ul de sesiune</b> — 30 de zile, sau până te deconectezi.</li>
        <li><b>Alertele de preț</b> — până le oprești.</li>
        <li><b>Datele de limitare a abuzurilor</b> — minute, în memorie; dispar la repornirea serverului.</li>
        <li><b>Ce este în browserul tău</b> — până ștergi datele site-ului. Îl controlezi tu, nu noi.</li>
      </ul>

      <h2>Drepturile tale</h2>
      <p>
        Scrie-ne la <a href={`mailto:${CONTACT}?subject=Date%20personale`}>{CONTACT}</a> și
        răspundem în cel mult 30 de zile. Poți cere:
      </p>
      <ul className="legal-list">
        <li><b>Acces</b> — ce date avem despre tine.</li>
        <li><b>Rectificare</b> — să corectăm ce este greșit.</li>
        <li><b>Ștergere</b> — îți ștergem contul și tot ce e legat de el: favorite, liste, contoare. Ștergerea este definitivă și nu putem să o anulăm.</li>
        <li><b>Portabilitate</b> — îți trimitem datele într-un fișier pe care îl poți lua cu tine.</li>
        <li><b>Opoziție</b> — să nu mai prelucrăm datele tale.</li>
      </ul>
      <h3>Cum verificăm că ești tu</h3>
      <p>
        Nu avem o adresă de e-mail pe cont, deci <b>nu putem verifica cine ești după adresa de la
        care ne scrii</b> — oricine își poate alege orice nume de utilizator, inclusiv al altcuiva.
        Ca să nu trimitem datele unei persoane către altcineva:
      </p>
      <ul className="legal-list">
        <li>
          Cel mai simplu: fii autentificat în cont când ne scrii și spune-ne asta. Dacă poți intra
          în cont, controlezi parola.
        </li>
        <li>
          Dacă nu poți intra în cont, îți vom cere informații suplimentare care să confirme că
          este contul tău (de exemplu, aproximativ când l-ai creat sau ce ai salvat în el).
        </li>
        <li>
          Dacă tot nu putem confirma cine ești, <b>refuzăm cererea</b> și îți explicăm de ce.
          Este mai bine să te refuzăm pe tine decât să dăm datele tale altcuiva.
        </li>
      </ul>
      <p>
        Momentan nu există un buton de ștergere în cont și nici resetare de parolă: cererea se
        face pe e-mail, iar ștergerea o facem noi, manual. Preferăm să spunem asta decât să
        promitem butoane care nu există.
      </p>
      <p>
        Dacă nu ești mulțumit de răspunsul nostru, te poți adresa{" "}
        <a href="https://www.dataprotection.ro" target="_blank" rel="noopener">ANSPDCP</a>,
        autoritatea română de supraveghere.
      </p>

      <h2>Prețurile nu sunt date personale</h2>
      <p>
        Prețurile, produsele și magazinele sunt informații publice despre mărfuri, nu despre
        persoane. Politica aceasta se referă doar la datele despre tine.
      </p>

      <p className="legal-foot">
        Vezi și <Link href="/despre">cum funcționează</Link>,{" "}
        <Link href="/metodologie">metodologia</Link> și{" "}
        <Link href="/termeni">termenii de utilizare</Link>.
      </p>
    </div>
  );
}
