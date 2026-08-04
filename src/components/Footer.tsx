import Link from "next/link";
import type { MenuCategory } from "@/lib/queries";

export function Footer({ categories }: { categories: MenuCategory[] }) {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Link href="/" className="brand" aria-label="CoșMic acasă">
            <span className="brand-mark">🛒</span>
            Coș<span className="brand-ro">Mic</span>
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
      </div>
      <div className="container footer-note">
        <strong>Date demonstrative.</strong> Prototip: prețurile afișate sunt fictive, pentru testare, și nu reprezintă
        oferte reale ale magazinelor menționate. CoșMic este un comparator — comenzile se fac pe site-ul magazinului.
        {" · "}
        <Link href="/admin" style={{ color: "var(--primary)" }}>Admin (demo)</Link>
      </div>
    </footer>
  );
}
