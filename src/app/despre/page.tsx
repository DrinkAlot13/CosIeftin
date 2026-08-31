// The methodology page. For a price comparator this is the trust page: a shopper who cannot
// find out where a number came from has no reason to believe it.
//
// Everything stated here is checked against the code, not aspirational. Where the answer is
// unflattering — a price can be a day old, a match can be wrong, most images come from the
// retailer's own server — it says so, because the alternative is a claim we cannot support.
import Link from "next/link";
import { prisma } from "@/lib/db";

export const revalidate = 3600;

export const metadata = {
  title: "Cum funcționează CoșMic",
  description:
    "De unde vin prețurile, cât de des se actualizează, cum potrivim produsele între magazine și ce nu putem garanta.",
};

export default async function DesprePage() {
  const [merchants, products, offers, newest] = await Promise.all([
    prisma.merchant.findMany({
      where: { active: true, offers: { some: {} } },
      select: { name: true, websiteUrl: true, _count: { select: { offers: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.product.count({ where: { offers: { some: { isStale: false } } } }),
    prisma.offer.count({ where: { isStale: false } }),
    prisma.offer.findFirst({ orderBy: { lastSeen: "desc" }, select: { lastSeen: true } }),
  ]);

  const updated = newest?.lastSeen
    ? new Intl.DateTimeFormat("ro-RO", { dateStyle: "long", timeStyle: "short" }).format(newest.lastSeen)
    : "—";

  return (
    <div className="container legal">
      <h1>Cum funcționează CoșMic</h1>
      <p className="lead">
        CoșMic compară prețuri la alimente între magazinele din România. Pagina asta explică de
        unde vin cifrele și — la fel de important — ce nu putem garanta.
      </p>

      <div className="legal-stats">
        <div><b>{merchants.length}</b><span>magazine</span></div>
        <div><b>{products.toLocaleString("ro-RO")}</b><span>produse</span></div>
        <div><b>{offers.toLocaleString("ro-RO")}</b><span>prețuri active</span></div>
        <div><b>{updated}</b><span>ultima actualizare</span></div>
      </div>

      <h2>De unde vin prețurile</h2>
      <p>
        Prețurile sunt colectate automat din paginile publice ale magazinelor — aceleași pagini
        pe care le vezi și tu în browser. Nu primim date de la magazine și nu avem acorduri
        comerciale cu ele. Fiecare preț este salvat împreună cu textul exact din care a fost
        citit, ca să putem verifica ulterior orice greșeală de interpretare.
      </p>
      <ul className="legal-list">
        {merchants.map((m) => (
          <li key={m.name}>
            <b>{m.name}</b> — {m._count.offers.toLocaleString("ro-RO")} produse
            {m.websiteUrl && (
              <> · <a href={m.websiteUrl} rel="nofollow noopener" target="_blank">site oficial</a></>
            )}
          </li>
        ))}
      </ul>

      <h2>Cât de proaspete sunt</h2>
      <p>
        Colectarea rulează o dată pe noapte. Un preț afișat poate avea până la 24 de ore vechime,
        iar magazinele pot schimba prețul oricând între două rulări. <b>Prețul final este cel de
        la casa de marcat sau din coșul magazinului</b> — verifică-l acolo înainte să cumperi.
      </p>
      <p>
        Nu ștergem nimic: când un produs dispare dintr-un magazin, oferta este marcată ca
        expirată, nu ștearsă. Așa rămâne istoricul de preț, care este singurul mod onest de a
        spune dacă o „reducere” este într-adevăr o reducere.
      </p>

      <h2>Cum potrivim produsele între magazine</h2>
      <p>
        Ca să compare corect, două produse din magazine diferite trebuie recunoscute ca fiind
        același produs. În România magazinele alimentare <b>nu publică coduri EAN</b>, așa că
        potrivirea se face pe denumire, marcă și gramaj, cu reguli stricte: un produs de 500 g
        nu se unește niciodată cu unul de 1 kg, iar dacă fiecare denumire conține un cuvânt pe
        care cealaltă nu îl are, sunt tratate ca produse diferite.
      </p>
      <p>
        Fiecare potrivire primește un scor de încredere. Cele slabe sunt trimise la verificare
        manuală în loc să fie publicate. <b>Chiar și așa, potrivirile greșite există.</b> Dacă
        vezi una, spune-ne.
      </p>

      <h2>Prețul pe unitate</h2>
      <p>
        Comparăm și lei/kg sau lei/litru, pentru că un ambalaj mai mare la un preț mai mare nu
        înseamnă neapărat mai scump. Gramajul este citit din denumirea produsului, inclusiv
        ambalajele promoționale de tip „(7+1) x 125 g”, unde ceea ce plătești și ceea ce iei
        acasă sunt două cantități diferite.
      </p>

      <h2>Ce nu facem</h2>
      <ul className="legal-list">
        <li>Nu vindem nimic. Comanda se face pe site-ul magazinului.</li>
        <li>Nu primim bani de la magazine ca să apară mai sus în listă.</li>
        <li>Nu inventăm prețuri. Dacă nu am putut citi un preț cu certitudine, nu îl afișăm.</li>
      </ul>

      <p className="legal-foot">
        Vezi și <Link href="/termeni">termenii de utilizare</Link> și{" "}
        <Link href="/confidentialitate">politica de confidențialitate</Link>.
      </p>
    </div>
  );
}
