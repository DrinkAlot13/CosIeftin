import { redirect } from "next/navigation";
import { login, register } from "@/app/actions";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cont" };

const ERRORS: Record<string, string> = {
  invalid: "Email invalid sau parolă prea scurtă (minim 6 caractere).",
  exists: "Există deja un cont cu acest email — autentifică-te.",
  bad: "Email sau parolă greșite.",
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
            <input type="email" name="email" required placeholder="Email" aria-label="Email" />
            <input type="password" name="password" required placeholder="Parolă" aria-label="Parolă" />
            <button className="btn btn-primary" type="submit">Autentificare</button>
          </form>
        </div>
        <div className="card auth-card">
          <h2 style={{ fontSize: 18 }}>Cont nou</h2>
          <form action={register} className="auth-form">
            <input type="hidden" name="next" value={next} />
            <input type="email" name="email" required placeholder="Email" aria-label="Email nou" />
            <input type="password" name="password" required minLength={6} placeholder="Parolă (min. 6 caractere)" aria-label="Parolă nouă" />
            <button className="btn btn-accent" type="submit">Creează cont</button>
          </form>
        </div>
      </div>
      <div style={{ height: 32 }} />
    </div>
  );
}
