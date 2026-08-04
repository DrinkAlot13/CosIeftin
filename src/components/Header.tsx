import Link from "next/link";
import { logout } from "@/app/actions";
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

      <nav className="catnav-wrap" aria-label="Categorii">
        <div className="container">
          <ul className="catnav">
            {categories.map((c) => (
              <li key={c.id}>
                <Link href={`/c/${c.slug}`}>
                  <span aria-hidden>{c.icon}</span> {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </header>
  );
}
