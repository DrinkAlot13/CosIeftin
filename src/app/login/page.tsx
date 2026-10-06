import { redirect } from "next/navigation";
import Link from "next/link";
import { login, register } from "@/app/actions";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cont" };

const ERRORS: Record<string, string> = {
  invalid: "Nume de utilizator invalid (3-32 caractere, fără spații) sau parolă prea scurtă (minim 6 caractere).",
  exists: "Există deja un cont cu acest nume de utilizator — autentifică-te.",
  bademail: "Adresa de e-mail nu este validă.",
  emailexists: "Există deja un cont cu această adresă de e-mail.",
  bad: "Nume de utilizator sau parolă greșite.",
  // Rate limit reached. Deliberately vague about WHY: naming the limit tells someone probing
  // for accounts exactly how fast they may probe.
  slow: "Prea multe încercări. Așteaptă câteva minute și încearcă din nou.",
};

export default async function LoginPage({ searchParams }: { searchParams: { e?: string; next?: string } }) {
  const user = await getCurrentUser();
  if (user) redirect("/cont");
  const next = searchParams.next ?? "/cont";
  const err = searchParams.e ? ERRORS[searchParams.e] : undefined;

  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 0 }}>
        <h1 style={{ fontSize: 26 }}>Cont</h1>
        {err && <div className="alert-err" style={{ marginTop: 8 }}>{err}</div>}
      </div>
      <div className="auth-wrap">
        <div className="card auth-card">
          <h2 style={{ fontSize: 18 }}>Intră în cont</h2>
          <form action={login} className="auth-form">
            <input type="hidden" name="next" value={next} />
            <input type="text" name="username" required minLength={3} maxLength={32} autoComplete="username" placeholder="Nume de utilizator" aria-label="Nume de utilizator" />
            <input type="password" name="password" required autoComplete="current-password" placeholder="Parolă" aria-label="Parolă" />
            <button className="btn btn-primary" type="submit">Autentificare</button>
          </form>
          <p style={{ marginTop: 10, fontSize: 13 }}><Link href="/reset-password">Ai uitat parola?</Link></p>
        </div>
        <div className="card auth-card">
          <h2 style={{ fontSize: 18 }}>Cont nou</h2>
          <form action={register} className="auth-form">
            <input type="hidden" name="next" value={next} />
            <input type="text" name="username" required minLength={3} maxLength={32} autoComplete="username" placeholder="Nume de utilizator" aria-label="Nume de utilizator nou" />
            <input type="email" name="email" autoComplete="email" placeholder="E-mail (opțional)" aria-label="E-mail, opțional" />
            <input type="password" name="password" required minLength={6} autoComplete="new-password" placeholder="Parolă (min. 6 caractere)" aria-label="Parolă nouă" />
            <button className="btn btn-accent" type="submit">Creează cont</button>
            {/* Consent has to be reachable AT the moment it is given, not only from the
                footer. Linked rather than pre-ticked: a checkbox nobody reads is not consent,
                and the account is optional anyway — the comparator works without one. */}
            <p className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
              Prin crearea contului accepți{" "}
              <Link href="/termeni">termenii de utilizare</Link> și{" "}
              <Link href="/confidentialitate">politica de confidențialitate</Link>. E-mailul este{" "}
              <b>opțional</b> — îl folosim doar pentru resetarea parolei și, dacă vrei, un rezumat
              săptămânal al economiilor. Fără el, contul funcționează la fel; poți cere ștergerea
              oricând.
            </p>
          </form>
        </div>
      </div>
      <div style={{ height: 32 }} />
    </div>
  );
}
