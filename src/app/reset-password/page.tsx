import Link from "next/link";
import { confirmPasswordReset, requestPasswordReset } from "@/app/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Resetează parola" };

const ERRORS: Record<string, string> = {
  invalid: "Link invalid sau parolă prea scurtă (minim 6 caractere).",
  expired: "Acest link a expirat sau a fost deja folosit. Cere unul nou mai jos.",
  // Same deliberately-vague message as login's rate limit: naming the exact limit helps
  // whoever is probing more than it helps a real shopper who waited too long between tries.
  slow: "Prea multe încercări. Așteaptă câteva minute și încearcă din nou.",
};

export default function ResetPasswordPage({ searchParams }: { searchParams: { token?: string; sent?: string; e?: string } }) {
  const err = searchParams.e ? ERRORS[searchParams.e] : undefined;

  // MODE 1: a token is present — set a new password.
  if (searchParams.token) {
    return (
      <div className="container">
        <div className="section" style={{ paddingBottom: 0 }}>
          <h1 style={{ fontSize: 26 }}>Setează o parolă nouă</h1>
          {err && <div className="alert-err" style={{ marginTop: 8 }}>{err}</div>}
        </div>
        <div className="auth-wrap">
          <div className="card auth-card">
            <form action={confirmPasswordReset} className="auth-form">
              <input type="hidden" name="token" value={searchParams.token} />
              <input type="password" name="password" required minLength={6} autoComplete="new-password" placeholder="Parolă nouă (min. 6 caractere)" aria-label="Parolă nouă" />
              <button className="btn btn-primary" type="submit">Salvează parola</button>
            </form>
          </div>
        </div>
        <div style={{ height: 32 }} />
      </div>
    );
  }

  // MODE 2: just sent a reset link — tell the shopper to check their inbox, without ever
  // revealing whether the address actually had an account (see requestPasswordReset's comment).
  if (searchParams.sent) {
    return (
      <div className="container">
        <div className="section">
          <h1 style={{ fontSize: 26 }}>Verifică-ți e-mailul</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            Dacă adresa introdusă are un cont, am trimis un link de resetare valabil o oră.
            Dacă nu îl vezi, verifică și folderul de spam.
          </p>
          <p style={{ marginTop: 16 }}><Link href="/login">Înapoi la autentificare</Link></p>
        </div>
      </div>
    );
  }

  // MODE 3 (default): ask for the email to send the link to.
  return (
    <div className="container">
      <div className="section" style={{ paddingBottom: 0 }}>
        <h1 style={{ fontSize: 26 }}>Resetează parola</h1>
        {err && <div className="alert-err" style={{ marginTop: 8 }}>{err}</div>}
      </div>
      <div className="auth-wrap">
        <div className="card auth-card">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Funcționează doar dacă ai adăugat o adresă de e-mail în cont. Dacă nu ai adăugat una,
            nu putem trimite un link — intră în cont și adaugă o adresă din pagina de cont.
          </p>
          <form action={requestPasswordReset} className="auth-form">
            <input type="email" name="email" required placeholder="Adresa de e-mail" aria-label="Adresa de e-mail" />
            <button className="btn btn-primary" type="submit">Trimite link de resetare</button>
          </form>
        </div>
      </div>
      <div style={{ height: 32 }} />
    </div>
  );
}
