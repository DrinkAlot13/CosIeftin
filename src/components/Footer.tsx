import Link from "next/link";
import type { MenuCategory } from "@/lib/queries";

export function Footer({ categories }: { categories: MenuCategory[] }) {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Link href="/" className="brand" aria-label="CosIeftin acasă">
            <span className="brand-mark">🛒</span>
            Cos<span className="brand-ro">Ieftin</span>
          </Link>
          <p className="muted" style={{ marginTop: 10, fontSize: 13.5 }}>
            Compară prețurile la alimente din marile lanțuri și fă-ți lista de cumpărături la cel mai mic preț.
          </p>
        </div>
        <div>
          <h4>Categorii</h4>
          {categories.slice(0, 6).map((c) => (
            <Link key={c.id} href={`/c/${c.slug}`}>{c.name}</Link>
          ))}
        </div>
        <div>
          <h4>Aplicație</h4>
          <Link href="/lista">Lista mea</Link>
          <Link href="/cont">Contul meu</Link>
        </div>
        <div>
          <h4>Despre</h4>
          <Link href="/metodologie">Cum funcționează</Link>
          <Link href="/contribuitori">Contribuitori</Link>
          <Link href="/termeni">Termeni de utilizare</Link>
          <Link href="/confidentialitate">Confidențialitate</Link>
        </div>
      </div>
      <div className="container footer-note">
        <strong>Prețuri colectate automat.</strong> Prețurile sunt preluate din sursele publice ale magazinelor
        și pot fi diferite de cele din magazin în momentul cumpărării. Verifică întotdeauna prețul final pe
        site-ul magazinului. CosIeftin este un comparator — comenzile se fac pe site-ul magazinului.
        {" · "}
        <Link href="/admin" style={{ color: "var(--primary)" }}>Admin</Link>
      </div>
    </footer>
  );
}
