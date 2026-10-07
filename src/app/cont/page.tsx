import Link from "next/link";
import { redirect } from "next/navigation";
import { logout, setAccountEmail } from "@/app/actions";
import { getCurrentUser } from "@/lib/auth";
import { BlocklistManager } from "@/components/BlocklistManager";
import { SavingsCounter } from "@/components/SavingsCounter";
import { BudgetSettings } from "@/components/BudgetSettings";
import { PushSubscribe } from "@/components/PushSubscribe";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contul meu" };

const EMAIL_ERRORS: Record<string, string> = {
  bademail: "Adresa de e-mail nu este validă.",
  emailexists: "Există deja un cont cu această adresă de e-mail.",
};
const OK_MESSAGES: Record<string, string> = {
  email: "Adresa de e-mail a fost salvată.",
  reset: "Parola a fost resetată și ești autentificat.",
};

export default async function ContPage({ searchParams }: { searchParams: { e?: string; ok?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/cont");
  const emailErr = searchParams.e ? EMAIL_ERRORS[searchParams.e] : undefined;
  const okMsg = searchParams.ok ? OK_MESSAGES[searchParams.ok] : undefined;

  return (
    <div className="container">
      <div className="section" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Contul meu</h1>
          <p className="muted" style={{ margin: 0 }}>{user.username}</p>
        </div>
        <form action={logout}><button className="btn btn-outline" type="submit">Deconectare</button></form>
      </div>
      {okMsg && <div className="section" style={{ paddingTop: 0 }}><div className="alert-ok">{okMsg}</div></div>}
      <section className="section">
        <SavingsCounter />
      </section>
      <section className="section">
        <div className="pill-note">
          Lista ta de cumpărături se salvează pe acest dispozitiv. Deschide{" "}
          <Link href="/lista" style={{ color: "var(--primary)" }}>🛒 Lista mea</Link> ca să compari coșul.
        </div>
      </section>
      <section className="section">
        <div className="section-head"><h2 style={{ fontSize: 18 }}>E-mail</h2></div>
        {emailErr && <div className="alert-err" style={{ marginBottom: 8 }}>{emailErr}</div>}
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Opțional. Folosit doar pentru resetarea parolei și, dacă vrei, un rezumat săptămânal al
          economiilor tale — vezi{" "}
          <Link href="/confidentialitate" style={{ color: "var(--primary)" }}>politica de confidențialitate</Link>.
        </p>
        <form action={setAccountEmail} className="auth-form" style={{ maxWidth: 360 }}>
          <input type="email" name="email" defaultValue={user.email ?? ""} placeholder="adresa@exemplu.ro" aria-label="Adresa de e-mail" />
          <button className="btn btn-outline" type="submit">{user.email ? "Actualizează" : "Adaugă e-mail"}</button>
        </form>
      </section>
      <section className="section">
        <div className="section-head"><h2 style={{ fontSize: 18 }}>Notificări</h2></div>
        <PushSubscribe />
      </section>
      <section className="section">
        <div className="section-head"><h2 style={{ fontSize: 18 }}>Buget lunar</h2></div>
        <BudgetSettings />
      </section>
      <section className="section">
        <div className="section-head"><h2 style={{ fontSize: 18 }}>Ce nu vreau să mi se sugereze</h2></div>
        <BlocklistManager />
      </section>
      <div style={{ height: 32 }} />
    </div>
  );
}
