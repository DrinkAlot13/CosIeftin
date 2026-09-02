import Link from "next/link";
import { logout } from "@/app/actions";
import { AlertsBell } from "@/components/AlertsBell";
import { SearchAutocomplete } from "@/components/SearchAutocomplete";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getCurrentUser } from "@/lib/auth";
import type { MenuCategory } from "@/lib/queries";

export async function Header({ categories }: { categories: MenuCategory[] }) {
  const user = await getCurrentUser();
  return (
    <header className="site-header">
      <div className="container header-top">
        <Link href="/" className="brand" aria-label="CoșMic acasă">
          <span className="brand-mark">🛒</span>
          Coș<span className="brand-ro">Mic</span>
        </Link>
        <SearchAutocomplete />
        <Link href="/lista" className="header-list-link">🛒 Lista</Link>
        <AlertsBell />
        <ThemeToggle />
        <div className="header-account">
          {user ? (
            <>
              <Link href="/cont">{user.email}</Link>
              {" · "}
              <form action={logout} style={{ display: "inline" }}>
                <button type="submit" className="linklike">Ieși</button>
              </form>
            </>
          ) : (
            <Link href="/login">Cont</Link>
          )}
        </div>
      </div>

      <nav className="catnav-wrap" aria-label="Departamente">
        <div className="container catnav-row">
          <ul className="catnav">
            <li className="has-sub">
              <Link href="/"><span aria-hidden>🍎</span> Alimentare <span className="caret" aria-hidden>▾</span></Link>
              <ul className="submenu submenu-grid">
                {categories.map((c) => (
                  <li key={c.id}>
                    <Link href={`/c/${c.slug}`}><span aria-hidden>{c.icon}</span> {c.name}</Link>
                  </li>
                ))}
              </ul>
            </li>
            <li><Link href="/alcool"><span aria-hidden>🍷</span> Alcool</Link></li>
            <li><Link href="/cosmetice"><span aria-hidden>💄</span> Cosmetice</Link></li>
            <li><Link href="/farmacie"><span aria-hidden>💊</span> Farmacie</Link></li>
            <li><Link href="/dcneu"><span aria-hidden>🏷️</span> DCNeu</Link></li>
          </ul>
          <ul className="catnav catnav-tools">
            <li><Link href="/oferte"><span aria-hidden>🔥</span> Oferte</Link></li>
            <li>
              <Link href="/index-cosmic" title="Un coș fix de 40 de produse de bază, urmărit în timp">
                <span aria-hidden>📊</span> Indexul CoșMic <span className="nav-sub">— cât costă coșul</span>
              </Link>
            </li>
            <li><Link href="/retete"><span aria-hidden>🍳</span> Rețete</Link></li>
            <li><Link href="/carduri"><span aria-hidden>💳</span> Carduri</Link></li>
          </ul>
        </div>
      </nav>
    </header>
  );
}
